import { APICallError } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import { ProviderStreamIdleError } from "../providers/stream";
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
 * Hard rule: a missing or failing resource never ends a turn. Reproduced live 2026-09-19: two
 * turns on free OpenRouter models ended as "The operation was aborted." 99 s in, with all their
 * work lost, because the AI SDK's 90 s chunk timeout aborted the generation and the loop treated
 * every non-context error as the end of the turn. These tests pin the recovery: completed steps
 * are kept, the round is retried, a failing model is replaced by a fallback, and only the user's
 * cancellation or a rejected credential ends a turn at once.
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
        model: "primary-model",
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

interface Round {
  events: ProviderEvent[];
  /** Messages of steps that completed before the round failed, reported through onStepFinish. */
  completedSteps?: unknown[];
  /** When set, `response` rejects with it; otherwise it resolves with `text`. */
  fail?: unknown;
  text?: string;
}

/** Plays one scripted round per model request; the last round repeats. */
class ScriptedProvider implements ProviderAdapter {
  readonly id = "resilience-test";
  readonly defaultModelId = "primary-model";
  readonly requests: ProviderStreamRequest[] = [];

  constructor(
    private readonly rounds: Round[],
    private readonly fallbacks: string[] = [],
  ) {}

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return {
      modelId,
      modelInfo: {
        id: modelId,
        name: modelId,
        contextWindow: 32_768,
        // A fallback is not always free: ids starting with "paid-" carry a price.
        inputPrice: modelId.startsWith("paid-") ? 0.000003 : 0,
        outputPrice: modelId.startsWith("paid-") ? 0.000015 : 0,
        reasoning: false,
        description: "Test-only provider",
        supportsClientTools: true,
        supportsMaxOutputTokens: true,
        runtimeKind: "managed-llama",
      },
    };
  }

  fallbackModelIds(modelId: string): string[] {
    return this.fallbacks.filter((id) => id !== modelId);
  }

  stream(request: ProviderStreamRequest): ProviderStream {
    this.requests.push(request);
    const round = this.rounds[this.requests.length - 1] ?? (this.rounds.at(-1) as Round);
    return {
      events: (async function* () {
        if (round.completedSteps) {
          request.onStepFinish?.({
            stepNumber: 0,
            finishReason: "tool-calls",
            usage: {},
            responseMessages: round.completedSteps,
          });
        }
        yield* round.events;
      })(),
      response:
        round.fail !== undefined
          ? Promise.reject(round.fail)
          : Promise.resolve({ messages: [{ role: "assistant", content: round.text ?? "Done." }] }),
    };
  }

  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    return { text: "Summary.", modelId: request.modelId };
  }

  getToolContext(): ProviderToolContext {
    return {};
  }
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function apiError(statusCode: number, message: string): APICallError {
  return new APICallError({
    message,
    url: "https://example.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody: JSON.stringify({ error: { message } }),
  });
}

const answer = (text: string): Round => ({ events: [{ type: "text-delta", text }], text });

async function run(provider: ScriptedProvider, message = "Explain the project") {
  executeEventHooksMock.mockResolvedValue(emptyHookResult);
  const agent = new Agent(undefined, undefined, "primary-model", undefined, {
    provider,
    interruptionBackoffMs: [0],
  });
  const chunks: Array<{ type: string; content?: string }> = [];
  for await (const chunk of agent.processMessage(message)) {
    chunks.push(chunk as { type: string; content?: string });
  }
  const text = chunks
    .filter((chunk) => chunk.type === "content")
    .map((chunk) => chunk.content ?? "")
    .join("");
  return { chunks, text };
}

