import { mkdtempSync as makeTestWorkspace, readFileSync as readTestFile } from "node:fs";
import { tmpdir as testTmpdir } from "node:os";
import { join as joinTestPath } from "node:path";
import { APICallError } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import { credentialFallbackChain } from "../providers/credential-fallback";
import { ProviderStreamIdleError, STALL_WINDOW } from "../providers/stream";
import type {
  HostStopReason,
  ProviderAdapter,
  ProviderEvent,
  ProviderModelRuntime,
  ProviderStream,
  ProviderStreamRequest,
  ProviderTextRequest,
  ProviderTextResult,
  ProviderToolContext,
} from "../providers/types";
import type { ModelInfo } from "../types/index";
import type { Ablation } from "./ablation";

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

import { Agent, patienceAfterSilences } from "./agent";

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
  /** The model the provider says answered the round's step (a router's pick, a server-side fallback). */
  served?: string;
  /** The provider ended the round because the model stopped making progress. */
  hostStop?: HostStopReason;
}

/** Plays one scripted round per model request; the last round repeats. */
class ScriptedProvider implements ProviderAdapter {
  readonly id: string = "resilience-test";
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
        if (round.served) {
          request.onStepFinish?.({ stepNumber: 0, finishReason: "stop", usage: {}, servedModelId: round.served });
        }
        yield* round.events;
        if (round.hostStop) request.onHostStop?.(round.hostStop);
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

describe("a model writing a large file (seen live 2026-09-25)", () => {
  it("shows the file and how much has arrived instead of waiting for the model", async () => {
    const provider = new ScriptedProvider([
      {
        events: [
          { type: "tool-input", id: "call-1", toolName: "write_file", chars: 0 },
          { type: "tool-input", id: "call-1", toolName: "write_file", path: "index.html", chars: 12_800 },
          { type: "text-delta", text: "Wrote the game." },
        ],
        text: "Wrote the game.",
      },
    ]);
    const agent = agentFor(provider);
    const statuses: string[] = [];
    for await (const _chunk of agent.processMessage("Build the game", {
      onStatus: (info) => statuses.push(info.detail),
    })) {
      // drain
    }
    expect(statuses).toContain("Preparing write_file");
    expect(statuses).toContain("Writing index.html · 12.5 KB");
  });
});

describe("research before the work (owner, 2026-09-25)", () => {
  const search = vi.fn(async (query: string) => ({
    success: true,
    query,
    provider: "google" as const,
    sources: [{ title: "World 1-1 level design", url: "https://example.test/1-1", snippet: "Teaches jumping first." }],
    output: "",
  }));
  const researching = (provider: ScriptedProvider, ablate: Ablation[] = []) => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    return new Agent(undefined, undefined, "primary-model", undefined, {
      cwd: testWorkspace,
      provider,
      interruptionBackoffMs: [0],
      webSearch: search,
      ablate,
    });
  };
  const previous = process.env.SHELRA_RESEARCH;
  beforeEach(() => {
    process.env.SHELRA_RESEARCH = "on";
    search.mockClear();
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.SHELRA_RESEARCH;
    else process.env.SHELRA_RESEARCH = previous;
  });

  it("hands the model a web search on the request, as a search_web result, before its first round", async () => {
    const provider = new ScriptedProvider([answer("Planned the level.")]);
    const agent = researching(provider);
    const chunks: Array<{ type: string; toolCalls?: Array<{ function: { name: string } }> }> = [];
    for await (const chunk of agent.processMessage("Create the classic Super Mario Bros game as a web game.")) {
      chunks.push(chunk as never);
    }

    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]).toBe("Create the classic Super Mario Bros game as a web game.");
    const sent = sentMessages(provider, 0);
    const call = sent.find((message) => message.role === "assistant");
    const result = sent.find((message) => message.role === "tool");
    expect(JSON.stringify(call?.content)).toContain('"toolName":"search_web"');
    expect(JSON.stringify(result?.content)).toContain("World 1-1 level design");
    expect(JSON.stringify(result?.content)).toContain("third-party text, not verified");
    expect(
      chunks.some((chunk) => chunk.type === "tool_calls" && chunk.toolCalls?.[0]?.function.name === "search_web"),
    ).toBe(true);
  });

  it("does not search for a greeting, or when research is switched off", async () => {
    const greeting = researching(new ScriptedProvider([answer("Hi.")]));
    for await (const _chunk of greeting.processMessage("hola")) {
      // drain
    }
    const off = researching(new ScriptedProvider([answer("Planned.")]), ["research"]);
    for await (const _chunk of off.processMessage("Create the classic Super Mario Bros game as a web game.")) {
      // drain
    }
    expect(search).not.toHaveBeenCalled();
  });
});

