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
 * Behavioral proof for `docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md` §5-6: a Stop hook
 * that blocks must actually prevent the turn from being presented as finished, and the kernel's
 * resulting phase must be persisted (queryable) rather than silently discarded. Before this
 * change, `Stop`'s hook result was awaited and thrown away (`.catch(() => {})` on the promise,
 * nothing done with its resolved value) — a configured Stop hook could observe a turn ending
 * but never actually stop it from counting as complete.
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
  getNextMessageSequence: vi.fn(() => 0),
  getSessionTotalTokens: vi.fn(() => 0),
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
        model: "stop-hook-test-model",
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

const emptyResult: AggregatedHookResult = {
  blocked: false,
  blockingErrors: [],
  preventContinuation: false,
  additionalContexts: [],
  results: [],
};

class ScriptedProvider implements ProviderAdapter {
  readonly id = "stop-hook-test";
  readonly defaultModelId = "stop-hook-test-model";

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return {
      modelId,
      modelInfo: {
        id: modelId,
        name: "Stop hook test model",
        contextWindow: 8_192,
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
    const events: ProviderEvent[] = [{ type: "text-delta", text: "Done." }];
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

class FailingProvider implements ProviderAdapter {
  readonly id = "failing-test";
  readonly defaultModelId = "failing-test-model";

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return {
      modelId,
      modelInfo: {
        id: modelId,
        name: "Failing test model",
        contextWindow: 8_192,
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
    const events: ProviderEvent[] = [{ type: "error", error: new Error("Rate limit exceeded: free-models-per-min") }];
    return {
      events: (async function* () {
        yield* events;
      })(),
      // Deliberately resolves rather than rejects: an idle-timeout/rate-limit error can
      // surface as a stream *event* while the underlying response promise still settles
      // "normally" afterward (the connection ended, it just ended with nothing useful). This
      // isolates the test to the inline `case "error"` handler in the events loop — if that
      // handler didn't mark the kernel blocked itself, nothing downstream would either, since
      // the response-rejection path (a separate, pre-existing catch) never fires here.
      response: Promise.resolve({ messages: [] }),
    };
  }

  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    return { text: "Summary.", modelId: request.modelId };
  }

  getToolContext(): ProviderToolContext {
    return {};
  }
}

describe("Stop hook completion gate", () => {
  it("does not let a blocked Stop hook pass silently, and persists the blocked phase", async () => {
    executeEventHooksMock.mockImplementation(async (input: HookInput) => {
      if (input.hook_event_name === "Stop") {
        return {
          blocked: true,
          blockingErrors: [{ command: "verify.sh", stderr: "Acceptance criteria not yet verified." }],
          preventContinuation: true,
          additionalContexts: [],
          results: [],
        };
      }
      return emptyResult;
    });

    const agent = new Agent(undefined, undefined, "stop-hook-test-model", undefined, {
      provider: new ScriptedProvider(),
    });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Say hello")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    const notice = chunks.find((c) => c.type === "content" && c.content?.includes("Not marked complete"));
    expect(notice).toBeDefined();
    expect(notice?.content).toContain("Acceptance criteria not yet verified.");
    expect(chunks.at(-1)).toEqual({ type: "done" });

    const blockedCall = upsertObjectiveIndex.mock.calls.find(([record]) => record.phase === "blocked");
    expect(blockedCall).toBeDefined();
    expect(blockedCall?.[0].blocker).toContain("Acceptance criteria not yet verified.");
    expect(blockedCall?.[0].sessionId).toBe("session-1");
  });

  it("completes normally when no Stop hook blocks", async () => {
    executeEventHooksMock.mockResolvedValue(emptyResult);

    const agent = new Agent(undefined, undefined, "stop-hook-test-model", undefined, {
      provider: new ScriptedProvider(),
    });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Say hello")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(chunks.some((c) => c.content?.includes("Not marked complete"))).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });
});

describe("provider failure persistence", () => {
  it("persists a blocked phase with the failure reason when a turn errors out", async () => {
    // Found live, 2026-09-12: an interactive session hit "Rate limit exceeded:
    // free-models-per-min" and the objectives row was left stale at phase="review" with
    // blocker=null — the same class of bug as the Stop-hook gate, just in the catch(err)
    // branch instead of the Stop-hook branch. `kernel.transition("blocked")` alone does not
    // set a blockedReason (only evaluateCompletion/cancel do), and nothing persisted it.
    executeEventHooksMock.mockResolvedValue(emptyResult);

    const agent = new Agent(undefined, undefined, "failing-test-model", undefined, {
      provider: new FailingProvider(),
    });

    const chunks: Array<{ type: string; content?: string; isAuthError?: boolean }> = [];
    for await (const chunk of agent.processMessage("Build something")) {
      chunks.push(chunk as { type: string; content?: string; isAuthError?: boolean });
    }

    expect(chunks.some((c) => c.type === "error")).toBe(true);
    expect(chunks.at(-1)).toEqual({ type: "done" });

    const blockedCall = upsertObjectiveIndex.mock.calls.find(([record]) => record.phase === "blocked");
    expect(blockedCall).toBeDefined();
    expect(typeof blockedCall?.[0].blocker).toBe("string");
    expect(blockedCall?.[0].blocker.length).toBeGreaterThan(0);
  });
});
