import { describe, expect, it, vi } from "vitest";
import { FakeProvider } from "../providers/fake";
import type { ProviderStream, ProviderStreamRequest } from "../providers/types";
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

class ObserverProvider extends FakeProvider {
  override stream(request: ProviderStreamRequest): ProviderStream {
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

describe("Agent process observer", () => {
  it("publishes host events and leaves coding turns at review", async () => {
    const observed: string[] = [];
    const observer: ProcessMessageObserver = {
      onStepStart: (event) => observed.push(`step:start:${event.stepNumber}`),
      onStepFinish: (event) => observed.push(`step:finish:${event.stepNumber}:${event.finishReason}`),
      onResearch: (event) => observed.push(`research:${event.provider}:${event.sourceCount}`),
    };
    const agent = new Agent(undefined, undefined, "observer-test-model", 2, {
      provider: new ObserverProvider("Implemented."),
      persistSession: false,
      webResearch: async (query) => ({
        success: false,
        query,
        provider: "unavailable",
        sources: [],
        output: "",
        error: "test fixture",
      }),
    });

    for await (const _chunk of agent.processMessage("Create a small page in this repository", observer)) {
      // Consume the real generator so callbacks and kernel transitions execute.
    }

    expect(observed).toContain("research:unavailable:0");
    expect(observed).toContain("step:start:1");
    expect(observed).toContain("step:finish:1:stop");
    expect(agent.getKernelState()).toMatchObject({
      objective: "Create a small page in this repository",
      phase: "review",
    });
    expect(agent.getContextSummary()).toMatchObject({
      classification: { kind: "coding", toolPolicy: "mutate" },
    });
  });
});
