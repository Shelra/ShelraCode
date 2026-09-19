import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import type {
  ProviderAdapter,
  ProviderEvent,
  ProviderModelRuntime,
  ProviderStream,
  ProviderStreamRequest,
  ProviderTextRequest,
  ProviderTextResult,
  ProviderToolContext,
} from "../providers/types";

/**
 * Proof for §14 Phase 2 item 1 (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md): the
 * completion gate's acceptance criteria are session-scoped (`Agent.activeAcceptanceCriteria`),
 * not turn-scoped — a plan published in an earlier turn stays visible to the gate (and to
 * `getVerificationStatus()` for the UI) in later turns, instead of silently vanishing the moment
 * a turn doesn't call `generate_plan` again. The mutation guard (`mutatedThisTurn`) is what keeps
 * this from over-triggering: a later turn that touches nothing this turn is never gated just
 * because an earlier turn once published criteria.
 */

const { upsertObjectiveIndex, executeEventHooksMock, loadPersistedPlanStateMock } = vi.hoisted(() => ({
  upsertObjectiveIndex: vi.fn(),
  executeEventHooksMock: vi.fn<(input: HookInput) => Promise<AggregatedHookResult>>(),
  loadPersistedPlanStateMock: vi.fn(),
}));

vi.mock("../storage/index", () => ({
  appendCompaction: vi.fn(),
  appendMessages: vi.fn(() => []),
  appendSystemMessage: vi.fn(() => 0),
  buildChatEntries: vi.fn(() => []),
  getLatestObjectiveForSession: vi.fn(() => null),
  getNextMessageSequence: vi.fn(() => 0),
  getSessionTotalCostMicros: vi.fn(() => 0),
  getSessionTotalTokens: vi.fn(() => 0),
  getUsageCostSinceMicros: vi.fn(() => 0),
  listSessionUsage: vi.fn(() => []),
  loadPersistedPlanState: loadPersistedPlanStateMock,
  loadTranscript: vi.fn(() => []),
  loadTranscriptState: vi.fn(() => ({ messages: [], seqs: [] })),
  recordCheckpoint: vi.fn(),
  recordUsageEvent: vi.fn(),
  upsertObjectiveIndex,
  SessionStore: class {
    getWorkspace() {
      return {
        id: "ws-1",
        scopeKey: "/tmp/ws",
        canonicalPath: "/tmp/ws",
        gitRoot: null,
        displayName: "ws",
        lastSeenAt: new Date(),
      };
    }
    private fakeSession() {
      return {
        id: "session-1",
        workspaceId: "ws-1",
        title: null,
        recap: null,
        model: "gate-test-model",
        mode: "agent" as const,
        cwdAtStart: "/tmp/ws",
        cwdLast: "/tmp/ws",
        status: "active" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    openSession() {
      return this.fakeSession();
    }
    createSession() {
      return this.fakeSession();
    }
    getRequiredSession() {
      return this.fakeSession();
    }
    setModel() {}
    setMode() {}
    setTitle() {}
    setRecap() {}
    touchSession() {}
  },
}));

vi.mock("../hooks/index", () => ({
  executeEventHooks: executeEventHooksMock,
}));

import { Agent } from "./agent";

const emptyHookResult: AggregatedHookResult = {
  blocked: false,
  blockingErrors: [],
  preventContinuation: false,
  additionalContexts: [],
  results: [],
};

function toolCallEvent(id: string, name: string, input: Record<string, unknown>): ProviderEvent {
  return {
    type: "tool-call",
    toolCall: { id, type: "function", function: { name, arguments: JSON.stringify(input) } },
  };
}

function toolResultEvent(
  id: string,
  name: string,
  output: unknown,
  input: Record<string, unknown> = {},
): ProviderEvent {
  return {
    type: "tool-result",
    toolCall: { id, type: "function", function: { name, arguments: JSON.stringify(input) } },
    output,
  };
}

function planResult(acceptanceCriteria: Array<{ id: string; description: string; verification: string }>) {
  return {
    success: true,
    output: "Plan",
    plan: {
      title: "Plan",
      summary: "Plan",
      goal: "Goal",
      requirements: ["Requirement"],
      acceptanceCriteria,
      steps: [{ title: "Step", description: "Do it", satisfies: acceptanceCriteria.map((c) => c.id) }],
    },
  };
}

/** Every round across every turn is fully scripted, in call order — no implicit round-1 script. */
class FullyScriptedProvider implements ProviderAdapter {
  readonly id = "cross-turn-test";
  readonly defaultModelId = "gate-test-model";
  private index = -1;

  constructor(private readonly rounds: ProviderEvent[][]) {}

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return {
      modelId,
      modelInfo: {
        id: modelId,
        name: "Gate test model",
        contextWindow: 32_768,
        inputPrice: 0,
        outputPrice: 0,
        reasoning: false,
        description: "Test-only provider",
        supportsClientTools: true,
        supportsMaxOutputTokens: true,
        runtimeKind: "managed-llama",
      },
    };
  }

  stream(_request: ProviderStreamRequest): ProviderStream {
    this.index += 1;
    const events = this.rounds[this.index] ?? [];
    return {
      events: (async function* () {
        yield* events;
      })(),
      response: Promise.resolve({ messages: [{ role: "assistant", content: "ok" }] }),
    };
  }

  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    return { text: "Summary.", modelId: request.modelId };
  }

  getToolContext(): ProviderToolContext {
    return {};
  }
}

