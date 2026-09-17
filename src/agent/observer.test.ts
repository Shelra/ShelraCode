import { describe, expect, it, vi } from "vitest";
import { FakeProvider } from "../providers/fake";
import type { ProviderEvent, ProviderStream, ProviderStreamRequest } from "../providers/types";
import { Agent, type ProcessMessageObserver } from "./agent";

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
  loadTranscript: vi.fn(() => []),
  loadTranscriptState: vi.fn(() => ({ messages: [], seqs: [] })),
  recordCheckpoint: vi.fn(),
  recordUsageEvent: vi.fn(),
  upsertObjectiveIndex: vi.fn(),
  SessionStore: class {},
}));

vi.mock("../hooks/index", () => ({
  executeEventHooks: vi.fn(async () => ({
    blocked: false,
    blockingErrors: [],
    preventContinuation: false,
    additionalContexts: [],
    results: [],
  })),
}));

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

class ObserverProvider extends FakeProvider {
  lastRequest: ProviderStreamRequest | null = null;

  override stream(request: ProviderStreamRequest): ProviderStream {
    this.lastRequest = request;
    const stream = super.stream(request);
    return {
      events: (async function* () {
        request.onStepStart?.(1);
        for await (const event of stream.events) yield event;
        request.onStepFinish?.({ stepNumber: 1, finishReason: "stop", usage: {} });
        request.onFinish?.({});
      })(),
      response: stream.response,
    };
  }
}

class TimeoutProvider extends FakeProvider {
  override stream(_request: ProviderStreamRequest): ProviderStream {
    return {
      events: (async function* () {
        // The provider emitted no model output before timing out.
      })(),
      response: Promise.reject(new DOMException("The model timed out.", "TimeoutError")),
    };
  }
}

/**
 * Reproduces the live 2026-09-17 failure: an upstream provider consumed the model's tool-call
 * tokens and returned an empty "stop" step. Each round here is scripted; an empty round emits no
 * events and resolves with an empty assistant message.
 */
class ScriptedRoundsProvider extends FakeProvider {
  rounds = 0;

  constructor(private readonly script: Array<ProviderEvent[] | "empty">) {
    super("unused");
  }

  override stream(request: ProviderStreamRequest): ProviderStream {
    const round = this.script[this.rounds] ?? this.script.at(-1) ?? "empty";
    this.rounds += 1;
    const events = round === "empty" ? [] : round;
    return {
      events: (async function* () {
        request.onStepStart?.(1);
        yield* events;
        request.onStepFinish?.({ stepNumber: 1, finishReason: "stop", usage: { outputTokens: 47 } });
        request.onFinish?.({});
      })(),
      response: Promise.resolve({
        messages: round === "empty" ? [{ role: "assistant", content: "" }] : [{ role: "assistant", content: "ok" }],
      }),
    };
  }
}

