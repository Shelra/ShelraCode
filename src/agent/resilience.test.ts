import { mkdtempSync as makeTestWorkspace, readFileSync as readTestFile } from "node:fs";
import { tmpdir as testTmpdir } from "node:os";
import { join as joinTestPath } from "node:path";
import { APICallError } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import { credentialFallbackChain } from "../providers/credential-fallback";
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
 * are kept, the round is retried, a failing model is replaced by a fallback, a rejected key moves
 * the session to a configured fallback, and only the user's cancellation ends a turn at once.
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

/** Agents under test work in a throwaway folder: their memory and workspace scans never touch this repository. */
const testWorkspace = makeTestWorkspace(joinTestPath(testTmpdir(), "shelra-agent-test-"));

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

function agentFor(provider: ScriptedProvider) {
  executeEventHooksMock.mockResolvedValue(emptyHookResult);
  return new Agent(undefined, undefined, "primary-model", undefined, {
    cwd: testWorkspace,
    provider,
    interruptionBackoffMs: [0],
  });
}

async function run(provider: ScriptedProvider, message = "Explain the project", setup?: (agent: Agent) => void) {
  const agent = agentFor(provider);
  setup?.(agent);
  const chunks: Array<{ type: string; content?: string }> = [];
  for await (const chunk of agent.processMessage(message)) {
    chunks.push(chunk as { type: string; content?: string });
  }
  const text = chunks
    .filter((chunk) => chunk.type === "content")
    .map((chunk) => chunk.content ?? "")
    .join("");
  return { agent, chunks, text };
}

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

function sentMessages(provider: ScriptedProvider, index: number) {
  return provider.requests[index]?.messages as Array<{ role: string; content: unknown }>;
}

