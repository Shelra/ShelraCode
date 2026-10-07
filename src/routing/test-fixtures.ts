import { APICallError } from "@ai-sdk/provider";
import type { CatalogEntry } from "../models/types";
import type { ProviderConfig, ProviderDefinition, ResolveDeps } from "../providers/registry";
import type { ProviderAdapter, ProviderEvent, ProviderStreamRequest } from "../providers/types";

/** Builders and fakes shared by the routing tests. Not imported by product code. */

export interface EntryOptions {
  provider: string;
  providerModelId: string;
  basis?: "published-zero" | "free-tier" | "unverified";
  free?: boolean;
  prompt?: number;
  completion?: number;
  pricingKnown?: boolean;
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  structured?: boolean;
  context?: number;
  router?: boolean;
  upstream?: string;
  confidence?: CatalogEntry["contextConfidence"];
}

export function entry(options: EntryOptions): CatalogEntry {
  const free = options.free ?? false;
  return {
    id: `${options.provider}/${options.providerModelId}`,
    category: "cloud",
    provider: options.provider,
    name: options.providerModelId,
    contextWindow: options.context ?? 128_000,
    contextConfidence: options.confidence ?? "declared",
    capabilities: {
      tools: options.tools ?? true,
      reasoning: options.reasoning ?? false,
      vision: options.vision ?? false,
      structuredOutput: options.structured ?? true,
    },
    cost: {
      prompt: options.prompt ?? 0,
      completion: options.completion ?? 0,
      free,
      pricingKnown: options.pricingKnown ?? true,
      ...(options.basis ? { basis: options.basis } : {}),
    },
    state: {
      kind: "cloud",
      providerModelId: options.providerModelId,
      apiKeyConfigured: true,
      notes: [],
      ...(options.router ? { router: true } : {}),
      ...(options.upstream ? { upstream: options.upstream } : {}),
    },
  };
}

/** A model the provider's own pricing says is free (OpenRouter's `:free` variants). */
export const publishedFree = (provider: string, id: string, extra: Partial<EntryOptions> = {}) =>
  entry({ provider, providerModelId: id, free: true, basis: "published-zero", ...extra });
/** A model priced above zero. */
export const paid = (provider: string, id: string, extra: Partial<EntryOptions> = {}) =>
  entry({ provider, providerModelId: id, prompt: 0.000003, completion: 0.000015, ...extra });
/** A model on a free plan that a billed key would exceed. */
export const freeTier = (provider: string, id: string, extra: Partial<EntryOptions> = {}) =>
  entry({ provider, providerModelId: id, free: true, basis: "free-tier", ...extra });
/** A gateway's model: its catalog's zero is not a guarantee. */
export const gatewayModel = (id: string, extra: Partial<EntryOptions> = {}) =>
  entry({ provider: "omniroute", providerModelId: id, basis: "unverified", pricingKnown: false, ...extra });

export const NO_ENV: NodeJS.ProcessEnv = {};

export function resolveDepsFor(configured: readonly string[]): () => ResolveDeps {
  return () => ({
    env: {},
    storedCredential: (id) => (configured.includes(id) ? { apiKey: `fake-key-${id}` } : undefined),
    settings: {},
  });
}

export type FakeMode =
  | "ok"
  | "rate-limit"
  | "quota"
  | "server-error"
  | "offline"
  | "unauthorized"
  | "charged"
  | "garbage";

export class FakeControl {
  mode: FakeMode = "ok";
  /** Calls the fake adapter received, in order. */
  readonly calls: Array<{ kind: "stream" | "text" | "structured"; modelId: string }> = [];
  /** Cost the fake reports per step when `mode` is "charged", USD. */
  cost = 0.01;
  /** Error to throw after some output instead of before it. */
  failAfterOutput = false;
  discoveryFails = false;
  discoveryDelayMs = 0;
  discoveryCalls = 0;

