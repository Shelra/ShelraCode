import type { FetchFunction } from "@ai-sdk/provider-utils";
import { OPENROUTER_BASE_URL } from "../models/openrouter";
import { catalogModelId, resolveCatalogModel } from "../models/routing";
import { type CatalogEntry, catalogEntryToModelInfo } from "../models/types";
import { createOpenAICompatibleProvider } from "../runtimes/local-provider";
import { loadQuarantinedProviders, recordQuarantinedProvider } from "./provider-quarantine";
import type {
  ProviderAdapter,
  ProviderModelRuntime,
  ProviderStream,
  ProviderStreamRequest,
  ProviderStructuredRequest,
  ProviderStructuredResult,
  ProviderTextRequest,
  ProviderTextResult,
  ProviderToolContext,
} from "./types";

const OPENROUTER_ROUTER_IDS = new Set(["openrouter/free", "openrouter/auto", "openrouter/auto-beta"]);

export interface OpenRouterProviderOptions {
  modelId?: string;
  entries?: readonly CatalogEntry[];
  baseURL?: string;
  maxRetries?: number;
  appTitle?: string;
  httpReferer?: string;
  /** Canonical model ids sent as OpenRouter's server-side provider fallbacks. */
  fallbackModels?: readonly string[];
  providerOrder?: readonly string[];
  allowProviderFallbacks?: boolean;
  dataCollection?: "allow" | "deny";
  zeroDataRetention?: boolean;
  /** Reject provider endpoints that cannot honor requested tool/response parameters. */
  requireParameters?: boolean;
  /** Upstream providers to exclude from routing (OpenRouter `provider.ignore`). */
  ignoreProviders?: readonly string[];
  /** Injectable transport, for tests. */
  fetch?: FetchFunction;
  /** Durable quarantine store path; `null` disables persistence (tests). */
  quarantineStorePath?: string | null;
}

/**
 * Upstream providers that returned a content-less "stop" step for this process are excluded
 * from later requests. OpenRouter routes one model id to several upstreams of uneven quality;
 * one of them was observed (2026-09-17, Novita serving qwen3-coder-30b) consuming the model's
 * tool-call tokens and returning an empty delta, which no prompt can fix. The cap keeps a model
 * that is simply broken everywhere from locking itself out of every provider.
 */
const MAX_QUARANTINED_PROVIDERS = 4;

function canonicalModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (OPENROUTER_ROUTER_IDS.has(trimmed) || trimmed.startsWith("openrouter/")) return trimmed;
  return catalogModelId(trimmed);
}

/** Converts Shelra's canonical id back to the provider-scoped OpenRouter id. */
export function openRouterWireModelId(modelId: string): string {
  const canonical = canonicalModelId(modelId);
  if (OPENROUTER_ROUTER_IDS.has(canonical)) return canonical;
  return canonical.slice("openrouter/".length);
}

export function buildOpenRouterRequestBody(
  body: Record<string, unknown>,
  options: Pick<
    OpenRouterProviderOptions,
    | "fallbackModels"
    | "providerOrder"
    | "allowProviderFallbacks"
    | "dataCollection"
    | "zeroDataRetention"
    | "requireParameters"
    | "ignoreProviders"
  >,
): Record<string, unknown> {
  const models = options.fallbackModels
    ?.map((modelId) => openRouterWireModelId(modelId))
    .filter((modelId, index, all) => modelId && all.indexOf(modelId) === index)
    .slice(0, 3);
  const provider = {
    ...(options.providerOrder && options.providerOrder.length > 0 ? { order: [...options.providerOrder] } : {}),
    ...(options.allowProviderFallbacks === undefined ? {} : { allow_fallbacks: options.allowProviderFallbacks }),
    ...(options.dataCollection ? { data_collection: options.dataCollection } : {}),
    ...(options.zeroDataRetention === undefined ? {} : { zdr: options.zeroDataRetention }),
    ...(options.requireParameters === undefined ? {} : { require_parameters: options.requireParameters }),
    ...(options.ignoreProviders && options.ignoreProviders.length > 0 ? { ignore: [...options.ignoreProviders] } : {}),
  };
  return {
    ...body,
    ...(models && models.length > 0 ? { models } : {}),
    ...(Object.keys(provider).length > 0 ? { provider } : {}),
  };
}

function fallbackModelInfo(modelId: string) {
  return {
    id: modelId,
    name: openRouterWireModelId(modelId),
    contextWindow: 8_192,
    inputPrice: 0,
    outputPrice: 0,
    pricingKnown: true,
    reasoning: false,
    description: "OpenRouter model metadata is not available yet.",
    supportsMaxOutputTokens: true,
    capabilityConfidence: "unknown" as const,
    category: "cloud" as const,
    provider: "openrouter",
    runtimeKind: "cloud:openrouter",
  };
}

/** OpenRouter adapter: only this module knows canonical ids need provider-id translation. */
export class OpenRouterProviderAdapter implements ProviderAdapter {
  readonly id = "openrouter";
  readonly supportsBatch = false;
  readonly defaultModelId: string;
  private readonly entries: readonly CatalogEntry[];
  private readonly transport: ProviderAdapter;
  private readonly quarantined = new Set<string>();
  private readonly quarantineStorePath: string | null | undefined;
  private lastUpstreamProvider: string | null = null;

