import type {
  ProviderAdapter,
  ProviderEvent,
  ProviderModelRuntime,
  ProviderStream,
  ProviderStreamRequest,
  ProviderTextRequest,
  ProviderTextResult,
  ProviderToolContext,
} from "./types";

/** Deterministic provider for harness and adapter tests; it performs no I/O. */
export class FakeProvider implements ProviderAdapter {
  readonly id = "fake";
  readonly events: ProviderEvent[];
  readonly responseText: string;

  constructor(responseText = "ok", events: ProviderEvent[] = []) {
    this.responseText = responseText;
    this.events = events.length > 0 ? events : [{ type: "text-delta", text: responseText }];
  }

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return {
      modelId,
      modelInfo: {
        id: modelId,
        name: "Deterministic fake model",
        contextWindow: 32_768,
        inputPrice: 0,
        outputPrice: 0,
        reasoning: false,
        description: "Test-only provider",
        supportsClientTools: true,
      },
    };
  }

  stream(_request: ProviderStreamRequest): ProviderStream {
    const events = this.events;
    return {
      events: (async function* () {
        for (const event of events) yield event;
      })(),
      response: Promise.resolve({ messages: [{ role: "assistant", content: this.responseText }] }),
    };
  }

  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    return { text: this.responseText, modelId: request.modelId };
  }

  getToolContext(): ProviderToolContext {
    return {};
  }
}