  failure(): APICallError | Error {
    const base = { url: "https://fake.invalid/v1/chat/completions", requestBodyValues: {} };
    switch (this.mode) {
      case "rate-limit":
        return new APICallError({
          ...base,
          message: "Too many requests",
          statusCode: 429,
          responseHeaders: { "retry-after": "30" },
          responseBody: '{"error":{"message":"Rate limit reached"}}',
        });
      case "quota":
        return new APICallError({
          ...base,
          message: "Quota exceeded: requests per day",
          statusCode: 429,
          responseHeaders: { "retry-after": "7200" },
          responseBody: '{"error":{"message":"free-models-per-day quota exceeded"}}',
        });
      case "server-error":
        return new APICallError({ ...base, message: "Internal Server Error", statusCode: 500 });
      case "unauthorized":
        return new APICallError({ ...base, message: "Invalid API key", statusCode: 401 });
      case "offline":
        return new Error("fetch failed: ECONNREFUSED");
      default:
        return new Error("garbage payload");
    }
  }
}

function fakeAdapter(providerId: string, control: FakeControl): ProviderAdapter {
  const prefix = `${providerId}/`;
  return {
    id: providerId,
    defaultModelId: `${prefix}default`,
    resolveModelRuntime: (modelId) => ({ modelId, modelInfo: undefined }),
    getToolContext: () => ({}),
    fallbackModelIds: () => [],
    stream(request: ProviderStreamRequest) {
      control.calls.push({ kind: "stream", modelId: request.modelId });
      const failing = control.mode !== "ok" && control.mode !== "charged";
      const events = (async function* (): AsyncGenerator<ProviderEvent> {
        if (failing && !control.failAfterOutput) throw control.failure();
        yield { type: "text-delta", text: "hello" };
        if (failing) throw control.failure();
        request.onStepFinish?.({
          stepNumber: 1,
          finishReason: "stop",
          usage: {
            inputTokens: 3,
            outputTokens: 2,
            ...(control.mode === "charged" ? { costUsdTicks: Math.round(control.cost * 1_000_000) } : {}),
          },
        });
      })();
      const response = failing
        ? Promise.reject(control.failure())
        : Promise.resolve({ messages: [] as readonly unknown[], usage: { inputTokens: 3, outputTokens: 2 } });
      response.catch(() => undefined);
      return { events, response };
    },
    async generateText(request) {
      control.calls.push({ kind: "text", modelId: request.modelId });
      if (control.mode !== "ok" && control.mode !== "charged") throw control.failure();
      return { text: "ok", modelId: request.modelId };
    },
    async generateStructured(request) {
      control.calls.push({ kind: "structured", modelId: request.modelId });
      if (control.mode !== "ok" && control.mode !== "charged") throw control.failure();
      return { data: {}, text: "{}", modelId: request.modelId };
    },
  };
}

export function fakeDefinition(
  id: string,
  models: readonly CatalogEntry[],
  control: FakeControl,
  extra: Partial<ProviderDefinition> = {},
): ProviderDefinition {
  return {
    id,
    name: id.toUpperCase(),
    canBill: true,
    setupHint: `configure ${id}`,
    fields: [{ name: "apiKey", label: `${id} key`, secret: true }],
    resolveConfigs: (deps): ProviderConfig[] =>
      deps.storedCredential(id)
        ? [
            {
              providerId: id,
              baseURL: `https://${id}.invalid/v1`,
              credential: deps.storedCredential(id),
              source: "test",
            },
          ]
        : [],
    async discoverModels(_config, context) {
      control.discoveryCalls += 1;
      if (control.discoveryDelayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, control.discoveryDelayMs);
          context.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("discovery aborted"));
          });
        });
      }
      if (control.discoveryFails) throw new Error("catalog unavailable");
      return models.map((model) => ({ ...model }));
    },
    createAdapter: () => fakeAdapter(id, control),
    ...extra,
  };
}

/** Drains a stream; returns the events and the error the stream or its response ended with, if any. */
export async function drain(stream: { events: AsyncIterable<ProviderEvent>; response: Promise<unknown> }): Promise<{
  events: ProviderEvent[];
  error?: unknown;
}> {
  const events: ProviderEvent[] = [];
  // The Agent guards the response the same way: an interrupted round never awaits it.
  stream.response.catch(() => undefined);
  try {
    for await (const event of stream.events) {
      events.push(event);
      if (event.type === "error") return { events, error: event.error };
    }
    await stream.response;
    return { events };
  } catch (error) {
    return { events, error };
  }
}