describe("Agent process observer", () => {
  it("publishes host events and completes a turn that changed nothing", async () => {
    const observed: string[] = [];
    const observer: ProcessMessageObserver = {
      onStepStart: (event) => observed.push(`step:start:${event.stepNumber}`),
      onStepFinish: (event) => observed.push(`step:finish:${event.stepNumber}:${event.finishReason}`),
      onStatus: (event) => observed.push(`status:${event.stage}`),
    };
    const agent = new Agent(undefined, undefined, "observer-test-model", 2, {
      provider: new ObserverProvider("Here is what I found."),
      persistSession: false,
    });

    for await (const _chunk of agent.processMessage("Create a small page in this repository", observer)) {
      // Consume the real generator so callbacks and kernel transitions execute.
    }

    expect(observed).toContain("step:start:1");
    expect(observed).toContain("step:finish:1:stop");
    expect(observed).toContain("status:model");
    expect(observed).not.toContain("status:research");
    expect(agent.getKernelState()).toMatchObject({
      objective: "Create a small page in this repository",
      phase: "complete",
    });
    expect(agent.getContextSummary()).toMatchObject({
      classification: { kind: "coding" },
    });
  });

  it("leaves a turn that changed files at review once it verified them with the project's own runner", async () => {
    const provider = new ObserverProvider("Implemented and verified.", [
      toolCallEvent("w1", "write_file", { path: "src/page.ts", content: "export {}" }),
      toolResultEvent("w1", "write_file", {
        success: true,
        output: "Created src/page.ts",
        diff: { filePath: "src/page.ts", additions: 1, removals: 0, patch: "", isNew: true },
      }),
      toolCallEvent("b1", "bash", { command: "bun test" }),
      toolResultEvent("b1", "bash", { success: true, output: "1 pass" }, { command: "bun test" }),
      { type: "text-delta", text: "Implemented and verified." },
    ]);
    const agent = new Agent(undefined, undefined, "observer-test-model", 2, { provider, persistSession: false });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a small page in this repository")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(agent.getKernelState()).toMatchObject({ phase: "review", mutations: ["src/page.ts"] });
    expect(chunks.some((chunk) => chunk.content?.includes("Not verified"))).toBe(false);
    expect(agent.getVerificationStatus().evidenceSummary).toEqual(["bash: bun test"]);
  });

  it("gives a conversational-looking coding request the full tool set", async () => {
    const provider = new ObserverProvider("Looking.");
    const agent = new Agent(undefined, undefined, "observer-test-model", 2, { provider, persistSession: false });

    for await (const _chunk of agent.processMessage("Make the tests pass")) {
      // consume
    }

    const tools = Object.keys(provider.lastRequest?.tools ?? {});
    expect(tools).toEqual(expect.arrayContaining(["bash", "read_file", "grep", "edit_file", "write_file"]));
    expect(tools).not.toContain("computer_screenshot");
    expect(tools).not.toContain("schedule_create");
    expect(tools).not.toContain("wallet_info");
    expect(provider.lastRequest?.system).toContain("HOW TO WORK");
  });

  it("retries a model step that produced neither text nor a tool call instead of ending the turn", async () => {
    const provider = new ScriptedRoundsProvider(["empty", [{ type: "text-delta", text: "Done after retry." }]]);
    const agent = new Agent(undefined, undefined, "observer-test-model", 2, { provider, persistSession: false });

    const content: string[] = [];
    for await (const chunk of agent.processMessage("Summarize the repository layout")) {
      if (chunk.type === "content" && chunk.content) content.push(chunk.content);
    }

    expect(provider.rounds).toBe(2);
    expect(content.join("")).toContain("Done after retry.");
    expect(agent.getKernelState()?.observations.some((line) => line.includes("no output"))).toBe(true);
  });

  it("treats tool-call markup returned as text as a failed step and retries", async () => {
    const provider = new ScriptedRoundsProvider([
      [
        {
          type: "text-delta",
          text: "Let me look.\n<function=read_file>\n<parameter=path>\nsrc/index.ts\n</parameter>\n</function>",
        },
      ],
      [{ type: "text-delta", text: "Recovered after the retry." }],
    ]);
    const agent = new Agent(undefined, undefined, "observer-test-model", 2, { provider, persistSession: false });

    const content: string[] = [];
    for await (const chunk of agent.processMessage("Summarize the repository layout")) {
      if (chunk.type === "content" && chunk.content) content.push(chunk.content);
    }

    expect(provider.rounds).toBe(2);
    expect(content.join("")).toContain("Recovered after the retry.");
    expect(agent.getKernelState()?.observations.some((line) => line.includes("tool-call markup"))).toBe(true);
  });

  it("ends visibly, not silently, when the model stays empty after every retry", async () => {
    const provider = new ScriptedRoundsProvider(["empty", "empty", "empty"]);
    const agent = new Agent(undefined, undefined, "observer-test-model", 2, { provider, persistSession: false });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Summarize the repository layout")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(provider.rounds).toBe(3);
    expect(chunks.find((chunk) => chunk.content?.includes("[No response"))).toBeDefined();
    expect(chunks.at(-1)).toEqual({ type: "done" });
    expect(agent.getKernelState()).toMatchObject({ phase: "blocked" });
  });

  it("surfaces a final provider timeout instead of treating the turn as complete", async () => {
    const agent = new Agent(undefined, undefined, "timeout-test-model", undefined, {
      provider: new TimeoutProvider(),
      persistSession: false,
    });
    const chunks: Array<{ type: string; content?: string }> = [];

    for await (const chunk of agent.processMessage("Answer this without making changes")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(chunks.find((chunk) => chunk.type === "error")?.content).toContain("stopped responding");
  });
});