  constructor(apiKey: string, options: OpenRouterProviderOptions = {}) {
    this.defaultModelId = canonicalModelId(options.modelId ?? "openrouter/free");
    this.entries = options.entries ?? [];
    this.quarantineStorePath = options.quarantineStorePath;
    if (this.quarantineStorePath !== null) {
      for (const entry of loadQuarantinedProviders(this.defaultModelId, {
        ...(this.quarantineStorePath ? { path: this.quarantineStorePath } : {}),
      })) {
        if (this.quarantined.size < MAX_QUARANTINED_PROVIDERS) this.quarantined.add(entry.provider);
      }
    }
    const selectedEntry = resolveCatalogModel(this.entries, this.defaultModelId);
    this.transport = createOpenAICompatibleProvider(
      apiKey,
      options.baseURL ?? OPENROUTER_BASE_URL,
      openRouterWireModelId(this.defaultModelId),
      {
        providerId: "openrouter-transport",
        maxRetries: options.maxRetries ?? 2,
        headers: {
          ...(options.httpReferer ? { "HTTP-Referer": options.httpReferer } : {}),
          ...(options.appTitle ? { "X-OpenRouter-Title": options.appTitle } : { "X-OpenRouter-Title": "ShelraCode" }),
        },
        supportsStructuredOutputs:
          selectedEntry?.capabilities.structuredOutput ?? this.defaultModelId === "openrouter/free",
        ...(selectedEntry ? { modelInfo: catalogEntryToModelInfo(selectedEntry) } : {}),
        fetch: this.sniffingFetch(options.fetch),
        transformRequestBody: (body) =>
          buildOpenRouterRequestBody(body, {
            ...options,
            ignoreProviders: [...(options.ignoreProviders ?? []), ...this.quarantined],
          }),
      },
    );
  }

  /** Reads the upstream provider name from the response stream without consuming it. */
  private sniffingFetch(inner: FetchFunction | undefined): FetchFunction {
    const base: FetchFunction = inner ?? ((input, init) => fetch(input, init));
    return async (input, init) => {
      const response = await base(input, init);
      if (!response.body) return response;
      const [forApp, forSniff] = response.body.tee();
      void this.readUpstreamProvider(forSniff);
      return new Response(forApp, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  }

  private async readUpstreamProvider(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const match = /"provider"\s*:\s*"([^"]+)"/u.exec(buffer);
        if (match?.[1]) {
          this.lastUpstreamProvider = match[1];
          await reader.cancel();
          return;
        }
        if (buffer.length > 65_536) buffer = buffer.slice(-4_096);
      }
    } catch {
      // Sniffing must never affect the real response.
    }
  }

  private quarantineUpstream(reason: string): void {
    const provider = this.lastUpstreamProvider;
    if (!provider || this.quarantined.has(provider) || this.quarantined.size >= MAX_QUARANTINED_PROVIDERS) return;
    this.quarantined.add(provider);
    if (this.quarantineStorePath !== null) {
      recordQuarantinedProvider(
        { model: this.defaultModelId, provider, reason },
        this.quarantineStorePath ? { path: this.quarantineStorePath } : {},
      );
    }
    if (process.env.SHELRA_DEBUG_STREAM) {
      process.stderr.write(`[openrouter] quarantined upstream provider ${provider}: ${reason}\n`);
    }
  }

  routingNotes(): string[] {
    return [...this.quarantined].map((provider) => `quarantined upstream provider ${provider} (content-less step)`);
  }

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    const canonical = canonicalModelId(modelId);
    const entry = resolveCatalogModel(this.entries, canonical);
    const modelInfo = entry ? catalogEntryToModelInfo(entry) : fallbackModelInfo(canonical);
    return {
      modelId: canonical,
      modelInfo: { ...modelInfo, id: canonical },
    };
  }

  stream(request: ProviderStreamRequest): ProviderStream {
    let stepProducedOutput = false;
    const inner = this.transport.stream({
      ...request,
      modelId: openRouterWireModelId(request.modelId),
      onStepStart: (stepNumber) => {
        stepProducedOutput = false;
        request.onStepStart?.(stepNumber);
      },
      onStepFinish: (event) => {
        // A "stop" step that generated tokens but delivered neither text nor a tool call is an
        // upstream that mangled the model's output; route around it for the rest of the process.
        if (!stepProducedOutput && event.finishReason === "stop" && (event.usage.outputTokens ?? 0) > 0) {
          this.quarantineUpstream(`content-less step with ${event.usage.outputTokens} completion tokens`);
        }
        request.onStepFinish?.(event);
      },
    });
    return {
      events: (async function* () {
        for await (const event of inner.events) {
          if ((event.type === "text-delta" && event.text) || event.type === "tool-call") stepProducedOutput = true;
          yield event;
        }
      })(),
      response: inner.response,
    };
  }

  generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    return this.transport
      .generateText({ ...request, modelId: openRouterWireModelId(request.modelId) })
      .then((result) => ({
        ...result,
        modelId: canonicalModelId(result.modelId),
      }));
  }

  generateStructured(request: ProviderStructuredRequest): Promise<ProviderStructuredResult> {
    if (!this.transport.generateStructured) {
      return Promise.reject(new Error("The OpenRouter transport does not support structured output."));
    }
    return this.transport
      .generateStructured({ ...request, modelId: openRouterWireModelId(request.modelId) })
      .then((result) => ({
        ...result,
        modelId: canonicalModelId(result.modelId),
      }));
  }

  getToolContext(): ProviderToolContext {
    return this.transport.getToolContext();
  }
}

export function createOpenRouterProvider(apiKey: string, options: OpenRouterProviderOptions = {}): ProviderAdapter {
  return new OpenRouterProviderAdapter(apiKey, options);
}
