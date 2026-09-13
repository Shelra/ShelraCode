import { OPENROUTER_BASE_URL } from "../models/openrouter";
import { catalogModelId, resolveCatalogModel } from "../models/routing";
import { type CatalogEntry, catalogEntryToModelInfo } from "../models/types";
import { createOpenAICompatibleProvider } from "../runtimes/local-provider";
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
}

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

  constructor(apiKey: string, options: OpenRouterProviderOptions = {}) {
    this.defaultModelId = canonicalModelId(options.modelId ?? "openrouter/free");
    this.entries = options.entries ?? [];
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
        transformRequestBody: (body) => buildOpenRouterRequestBody(body, options),
      },
    );
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
    return this.transport.stream({ ...request, modelId: openRouterWireModelId(request.modelId) });
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
