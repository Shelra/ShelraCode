import { describe, expect, it, vi } from "vitest";
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

vi.mock("../storage/index", () => ({
  appendCompaction: vi.fn(),
  appendMessages: vi.fn(() => []),
  appendSystemMessage: vi.fn(() => 0),
  buildChatEntries: vi.fn(() => []),
  getNextMessageSequence: vi.fn(() => 0),
  getSessionTotalTokens: vi.fn(() => 0),
  loadTranscript: vi.fn(() => []),
  loadTranscriptState: vi.fn(() => ({ messages: [], seqs: [] })),
  recordUsageEvent: vi.fn(),
  SessionStore: class {},
}));

import { Agent } from "./agent";

class ContextFailureProvider implements ProviderAdapter {
  readonly id = "context-test";
  readonly defaultModelId = "context-test-model";
  readonly requests: ProviderStreamRequest[] = [];
  private attempts = 0;

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return {
      modelId,
      modelInfo: {
        id: modelId,
        name: "Context test model",
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

  stream(request: ProviderStreamRequest): ProviderStream {
    this.requests.push(request);
    this.attempts += 1;
    const events: ProviderEvent[] =
      this.attempts === 1
        ? [{ type: "error", error: new Error("Context size has been exceeded.") }]
        : [{ type: "text-delta", text: "Recovered." }];
    return {
      events: (async function* () {
        yield* events;
      })(),
      response: Promise.resolve({ messages: [{ role: "assistant", content: "Recovered." }] }),
    };
  }

  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    return { text: "Summary.", modelId: request.modelId };
  }

  getToolContext(): ProviderToolContext {
    return {};
  }
}

describe("agent context overflow recovery", () => {
  it("recovers from the llama context-size error without exposing it", async () => {
    const provider = new ContextFailureProvider();
    const agent = new Agent(undefined, undefined, "context-test-model", undefined, {
      persistSession: false,
      provider,
    });
    const prompt = `Fix src/index.ts.\n${"pasted source content ".repeat(8_000)}`;
    const chunks = [];

    for await (const chunk of agent.processMessage(prompt)) chunks.push(chunk);

    expect(chunks).toEqual([{ type: "content", content: "Recovered." }, { type: "done" }]);
    expect(provider.requests).toHaveLength(2);
    const firstMessage = provider.requests[0]?.messages[0] as { content?: unknown } | undefined;
    expect(typeof firstMessage?.content).toBe("string");
    expect(JSON.stringify(provider.requests[0]?.messages).length).toBeLessThan(prompt.length);
    expect(provider.requests[1]?.tools).toEqual({});
    expect(JSON.stringify(provider.requests[1]?.messages).length).toBeLessThan(prompt.length);
  });
});