describe("a model that stops making progress (seen live 2026-09-25)", () => {
  const readCall = {
    id: "call-1",
    type: "function" as const,
    function: { name: "read_file", arguments: '{"path":"audit.cjs"}' },
  };
  const stalled: Round = {
    events: [
      { type: "tool-call", toolCall: readCall },
      { type: "tool-result", toolCall: readCall, output: { success: true, output: "hurtOk.invincible.toFixed(2)" } },
    ],
    hostStop: "stalled",
  };

  it("is told once why the host stopped its round, and answers", async () => {
    const provider = new ScriptedProvider([stalled, answer("The debug hook does not return invincible.")]);
    const { text } = await run(provider, "Why does the audit fail?");

    expect(provider.requests).toHaveLength(2);
    const notes = sentMessages(provider, 1).filter(
      (message) => message.role === "user" && String(message.content).startsWith("Shelra stopped your last round"),
    );
    expect(notes).toHaveLength(1);
    expect(String(notes[0]?.content)).toContain(
      `because its last ${STALL_WINDOW} steps only read or ran commands and turned up nothing new`,
    );
    expect(text).toContain(`[Shelra stopped the round: its last ${STALL_WINDOW} steps only read or ran commands`);
    expect(text).toContain("The debug hook does not return invincible.");
  });

  it("goes on to the gate when the model stalls again, instead of asking forever", async () => {
    const provider = new ScriptedProvider([stalled]);
    const { text, chunks } = await run(provider, "Why does the audit fail?");

    expect(provider.requests).toHaveLength(2);
    expect(text.match(/\[Shelra stopped the round/gu)).toHaveLength(1);
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });
});

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

  it("gives the next round more patience after a model sent nothing for too long", async () => {
    // Seen live 2026-09-24: a free model writing a large module sent nothing for 90 s (its provider delivers a tool
    // call only once complete) and was cut on every attempt, losing the file each time.
    expect(patienceAfterSilences({ totalMs: 900_000, stepMs: 300_000, chunkMs: 90_000 }, 0).chunkMs).toBe(90_000);
    expect(patienceAfterSilences({ totalMs: 900_000, stepMs: 300_000, chunkMs: 90_000 }, 1).chunkMs).toBe(180_000);
    expect(patienceAfterSilences({ totalMs: 900_000, stepMs: 300_000, chunkMs: 90_000 }, 2).chunkMs).toBe(300_000);

    const stall = { events: [{ type: "error" as const, error: new ProviderStreamIdleError(90_000) }] };
    const provider = new ScriptedProvider([stall, answer("Written.")]);
    const { text } = await run(provider);

    expect(text).toContain("Written.");
    const chunkTimeouts = provider.requests.map((request) => request.timeout?.chunkMs);
    expect(chunkTimeouts[1]).toBe((chunkTimeouts[0] ?? 0) * 2);
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

  it("tells the UI which model answers: the fallback it moved to, and the model a router picked", async () => {
    // Seen live 2026-09-24: the footer kept showing the chosen model while the auto router billed another.
    const stall = { events: [{ type: "error" as const, error: new ProviderStreamIdleError(180_000) }] };
    const routed = { ...answer("Routed answer."), served: "openrouter/vendor-x/picked" };
    const provider = new ScriptedProvider([stall, stall, routed], ["openrouter/auto"]);
    const { chunks } = await run(provider);

    expect(chunks.filter((chunk) => chunk.type === "model")).toEqual([
      { type: "model", modelId: "primary-model" },
      { type: "model", modelId: "openrouter/auto" },
      { type: "model", modelId: "openrouter/auto", servedModelId: "openrouter/vendor-x/picked" },
    ]);
  });

  it("tells the UI when OpenRouter answered with a model from its own fallback list, not with a dated variant", async () => {
    const fallback = new ScriptedProvider([{ ...answer("From the second model."), served: "vendor-b/second:free" }]);
    const { chunks } = await run(fallback);
    expect(chunks.filter((chunk) => chunk.type === "model").at(-1)).toEqual({
      type: "model",
      modelId: "primary-model",
      servedModelId: "vendor-b/second:free",
    });

    const dated = new ScriptedProvider([{ ...answer("Same model."), served: "primary-model-2026-09-01" }]);
    const again = await run(dated);
    expect(again.chunks.filter((chunk) => chunk.type === "model")).toEqual([
      { type: "model", modelId: "primary-model" },
    ]);
  });

  it("puts an agent built from a key and an OpenRouter URL behind the Free-mode gate, however the URL is written", () => {
    // Review 2026-09-24: Telegram agents (`new Agent(key, url, model)`) and a ":443" URL reached OpenRouter through a
    // raw provider that knew nothing of Free mode, and ran a paid model the user had saved.
    const previous = process.env.SHELRA_MODEL_POLICY;
    process.env.SHELRA_MODEL_POLICY = "free";
    try {
      for (const url of ["https://openrouter.ai/api/v1", "https://openrouter.ai:443/api/v1"]) {
        const agent = new Agent("sk-fake-key-for-tests", url, "anthropic/claude-sonnet-4.5", undefined, {
          cwd: testWorkspace,
          persistSession: false,
        });
        expect(agent.getProviderId(), url).toBe("openrouter");
      }
      const other = new Agent("fake", "https://api.example.test/v1", "some-model", undefined, {
        cwd: testWorkspace,
        persistSession: false,
      });
      expect(other.getProviderId()).not.toBe("openrouter");
    } finally {
      if (previous === undefined) delete process.env.SHELRA_MODEL_POLICY;
      else process.env.SHELRA_MODEL_POLICY = previous;
    }
  });

  it("records the turn in the session trace that `shelra trace` reads", async () => {
    const previousTrace = process.env.SHELRA_TRACE;
    const dir = makeTestWorkspace(joinTestPath(testTmpdir(), "shelra-trace-"));
    process.env.SHELRA_TRACE = dir;
    try {
      const stall = { events: [{ type: "error" as const, error: new ProviderStreamIdleError(180_000) }] };
      const provider = new ScriptedProvider([stall, stall, answer("Answered by the fallback.")], ["fallback-model"]);
      await run(provider, "Explain the project");

      const { listTraces, readTrace } = await import("../utils/session-trace");
      const events = readTrace(listTraces(dir)[0]?.path ?? "");
      expect(events[0]).toMatchObject({ kind: "turn", request: "Explain the project", model: "primary-model" });
      expect(events.filter((event) => event.kind === "model").map((event) => event.model)).toEqual([
        "primary-model",
        "fallback-model",
      ]);
      expect(events.some((event) => event.kind === "notice" && String(event.text).includes("continuing with"))).toBe(
        true,
      );
      expect(events.at(-1)?.kind).toBe("end");
    } finally {
      if (previousTrace === undefined) delete process.env.SHELRA_TRACE;
      else process.env.SHELRA_TRACE = previousTrace;
    }
  });

  it("says what a paid fallback costs when it switches to one", async () => {
    const stall = { events: [{ type: "error" as const, error: new ProviderStreamIdleError(180_000) }] };
    const provider = new ScriptedProvider([stall, stall, answer("Paid answer.")], ["paid-model"]);
    const { text } = await run(provider);

    expect(text).toContain("continuing with paid-model (paid: $3.00 in / $15.00 out per 1M tokens)");
    expect(text).toContain("Paid answer.");
  });

  it("ends a turn Limited, with the time the free allowance comes back, when a Free session has used it up", async () => {
    // Owner, 2026-09-24: in Free mode, no provider that can bill; say "Limited" and when the provider resets.
    const previous = process.env.SHELRA_MODEL_POLICY;
    process.env.SHELRA_MODEL_POLICY = "free";
    try {
      const resetsAt = Date.now() + 3 * 3_600_000;
      const used = new APICallError({
        message: "Rate limit exceeded: free-models-per-day",
        url: "https://example.test/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { "X-RateLimit-Reset": String(resetsAt) },
        responseBody: '{"error":{"message":"Rate limit exceeded: free-models-per-day","code":429}}',
      });
      class OpenRouterLike extends ScriptedProvider {
        override readonly id = "openrouter";
      }
      const provider = new OpenRouterLike([{ events: [], fail: used }]);
      const { chunks, text } = await run(provider);

      const limit = chunks.find((chunk) => chunk.type === "limit") as { limit?: { resetsAt?: string } } | undefined;
      expect(limit?.limit?.resetsAt).toBe(new Date(resetsAt).toISOString());
      expect(text).toContain("[Limited — OpenRouter's free models reached the limit of the free plan; it resets at ");
      expect(text).toContain("Free mode does not continue on providers that can bill.");
      expect(text).toContain("switch to Mixed (ctrl+f) to use paid models");
      expect(text).not.toContain("[Paused");
    } finally {
      if (previous === undefined) delete process.env.SHELRA_MODEL_POLICY;
      else process.env.SHELRA_MODEL_POLICY = previous;
    }
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

  it("keeps the model the user chose when its endpoints only refuse the sampling temperature", async () => {
    // Seen live 2026-09-24: openai/gpt-6-luna-pro takes no `temperature`; with require_parameters OpenRouter
    // answered 404 "No endpoints found that can handle the requested parameters", and the turn left the paid
    // model the user had picked for openrouter/free.
    const refused = apiError(
      404,
      "No endpoints found that can handle the requested parameters. To learn more about provider routing, visit: https://openrouter.ai/docs/guides/routing/provider-selection",
    );
    const provider = new ScriptedProvider(
      [{ events: [], fail: refused }, answer("Answered by the chosen model.")],
      ["openrouter/free"],
    );
    const { text } = await run(provider);

    expect(provider.requests.map((request) => request.modelId)).toEqual(["primary-model", "primary-model"]);
    expect(provider.requests[0]?.temperature).toBe(0.7);
    expect(provider.requests[1]?.temperature).toBeUndefined();
    expect(text).toContain("Answered by the chosen model.");
    expect(text).not.toContain("continuing with openrouter/free");
  });

  it("moves at once to the free router when Free mode refuses a paid model that reached the provider", async () => {
    // A per-mode model or a custom sub-agent's model can name a paid model; in Free mode the provider refuses it,
    // and asking the same model again cannot help.
    const refused = new Error(
      'Model "OpenAI: GPT-6 Luna Pro" is paid, and Free mode uses free models only. Switch to Mixed to use it.',
    );
    const provider = new ScriptedProvider(
      [{ events: [], fail: refused }, answer("Answered for free.")],
      ["openrouter/free"],
    );
    const { text } = await run(provider);

    expect(provider.requests.map((request) => request.modelId)).toEqual(["primary-model", "openrouter/free"]);
    expect(text).toContain("Answered for free.");
  });

  it("sends no temperature to a model whose catalog entry says it takes none", async () => {
    class NoTemperature extends ScriptedProvider {
      override resolveModelRuntime(modelId: string): ProviderModelRuntime {
        const runtime = super.resolveModelRuntime(modelId);
        return { ...runtime, modelInfo: { ...(runtime.modelInfo as ModelInfo), supportsTemperature: false } };
      }
    }
    const provider = new NoTemperature([answer("Answered.")]);
    await run(provider);

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.temperature).toBeUndefined();
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

  it("ends Limited, saying when the allowance resets, when no other provider can take the turn", async () => {
    const openrouter = new ScriptedProvider([{ events: [], fail: quotaSpent() }]);
    const { text } = await run(openrouter);

    expect(openrouter.requests).toHaveLength(1);
    expect(text).toContain("[Limited — ");
    expect(text).not.toContain("[Paused");
  });

  it("answers a key the moved-to provider rejects with its next provider, then the first provider's own model", async () => {
    // Review round 3 (2026-09-24): Groq's model id reached the OpenRouter key fallback, where
    // `openai/gpt-oss-120b` is a paid model, under the free policy.
    const openrouter = new ScriptedProvider([{ events: [], fail: quotaSpent() }]);
    const groq = new ScriptedProvider([{ events: [], fail: apiError(401, "Invalid API Key") }]);
    const gemini = new ScriptedProvider([{ events: [], fail: apiError(401, "API key not valid") }]);
    const secondKey = new ScriptedProvider([answer("Answered on the other OpenRouter key.")]);
    const keyFallbackModels: string[] = [];
    const { text } = await run(openrouter, "Explain the project", (agent) => {
      agent.setProviderFallback(
        credentialFallbackChain([
          async () => ({ provider: groq, modelId: "openai/gpt-oss-120b", label: "Groq" }),
          async () => ({ provider: gemini, modelId: "gemini-2.5-flash", label: "Google Gemini" }),
        ]),
      );
      agent.setCredentialFallback(
        credentialFallbackChain([
          async ({ modelId }) => {
            keyFallbackModels.push(modelId);
            return { provider: secondKey, modelId, label: "the OpenRouter key from KEY_OPENROUTER" };
          },
        ]),
      );
    });

    expect(groq.requests).toHaveLength(1);
    expect(gemini.requests).toHaveLength(1);
    expect(keyFallbackModels).toEqual(["primary-model"]);
    expect(secondKey.requests.map((request) => request.modelId)).toEqual(["primary-model"]);
    expect(text).toContain("Answered on the other OpenRouter key.");
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