function continuationIndex(messages: Array<{ role: string; content: unknown }>) {
  return messages.findIndex(
    (message) => message.role === "user" && String(message.content).includes("Continue the task from where it stopped"),
  );
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

  it("ends at once on a rejected credential when no other key or installed model is configured", async () => {
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

  it("retries an upstream provider's failure that OpenRouter reports as 404 (the audit's 2026-09-23 run)", async () => {
    // Nvidia failed upstream; OpenRouter answered 404 "Provider returned error"; the same model answered 200
    // minutes later. Treated as "model unavailable", it paused a pinned benchmark turn after one attempt.
    const upstreamFailure = new APICallError({
      message: "Provider returned error",
      url: "https://openrouter.ai/api/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 404,
      responseBody: JSON.stringify({
        error: { message: "Provider returned error", code: 404, metadata: { raw: "", provider_name: "Nvidia" } },
      }),
      isRetryable: false,
    });
    const provider = new ScriptedProvider([{ events: [], fail: upstreamFailure }, answer("Answered on the retry.")]);
    const { text } = await run(provider);

    expect(provider.requests.map((request) => request.modelId)).toEqual(["primary-model", "primary-model"]);
    expect(text).toContain("Answered on the retry.");
    expect(text).not.toContain("cannot serve this request");
  });

  it("still treats a model with no endpoint as unavailable", async () => {
    const provider = new ScriptedProvider([
      { events: [], fail: apiError(404, "No endpoints found for primary-model.") },
    ]);
    const { text } = await run(provider);

    expect(provider.requests).toHaveLength(1);
    expect(text).toContain("cannot serve this request");
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

describe("a provider that cannot serve the turn hands it to another free provider (owner, 2026-09-23)", () => {
  const quotaSpent = () =>
    apiError(
      429,
      "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
    );

  it("continues on the next configured free provider with the completed steps kept, saying what it costs", async () => {
    const openrouter = new ScriptedProvider([{ events: [], completedSteps: toolStep, fail: quotaSpent() }]);
    const groq = new ScriptedProvider([answer("Answered on Groq.")]);
    const { agent, chunks, text } = await run(openrouter, "Explain the project", (agent) =>
      agent.setProviderFallback(
        credentialFallbackChain([
          async () => ({
            provider: groq,
            modelId: "openai/gpt-oss-120b",
            label: "Groq (free plan: 30 requests a minute and 1,000 a day), with the key from GROQ_API_KEY",
          }),
        ]),
      ),
    );

    expect(openrouter.requests).toHaveLength(1);
    expect(groq.requests.map((request) => request.modelId)).toEqual(["openai/gpt-oss-120b"]);
    expect(text).toContain("cannot serve this request");
    expect(text).toContain("Continuing with Groq (free plan: 30 requests a minute and 1,000 a day)");
    expect(text).toContain("Answered on Groq.");
    expect(text).not.toContain("[Paused");
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    const sent = sentMessages(groq, 0);
    expect(sent.findIndex((message) => message.role === "tool")).toBeGreaterThan(0);
    expect(agent.getModel()).toBe("openai/gpt-oss-120b");
  });

  it("moves on to the next free provider when the first one cannot serve the turn either", async () => {
    const openrouter = new ScriptedProvider([{ events: [], fail: quotaSpent() }]);
    const groq = new ScriptedProvider([{ events: [], fail: apiError(429, "Rate limit reached for requests per day") }]);
    const gemini = new ScriptedProvider([answer("Answered on Gemini.")]);
    const { text } = await run(openrouter, "Explain the project", (agent) =>
      agent.setProviderFallback(
        credentialFallbackChain([
          async () => ({ provider: groq, modelId: "openai/gpt-oss-120b", label: "Groq" }),
          async () => ({
            provider: gemini,
            modelId: "gemini-2.5-flash",
            label: "Google Gemini (on the free tier Google may use prompts and outputs to improve its products)",
          }),
        ]),
      ),
    );

    expect(groq.requests.length).toBeGreaterThan(0);
    expect(text).toContain("Continuing with Google Gemini (on the free tier Google may use prompts and outputs");
    expect(text).toContain("Answered on Gemini.");
  });

  it("pauses as before when no other provider is configured", async () => {
    const openrouter = new ScriptedProvider([{ events: [], fail: quotaSpent() }]);
    const { text } = await run(openrouter);

    expect(openrouter.requests).toHaveLength(1);
    expect(text).toContain("[Paused");
  });
});

describe("a rejected API key moves the session to a fallback the user already has", () => {
  it("continues on the configured fallback with the completed steps kept", async () => {
    const rejecting = new ScriptedProvider([
      { events: [], completedSteps: toolStep, fail: apiError(401, "Invalid API key") },
    ]);
    const local = new ScriptedProvider([answer("Answered on the local model.")]);
    const dispose = vi.fn(async () => {});
    const { agent, chunks, text } = await run(rejecting, "Explain the project", (agent) =>
      agent.setCredentialFallback(
        credentialFallbackChain([
          async () => ({ provider: local, modelId: "local-model", label: "the installed local model Test", dispose }),
        ]),
      ),
    );

    expect(rejecting.requests).toHaveLength(1);
    expect(local.requests.map((request) => request.modelId)).toEqual(["local-model"]);
    expect(text).toContain("Continuing with the installed local model Test, model local-model (free)");
    expect(text).toContain("Answered on the local model.");
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    const sent = sentMessages(local, 0);
    expect(sent.findIndex((message) => message.role === "tool")).toBeGreaterThan(0);
    expect(continuationIndex(sent)).toBeGreaterThan(sent.findIndex((message) => message.role === "tool"));
    // The session stays on the fallback, and cleanup releases what it started.
    expect(agent.getModel()).toBe("local-model");
    await agent.cleanup();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("tries the next fallback when the first one's key is rejected too, then ends with the key error", async () => {
    const rejected = () => new ScriptedProvider([{ events: [], fail: apiError(401, "Invalid API key") }]);
    const primary = rejected();
    const secondKey = rejected();
    const { chunks } = await run(primary, "Explain the project", (agent) =>
      agent.setCredentialFallback(
        credentialFallbackChain([
          async ({ modelId }) => ({ provider: secondKey, modelId, label: "the OpenRouter key from KEY_OPENROUTER" }),
          async () => null,
        ]),
      ),
    );

    expect(primary.requests).toHaveLength(1);
    expect(secondKey.requests.map((request) => request.modelId)).toEqual(["primary-model"]);
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(true);
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });
});

describe("a sub-agent recovers from a failing model connection on its own", () => {
  const explore = { agent: "explore", description: "Find the entry point", prompt: "Where does the CLI start?" };

  it("retries after a timeout instead of failing the task", async () => {
    const provider = new ScriptedProvider([
      { events: [{ type: "abort" }], fail: abortError() },
      answer("The CLI starts in src/index.ts."),
    ]);
    const activity: string[] = [];
    const result = await agentFor(provider).runTaskRequest(explore as never, (detail) => activity.push(detail));

    expect(provider.requests).toHaveLength(2);
    expect(result.success).toBe(true);
    expect(result.output).toBe("The CLI starts in src/index.ts.");
    expect(activity.some((detail) => detail.includes("no response within the time limit"))).toBe(true);
  });

  it("keeps the steps it completed and continues from them", async () => {
    const provider = new ScriptedProvider([
      { events: [{ type: "error", error: new Error("Upstream idle timeout exceeded") }], completedSteps: toolStep },
      answer("a.ts exports a."),
    ]);
    const result = await agentFor(provider).runTaskRequest(explore as never);

    expect(result.success).toBe(true);
    const retried = sentMessages(provider, 1);
    expect(retried.findIndex((message) => message.role === "tool")).toBeGreaterThan(0);
    expect(continuationIndex(retried)).toBeGreaterThan(retried.findIndex((message) => message.role === "tool"));
  });

  it("moves to the provider's fallback model after two failures in a row", async () => {
    const stall = { events: [{ type: "error" as const, error: new ProviderStreamIdleError(180_000) }] };
    const provider = new ScriptedProvider([stall, stall, answer("Found by the fallback.")], ["fallback-model"]);
    const result = await agentFor(provider).runTaskRequest(explore as never);

    expect(provider.requests.map((request) => request.modelId)).toEqual([
      "primary-model",
      "primary-model",
      "fallback-model",
    ]);
    expect(result.output).toBe("Found by the fallback.");
  });

  it("gives up after a bounded number of attempts with a failed result the parent can route around", async () => {
    const provider = new ScriptedProvider([{ events: [{ type: "abort" }], fail: abortError() }]);
    const result = await agentFor(provider).runTaskRequest(explore as never);

    expect(provider.requests).toHaveLength(5);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Task interrupted: no model answered after 5 attempts");
    expect(result.output).toContain("delegate it again");
  });
});

describe("what the resilience rule swallows is recorded, not lost (audit doc 15, Q2)", () => {
  it("finishes the turn when the objective index cannot be written, and logs why", async () => {
    const log = joinTestPath(makeTestWorkspace(joinTestPath(testTmpdir(), "shelra-swallowed-")), "swallowed.jsonl");
    const previous = process.env.SHELRA_DIAGNOSTICS_LOG;
    process.env.SHELRA_DIAGNOSTICS_LOG = log;
    upsertObjectiveIndex.mockImplementation(() => {
      throw new Error("database is locked");
    });
    try {
      const { chunks, text } = await run(new ScriptedProvider([answer("Here is the summary.")]));

      expect(text).toContain("Here is the summary.");
      expect(chunks.at(-1)).toEqual({ type: "done" });
      const entries = readTestFile(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { area: string; error: string });
      expect(entries).toContainEqual(
        expect.objectContaining({ area: "kernel.index", error: "Error: database is locked" }),
      );
    } finally {
      upsertObjectiveIndex.mockReset();
      if (previous === undefined) delete process.env.SHELRA_DIAGNOSTICS_LOG;
      else process.env.SHELRA_DIAGNOSTICS_LOG = previous;
    }
  });
});