describe("a failing model connection never ends the turn", () => {
  it("retries after the SDK's own timeout aborts the generation (the live 2026-09-19 failure)", async () => {
    const provider = new ScriptedProvider([
      { events: [{ type: "abort" }], fail: abortError() },
      answer("Here is the summary."),
    ]);
    const { chunks, text } = await run(provider);

    expect(provider.requests).toHaveLength(2);
    expect(text).toContain("Here is the summary.");
    expect(text).not.toContain("[Cancelled]");
    expect(text).toContain("no response within the time limit");
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });

  it("keeps the steps that completed before a mid-stream failure and tells the model to continue", async () => {
    const toolStep = [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call-1", toolName: "read_file", input: { path: "a.ts" } }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "read_file",
            output: { type: "json", value: { success: true, output: "export const a = 1;" } },
          },
        ],
      },
    ];
    const provider = new ScriptedProvider([
      {
        events: [{ type: "error", error: new Error("Upstream idle timeout exceeded") }],
        completedSteps: toolStep,
        fail: new Error("Upstream idle timeout exceeded"),
      },
      answer("a.ts exports a."),
    ]);
    const { text } = await run(provider);

    expect(text).toContain("a.ts exports a.");
    // The request's message list is the live transcript, so read the order, not the tail.
    const retried = provider.requests[1]?.messages as Array<{ role: string; content: unknown }>;
    const toolIndex = retried.findIndex((message) => message.role === "tool");
    const nudgeIndex = retried.findIndex(
      (message) =>
        message.role === "user" && String(message.content).includes("Continue the task from where it stopped"),
    );
    expect(toolIndex).toBeGreaterThan(0);
    expect(nudgeIndex).toBeGreaterThan(toolIndex);
  });

  it("moves to the provider's fallback model after two failures in a row", async () => {
    const stall = { events: [{ type: "error" as const, error: new ProviderStreamIdleError(180_000) }] };
    const provider = new ScriptedProvider([stall, stall, answer("Answered by the fallback.")], ["fallback-model"]);
    const { text } = await run(provider);

    expect(provider.requests.map((request) => request.modelId)).toEqual([
      "primary-model",
      "primary-model",
      "fallback-model",
    ]);
    expect(text).toContain("continuing with fallback-model (free)");
    expect(text).toContain("Answered by the fallback.");
  });

  it("says what a paid fallback costs when it switches to one", async () => {
    const stall = { events: [{ type: "error" as const, error: new ProviderStreamIdleError(180_000) }] };
    const provider = new ScriptedProvider([stall, stall, answer("Paid answer.")], ["paid-model"]);
    const { text } = await run(provider);

    expect(text).toContain("continuing with paid-model (paid: $3.00 in / $15.00 out per 1M tokens)");
    expect(text).toContain("Paid answer.");
  });

  it("switches at once when the model cannot serve the request (no credits)", async () => {
    const provider = new ScriptedProvider(
      [{ events: [], fail: apiError(402, "This request requires more credits") }, answer("Free model answer.")],
      ["openrouter/free"],
    );
    const { text } = await run(provider);

    expect(provider.requests.map((request) => request.modelId)).toEqual(["primary-model", "openrouter/free"]);
    expect(text).toContain("Free model answer.");
  });

  it("ends at once on a rejected credential, since no retry or model can fix it", async () => {
    const provider = new ScriptedProvider([{ events: [], fail: apiError(401, "Invalid API key") }], ["fallback-model"]);
    const { chunks } = await run(provider);

    expect(provider.requests).toHaveLength(1);
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(true);
  });

  it("pauses with progress saved only after every attempt failed, instead of looping forever", async () => {
    const provider = new ScriptedProvider([{ events: [{ type: "abort" }], fail: abortError() }]);
    const { chunks, text } = await run(provider);

    expect(provider.requests).toHaveLength(9);
    expect(text).toContain("[Paused");
    expect(text).toContain('send "continue" to resume');
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });

  it("retries a request error that merely mentions tokens instead of taking it for a rejected key", async () => {
    const provider = new ScriptedProvider([
      { events: [], fail: apiError(400, "Invalid 'max_tokens': integer below minimum value") },
      answer("Answered on the retry."),
    ]);
    const { chunks, text } = await run(provider);

    expect(provider.requests).toHaveLength(2);
    expect(text).toContain("Answered on the retry.");
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
  });

  it("replaces a model that streams a preamble and then stalls, without saving the fragments", async () => {
    const stallAfterPreamble: Round = {
      events: [
        { type: "text-delta", text: "Let me write the file now." },
        { type: "error", error: new ProviderStreamIdleError(180_000) },
      ],
    };
    const provider = new ScriptedProvider(
      [stallAfterPreamble, stallAfterPreamble, answer("Written by the fallback.")],
      ["fallback-model"],
    );
    const { text } = await run(provider);

    expect(provider.requests.map((request) => request.modelId)).toEqual([
      "primary-model",
      "primary-model",
      "fallback-model",
    ]);
    expect(text).toContain("Written by the fallback.");
    const sent = JSON.stringify(provider.requests[2]?.messages ?? []);
    expect(sent).not.toContain("Let me write the file now.");
  });

  it("stops at once when retrying cannot help and no fallback is left", async () => {
    const provider = new ScriptedProvider([{ events: [], fail: apiError(402, "This request requires more credits") }]);
    const { chunks, text } = await run(provider);

    expect(provider.requests).toHaveLength(1);
    expect(text).toContain("[Paused");
    expect(text).toContain("cannot serve this request");
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });
});
