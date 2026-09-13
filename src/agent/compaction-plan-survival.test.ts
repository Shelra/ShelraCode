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
 * End-to-end proof for §14 Phase 2 item 3 (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md):
 * a plan's acceptance criteria published in an early turn are still present, verbatim, in the
 * persisted compaction summary once a later turn's context pressure forces real compaction to
 * run — not just the pure `appendActiveCriteriaBlock` unit, but the actual `Agent` wiring.
 */

const { upsertObjectiveIndex, executeEventHooksMock, appendCompactionMock } = vi.hoisted(() => ({
  upsertObjectiveIndex: vi.fn(),
  executeEventHooksMock: vi.fn<(input: HookInput) => Promise<AggregatedHookResult>>(),
  appendCompactionMock: vi.fn(),
}));

vi.mock("../storage/index", () => ({
  appendCompaction: appendCompactionMock,
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

const AC1 = { id: "AC1", description: "Clock ticks every second", verification: "curl and observe" };

/** A small context window (forces real compaction) and a scripted round per turn. */
class SmallWindowProvider implements ProviderAdapter {
  readonly id = "compaction-test";
  readonly defaultModelId = "gate-test-model";
  private index = -1;

  constructor(private readonly rounds: ProviderEvent[][]) {}

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return {
      modelId,
      modelInfo: {
        id: modelId,
        name: "Small window model",
        contextWindow: 600,
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
    const events = this.rounds[this.index] ?? [{ type: "text-delta", text: "ok" }];
    return {
      events: (async function* () {
        yield* events;
      })(),
      response: Promise.resolve({ messages: [{ role: "assistant", content: "ok" }] }),
    };
  }

  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    // Stands in for the real summarization call `generateCompactionSummary` makes.
    return { text: "## Goal\nBuild a digital clock.", modelId: request.modelId };
  }

  getToolContext(): ProviderToolContext {
    return {};
  }
}

describe("compaction preserves the active plan's acceptance criteria", () => {
  it("keeps AC1 verbatim in the persisted compaction summary once context pressure forces compaction", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const bigOutput = "x".repeat(6_000); // padding so turn 1's history alone exceeds the small window's trigger
    const provider = new SmallWindowProvider([
      // Turn 1: publish AC1, run a big padded bash call, verify, complete. Nothing forces
      // compaction yet (there's no prior history to summarize on the very first turn).
      [
        toolCallEvent("call-plan-1", "generate_plan", {}),
        toolResultEvent("call-plan-1", "generate_plan", {
          success: true,
          output: "Plan",
          plan: {
            title: "Plan",
            summary: "Plan",
            goal: "Goal",
            requirements: ["Requirement"],
            acceptanceCriteria: [AC1],
            steps: [{ title: "Step", description: "Do it", satisfies: ["AC1"] }],
          },
        }),
        toolCallEvent("call-pad-1", "bash", { command: "curl http://localhost:8080" }),
        toolResultEvent(
          "call-pad-1",
          "bash",
          { success: true, output: bigOutput },
          {
            command: "curl http://localhost:8080",
          },
        ),
        { type: "text-delta", text: "Verified: the page serves correctly." },
      ],
      // Turn 2: a short follow-up. Turn 1's now-accumulated history (padded well past the small
      // window's ~1000-token trigger) forces real compaction before this turn's own response.
      [{ type: "text-delta", text: "Sounds good." }],
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider });

    for await (const _chunk of agent.processMessage("Create a digital clock")) {
      // drain turn 1
    }
    for await (const _chunk of agent.processMessage("Anything else to check?")) {
      // drain turn 2 — this is where compaction should fire
    }

    expect(appendCompactionMock).toHaveBeenCalled();
    const [, , summary] = appendCompactionMock.mock.calls.at(-1) as [string, number, string, number];
    expect(summary).toContain("Active Acceptance Criteria");
    expect(summary).toContain("AC1: Clock ticks every second (verify: curl and observe)");
  });
});