describe("cross-turn acceptance-criteria tracking", () => {
  beforeEach(() => {
    loadPersistedPlanStateMock.mockReset();
    loadPersistedPlanStateMock.mockReturnValue(null);
  });

  it("restores persisted criteria and progress when an agent process reopens the session", () => {
    const ac1 = { id: "AC1", description: "Conversation survives restart", verification: "restart test" };
    loadPersistedPlanStateMock.mockReturnValue(planResult([ac1]).plan);

    const resumed = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider: new FullyScriptedProvider([]),
      session: "latest",
    });

    expect(resumed.getVerificationStatus().criteria).toEqual([ac1]);
    expect(resumed.getPlanState()?.steps[0]).toMatchObject({ title: "Step" });
  });

  it("does not leak a previous session's intent into a new session", () => {
    const ac1 = { id: "AC1", description: "Only belongs to session one", verification: "inspect session" };
    loadPersistedPlanStateMock.mockReturnValue(planResult([ac1]).plan);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider: new FullyScriptedProvider([]),
    });
    expect(agent.getVerificationStatus().criteria).toEqual([ac1]);

    loadPersistedPlanStateMock.mockReturnValue(null);
    agent.startNewSession();

    expect(agent.getVerificationStatus().criteria).toBeNull();
  });

  it("keeps an earlier turn's criteria visible to a later turn that makes no mutations", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const ac1 = { id: "AC1", description: "Clock ticks every second", verification: "curl and observe" };
    const provider = new FullyScriptedProvider([
      // Turn 1: publish AC1, write a file, verify with a real command. Completes clean.
      [
        toolCallEvent("call-plan-1", "generate_plan", {}),
        toolResultEvent("call-plan-1", "generate_plan", planResult([ac1])),
        toolCallEvent("call-write-1", "write_file", { path: "index.html", content: "<html></html>" }),
        toolResultEvent("call-write-1", "write_file", {
          success: true,
          output: "Created index.html",
          diff: { filePath: "index.html", additions: 1, removals: 0, patch: "", isNew: true },
        }),
        toolCallEvent("call-curl-1", "bash", { command: "curl http://localhost:8080" }),
        toolResultEvent(
          "call-curl-1",
          "bash",
          { success: true, output: "<html></html>" },
          {
            command: "curl http://localhost:8080",
          },
        ),
        { type: "text-delta", text: "Verified: the page serves correctly." },
      ],
      // Turn 2: a "fix it" style prompt (classifies as coding) that makes NO tool calls at all —
      // nothing to verify, and no plan republished. Must not be gated using turn 1's AC1.
      [{ type: "text-delta", text: "Everything already looks correct; no changes needed." }],
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider });

    for await (const _chunk of agent.processMessage("Create a digital clock")) {
      // drain turn 1
    }
    expect(agent.getVerificationStatus().criteria).toEqual([ac1]);

    const turn2Chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Fix any remaining issues")) {
      turn2Chunks.push(chunk as { type: string; content?: string });
    }

    // The gate did not fire even though activeAcceptanceCriteria was still set from turn 1 —
    // the mutation guard is what prevents this, since turn 2 touched nothing.
    expect(turn2Chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
    expect(turn2Chunks.at(-1)).toEqual({ type: "done" });
    // The UI-facing status still shows turn 1's real criteria — not blanked out just because
    // turn 2 didn't republish them.
    expect(agent.getVerificationStatus().criteria).toEqual([ac1]);
  });

  it("gates a later turn's own unverified mutation using that turn's own (not an earlier turn's) criteria", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const ac1 = { id: "AC1", description: "Clock ticks every second", verification: "curl and observe" };
    const ac9 = { id: "AC9", description: "Dependencies install cleanly", verification: "run npm install" };
    const provider = new FullyScriptedProvider([
      // Turn 1: publish AC1, verify it, complete clean.
      [
        toolCallEvent("call-plan-1", "generate_plan", {}),
        toolResultEvent("call-plan-1", "generate_plan", planResult([ac1])),
        toolCallEvent("call-curl-1", "bash", { command: "curl http://localhost:8080" }),
        toolResultEvent(
          "call-curl-1",
          "bash",
          { success: true, output: "ok" },
          {
            command: "curl http://localhost:8080",
          },
        ),
        { type: "text-delta", text: "Verified." },
      ],
      // Turn 2: a narrower follow-up plan (AC9) that mutates package.json but never verifies.
      // Repeated for every nudge round (MAX_VERIFICATION_RETRIES = 3) since the provider has
      // nothing else scripted for those rounds.
      [
        toolCallEvent("call-plan-2", "generate_plan", {}),
        toolResultEvent("call-plan-2", "generate_plan", planResult([ac9])),
        toolCallEvent("call-write-2", "write_file", { path: "package.json", content: "{}" }),
        toolResultEvent("call-write-2", "write_file", {
          success: true,
          output: "Updated package.json",
          diff: { filePath: "package.json", additions: 1, removals: 0, patch: "", isNew: false },
        }),
        { type: "text-delta", text: "Done." },
      ],
      [{ type: "text-delta", text: "Still done, trust me." }],
      [{ type: "text-delta", text: "Still done, trust me." }],
      [{ type: "text-delta", text: "Still done, trust me." }],
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider });

    for await (const _chunk of agent.processMessage("Create a digital clock")) {
      // drain turn 1
    }
    expect(agent.getVerificationStatus().criteria).toEqual([ac1]);

    const turn2Chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Now fix the dependency install step")) {
      turn2Chunks.push(chunk as { type: string; content?: string });
    }

    // Turn 2's own criteria (AC9) replaced AC1 — proving replace, not merge.
    expect(agent.getVerificationStatus().criteria).toEqual([ac9]);
    const notice = turn2Chunks.find((c) => c.type === "content" && c.content?.includes("Not verified"));
    expect(notice).toBeDefined();
    expect(notice?.content).toContain("AC9");
    expect(notice?.content).not.toContain("AC1");
  });
});
