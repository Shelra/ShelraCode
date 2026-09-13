import { describe, expect, it, vi } from "vitest";
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
 * Behavioral proof for the completion/verification gate
 * (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §9), added after reproducing the failure
 * live on 2026-09-13: a headless coding turn published a plan with acceptance criteria, wrote
 * files, re-read its own source, and reported "Done." having never made a single
 * verification-shaped tool call. `describeVerificationEvidence` in agent.ts deliberately does
 * NOT count `read_file`/`bash ls`-style inspection as evidence — only things that touch reality
 * (a real request, a test/build run, a rendered-output observation) count.
 */

const { upsertObjectiveIndex, executeEventHooksMock } = vi.hoisted(() => ({
  upsertObjectiveIndex: vi.fn(),
  executeEventHooksMock: vi.fn<(input: HookInput) => Promise<AggregatedHookResult>>(),
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

const PLAN_TOOL_RESULT = {
  success: true,
  output: "Plan: Digital clock",
  plan: {
    title: "Digital clock",
    summary: "Build it",
    goal: "A clock that ticks",
    requirements: ["Ticks every second"],
    acceptanceCriteria: [
      { id: "AC1", description: "Clock ticks every second", verification: "curl the page and observe" },
    ],
    steps: [{ title: "Write it", description: "Write index.html", satisfies: ["AC1"] }],
  },
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

/**
 * Round 1: publish a plan, write a file, never verify. Later rounds (nudges): scripted per-test
 * — either one script repeated for every nudge, or a distinct script per round (an array of
 * arrays) so a test can prove a LATER nudge, not just the first, can still succeed.
 */
class ScenarioProvider implements ProviderAdapter {
  readonly id = "gate-test";
  readonly defaultModelId = "gate-test-model";
  round = 0;

  constructor(private readonly secondRoundEvents: ProviderEvent[] | ProviderEvent[][]) {}

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
    this.round += 1;
    const events: ProviderEvent[] =
      this.round === 1
        ? [
            toolCallEvent("call-plan", "generate_plan", {}),
            toolResultEvent("call-plan", "generate_plan", PLAN_TOOL_RESULT),
            toolCallEvent("call-write", "write_file", { path: "index.html", content: "<html></html>" }),
            toolResultEvent("call-write", "write_file", {
              success: true,
              output: "Created index.html",
              diff: { filePath: "index.html", additions: 1, removals: 0, patch: "", isNew: true },
            }),
            { type: "text-delta", text: "Done." },
          ]
        : Array.isArray(this.secondRoundEvents[0])
          ? ((this.secondRoundEvents as ProviderEvent[][])[this.round - 2] ??
            (this.secondRoundEvents as ProviderEvent[][]).at(-1) ??
            [])
          : (this.secondRoundEvents as ProviderEvent[]);
    return {
      events: (async function* () {
        yield* events;
      })(),
      response: Promise.resolve({ messages: [{ role: "assistant", content: "Done." }] }),
    };
  }

  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    return { text: "Summary.", modelId: request.modelId };
  }

  getToolContext(): ProviderToolContext {
    return {};
  }
}

describe("completion/verification gate", () => {
  it("blocks completion when no acceptance criterion was ever verified, after all automatic nudges", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([{ type: "text-delta", text: "Still done, trust me." }]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // Round 1 (initial) + 3 nudge rounds (MAX_VERIFICATION_RETRIES) = 4 total streamed rounds.
    // Raised from 1 nudge to 3 (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §12): each
    // nudge re-enters the same turn's tool loop, so more nudges means more real room to reach a
    // verifiable state on a large scaffold, not just asking the same unmet question again.
    expect(provider.round).toBe(4);
    const notice = chunks.find((c) => c.type === "content" && c.content?.includes("Not verified"));
    expect(notice).toBeDefined();
    expect(notice?.content).toContain("AC1");
    expect(chunks.at(-1)).toEqual({ type: "done" });

    const blockedCall = upsertObjectiveIndex.mock.calls.find(([record]) => record.phase === "blocked");
    expect(blockedCall).toBeDefined();
    expect(blockedCall?.[0].blocker).toContain("No verification action was observed");
  });

  it("does not block when the nudge round actually verifies (a real command is run)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([
      toolCallEvent("call-curl", "bash", { command: "curl http://localhost:8080/index.html" }),
      toolResultEvent(
        "call-curl",
        "bash",
        { success: true, output: "<html></html>" },
        { command: "curl http://localhost:8080/index.html" },
      ),
      { type: "text-delta", text: "Verified: the page serves correctly." },
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(provider.round).toBe(2);
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });

  it("does not block a large scaffold that only becomes verifiable on a later nudge (e.g. after install/build)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([
      // Nudge 1: still just installing — nothing to verify yet.
      [
        toolCallEvent("call-install", "bash", { command: "npm install" }),
        toolResultEvent(
          "call-install",
          "bash",
          { success: true, output: "added 200 packages" },
          { command: "npm install" },
        ),
        { type: "text-delta", text: "Dependencies installed. Continuing setup." },
      ],
      // Nudge 2: still setting up — nothing to verify yet.
      [
        toolCallEvent("call-migrate", "bash", { command: "npx prisma migrate dev" }),
        toolResultEvent(
          "call-migrate",
          "bash",
          { success: true, output: "Migration applied" },
          { command: "npx prisma migrate dev" },
        ),
        { type: "text-delta", text: "Database migrated. Starting the server next." },
      ],
      // Nudge 3: the server is finally up — a real verification action happens.
      [
        toolCallEvent("call-curl", "bash", { command: "curl http://localhost:3000" }),
        toolResultEvent(
          "call-curl",
          "bash",
          { success: true, output: "<html></html>" },
          { command: "curl http://localhost:3000" },
        ),
        { type: "text-delta", text: "Verified: the app serves correctly." },
      ],
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // Would have been wrongly blocked after round 2 under the old 1-nudge limit — this is the
    // exact shape of the live CITADEL failure (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §12).
    expect(provider.round).toBe(4);
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: "done" });
    // §18: this turn's unblocking evidence (the final curl) is real but UNLINKED — the model
    // never called update_plan_step. This is the concrete, empirical reason a mechanical
    // "require linked evidence" second-pass gate was NOT built in §18: applying that requirement
    // here would demand a 4th nudge this scenario doesn't have budget for (MAX_VERIFICATION_RETRIES
    // = 3), reintroducing the exact over-blocking bug §12 already fixed once.
    expect(agent.getVerificationStatus().linkedCriteriaIds).toEqual([]);
  });

  it("counts a successful delegation to the verify sub-agent as real verification evidence", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([
      toolCallEvent("call-verify", "task", { agent: "verify", description: "Verify the clock renders and ticks" }),
      toolResultEvent(
        "call-verify",
        "task",
        { success: true, output: "Started the app, opened it in a real browser, observed the clock ticking." },
        { agent: "verify", description: "Verify the clock renders and ticks" },
      ),
      { type: "text-delta", text: "Verified via the verify sub-agent's real browser check." },
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // Before this fix, the gate only looked at the parent turn's OWN direct tool calls, so a
    // correctly-delegated real verification (build/test/browser smoke test inside the verify
    // sub-agent) was invisible to it and still got blocked.
    expect(provider.round).toBe(2);
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });

  it("does not credit a delegation to a non-verification sub-agent (e.g. explore) as evidence", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([
      toolCallEvent("call-explore", "task", { agent: "explore", description: "Look at the file again" }),
      toolResultEvent(
        "call-explore",
        "task",
        { success: true, output: "The file looks correct." },
        { agent: "explore", description: "Look at the file again" },
      ),
      { type: "text-delta", text: "Still done, trust me." },
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(true);
  });

  it("links a criterion to real evidence when the model marks its satisfying step complete (§18)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    // PLAN_TOOL_RESULT's one step already declares satisfies: ["AC1"] (round 1, baked into
    // ScenarioProvider). Round 2 pairs real evidence with an explicit update_plan_step(complete)
    // on that same step — the model's own structural declaration of which criterion it advanced.
    const provider = new ScenarioProvider([
      toolCallEvent("call-curl", "bash", { command: "curl http://localhost:8080/index.html" }),
      toolResultEvent(
        "call-curl",
        "bash",
        { success: true, output: "<html></html>" },
        { command: "curl http://localhost:8080/index.html" },
      ),
      toolCallEvent("call-step", "update_plan_step", { index: 1, status: "complete", evidence: "curl returned 200" }),
      toolResultEvent(
        "call-step",
        "update_plan_step",
        {
          success: true,
          output: "Plan step 1 is complete.",
          planUpdate: { index: 0, status: "complete", evidence: "curl returned 200" },
        },
        { index: 1, status: "complete", evidence: "curl returned 200" },
      ),
      { type: "text-delta", text: "Verified: the page serves correctly." },
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider });

    const chunks: Array<{ type: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string });
    }

    expect(chunks.at(-1)).toEqual({ type: "done" });
    const status = agent.getVerificationStatus();
    expect(status.linkedCriteriaIds).toEqual(["AC1"]);
    expect(status.evidenceCount).toBeGreaterThan(0);
  });

  it("does not fabricate a link when update_plan_step is called with no real verification evidence", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    // Model marks the step "complete" and even names AC1 in the step's satisfies — but never
    // makes a real verification-shaped call. The raw link set may still record the id (it is
    // cheap, harmless bookkeeping), but the gate's blocking behavior must be entirely unchanged:
    // zero real evidence still nudges/blocks, exactly as before this feature existed.
    const provider = new ScenarioProvider([
      [
        toolCallEvent("call-step", "update_plan_step", {
          index: 1,
          status: "complete",
          evidence: "I looked at it and it's fine",
        }),
        toolResultEvent(
          "call-step",
          "update_plan_step",
          {
            success: true,
            output: "Plan step 1 is complete.",
            planUpdate: { index: 0, status: "complete", evidence: "I looked at it and it's fine" },
          },
          { index: 1, status: "complete", evidence: "I looked at it and it's fine" },
        ),
        { type: "text-delta", text: "Done, I checked it." },
      ],
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // The gate still blocks — a self-reported "complete" with no real evidence is exactly the
    // original §9 failure this whole mechanism exists to catch, and per-criterion linking must
    // never become a way around it.
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(true);
    expect(agent.getVerificationStatus().evidenceCount).toBe(0);
  });

  it("does not gate a non-coding (conversational) turn even with no tool calls", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([]);
    // Override round 1 to look conversational: no plan, no tools, just text.
    provider.stream = (_req: ProviderStreamRequest) => ({
      events: (async function* () {
        yield { type: "text-delta", text: "Hi there!" } as ProviderEvent;
      })(),
      response: Promise.resolve({ messages: [{ role: "assistant", content: "Hi there!" }] }),
    });
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("hello")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });
});
