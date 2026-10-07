import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { CatalogEntry } from "../models/types";
import { createOpenAICompatibleProvider } from "../runtimes/local-provider";
import { withCanonicalIds } from "./canonical-adapter";
import type { AdapterContext, DiscoverContext, ProviderConfig, ServedRoute } from "./registry";
import type { ProviderAdapter, ProviderStream, ProviderStreamRequest } from "./types";

/**
 * OmniRoute (https://github.com/diegosouzapw/OmniRoute): a local OpenAI-compatible gateway in front of many
 * providers. Verified against its documentation, 2026-10-06: `GET /v1/models` (`?prefix=canonical` lists each model
 * once as `provider/model`), `POST /v1/chat/completions`, Bearer keys (optional on a keyless install), and the
 * response headers `X-OmniRoute-Provider`, `X-OmniRoute-Model` and `X-OmniRoute-Response-Cost`.
 *
 * Not verified, so not relied on: a price or a free flag on a model entry, a quota or health endpoint. Its
 * `auto/…:free` aliases and category filters fail open when no candidate matches, which can reach a paid provider, so
 * no OmniRoute alias is ever a Free candidate (see `classifyFreeEligibility`): only a concrete `provider/model` the
 * user vouched for is, and every answer's headers are checked afterwards.
 */

export const OMNIROUTE_PROVIDER_ID = "omniroute";
export const OMNIROUTE_BASE_URL_ENV = "OMNIROUTE_BASE_URL";
/** Where a local OmniRoute listens by default. Shown as a hint; never probed unless configured. */
export const OMNIROUTE_DEFAULT_BASE_URL = "http://localhost:20128/v1";
/** A local gateway that does not answer in this long is treated as offline for this refresh. */
export const OMNIROUTE_DISCOVERY_TIMEOUT_MS = 3_000;

const MAX_MODELS = 5_000;
const REASONING = /gpt-oss|qwq|deepseek-r1|qwen3|gemini-(?:2\.5|3)|reason|think|\br1\b|magistral|kimi-k2|claude/i;
const VISION = /gemini|vision|llama-4|pixtral|gemma-3|qwen.*vl|claude|gpt-4o|gpt-5/i;
const NOT_CHAT = /embed|whisper|tts|rerank|moderation|image|imagen|veo|transcri|audio|ocr/i;

/** `http://localhost:20128` and `http://localhost:20128/v1/` both name the same API. */
export function normalizeOmniRouteBaseURL(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/u, "");
  try {
    const url = new URL(trimmed);
    return url.pathname === "" || url.pathname === "/" ? `${trimmed}/v1` : trimmed;
  } catch {
    return trimmed;
  }
}

/** Accepts an http(s) URL only; anything else is not an endpoint. */
export function isValidOmniRouteBaseURL(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function positive(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function priceOf(pricing: Record<string, unknown> | null, ...names: string[]): number | undefined {
  if (!pricing) return undefined;
  for (const name of names) {
    const value = pricing[name];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

/** An alias or a combo: it picks the model serving each request, so what it costs and where it goes is not its own. */
export function isOmniRouteRouterId(id: string, ownedBy?: string): boolean {
  const lower = id.trim().toLowerCase();
  if (lower === "auto" || lower.startsWith("auto/") || lower.startsWith("auto:")) return true;
  const owner = ownedBy?.trim().toLowerCase();
  return owner === "combo" || owner === "auto" || owner === "omniroute";
}

/** The provider a concrete `provider/model` id forwards to; undefined for a bare id or a router. */
export function omniRouteUpstream(id: string, ownedBy?: string): string | undefined {
  if (isOmniRouteRouterId(id, ownedBy)) return undefined;
  const slash = id.indexOf("/");
  if (slash <= 0) return undefined;
  return id.slice(0, slash).trim().toLowerCase();
}

/** Reads a `/v1/models` body into catalog entries. Tolerant: an item it cannot read is skipped, never fatal. */
export function parseOmniRouteModels(body: unknown, fetchedAt: string): CatalogEntry[] {
  const data = record(body)?.data;
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const raw of data.slice(0, MAX_MODELS)) {
    const item = record(raw);
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!item || !id || seen.has(id) || NOT_CHAT.test(id)) continue;
    seen.add(id);
    const ownedBy = typeof item.owned_by === "string" ? item.owned_by : undefined;
    const router = isOmniRouteRouterId(id, ownedBy);
    const upstream = omniRouteUpstream(id, ownedBy);
    const context = positive(
      item.context_length ?? item.context_window ?? item.max_context_length ?? item.contextWindow,
    );
    const pricing = record(item.pricing);
    const prompt = priceOf(pricing, "prompt", "input");
    const completion = priceOf(pricing, "completion", "output");
    const pricingKnown = prompt !== undefined && completion !== undefined;
    entries.push({
      id: `${OMNIROUTE_PROVIDER_ID}/${id}`,
      category: "cloud",
      provider: OMNIROUTE_PROVIDER_ID,
      name: id,
      description: router ? "OmniRoute routing alias: it chooses the model that serves each request." : undefined,
      contextWindow: context ?? 32_768,
      contextConfidence: context ? "declared" : "fallback",
      capabilities: {
        tools: true,
        reasoning: REASONING.test(id),
        vision: VISION.test(id) || item.supports_vision === true,
        ...(item.supports_structured_output === true ? { structuredOutput: true } : {}),
      },
      cost: {
        prompt: prompt ?? 0,
        completion: completion ?? 0,
        // A zero from a gateway is not a guarantee (subscription plans read as $0), so it never marks a model free.
        free: false,
        pricingKnown,
        basis: "unverified",
      },
      state: {
        kind: "cloud",
        providerModelId: id,
        apiKeyConfigured: true,
        notes: router ? ["routing alias"] : upstream ? [`forwards to ${upstream}`] : [],
        ...(router ? { router: true } : {}),
        ...(upstream ? { upstream } : {}),
      },
      fetchedAt,
    });
  }
  return entries;
}

function timeoutSignal(parent: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function authHeaders(config: ProviderConfig): Record<string, string> {
  return config.credential?.apiKey ? { Authorization: `Bearer ${config.credential.apiKey}` } : {};
}

/** Lists OmniRoute's models, bounded. Throws (never hangs) when it is offline, refuses the key or answers nonsense. */
export async function fetchOmniRouteCatalog(
  config: ProviderConfig,
  context: DiscoverContext = {},
  timeoutMs = OMNIROUTE_DISCOVERY_TIMEOUT_MS,
): Promise<CatalogEntry[]> {
  const fetchedAt = new Date((context.now ?? Date.now)()).toISOString();
  const response = await (context.fetch ?? fetch)(`${config.baseURL}/models?prefix=canonical`, {
    headers: { Accept: "application/json", ...authHeaders(config) },
    signal: timeoutSignal(context.signal, timeoutMs),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `OmniRoute refused the key (HTTP ${response.status}). Run \`shelra auth omniroute\` with its endpoint key.`,
    );
  }
  if (!response.ok) throw new Error(`OmniRoute model list answered HTTP ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("OmniRoute model list was not JSON");
  }
  const entries = parseOmniRouteModels(body, fetchedAt);
  if (entries.length === 0) throw new Error("OmniRoute listed no usable models");
  return entries;
}

/** What the response headers of one answer say about who served it. */
export function readServedHeaders(headers: Headers): ServedRoute | null {
  const provider = headers.get("x-omniroute-provider")?.trim();
  const model = headers.get("x-omniroute-model")?.trim();
  const costRaw = headers.get("x-omniroute-response-cost")?.trim();
  const cost = costRaw === undefined ? Number.NaN : Number(costRaw);
  if (!provider && !model && !Number.isFinite(cost)) return null;
  const servedModelId =
    model && provider
      ? model.toLowerCase().startsWith(`${provider.toLowerCase()}/`)
        ? model
        : `${provider}/${model}`
      : model;
  return {
    ...(provider ? { servedProviderId: provider.toLowerCase() } : {}),
    ...(servedModelId ? { servedModelId } : {}),
    ...(Number.isFinite(cost) ? { costUsd: cost } : {}),
  };
}

function requestedModelOf(init: RequestInit | undefined): string | undefined {
  try {
    if (typeof init?.body !== "string") return undefined;
    const model = (JSON.parse(init.body) as { model?: unknown }).model;
    return typeof model === "string" ? model : undefined;
  } catch {
    return undefined;
  }
}

/** Remembers, per requested model, who served the latest answer; bounded. */
class ServedLedger {
  private readonly byModel = new Map<string, ServedRoute>();

  set(model: string, served: ServedRoute): void {
    this.byModel.delete(model);
    this.byModel.set(model, served);
    if (this.byModel.size > 64) this.byModel.delete(this.byModel.keys().next().value as string);
  }

  take(model: string): ServedRoute | undefined {
    const served = this.byModel.get(model);
    this.byModel.delete(model);
    return served;
  }
}

/**
 * An OpenAI-compatible adapter for OmniRoute that speaks canonical ids (`omniroute/groq/openai/gpt-oss-120b`) and
 * reports, per step, the provider and model that really answered and the cost OmniRoute charged. Reuse of the generic
 * transport is complete: this adds only the header reading.
 */
export function createOmniRouteAdapter(config: ProviderConfig, context: AdapterContext): ProviderAdapter {
  const ledger = new ServedLedger();
  const base: FetchFunction = (context.fetch ?? ((input, init) => fetch(input, init))) as FetchFunction;
  const reading: FetchFunction = async (input, init) => {
    const response = await base(input, init);
    const model = requestedModelOf(init);
    const served = readServedHeaders(response.headers);
    if (model && served) ledger.set(model, served);
    return response;
  };
  const inner = createOpenAICompatibleProvider(config.credential?.apiKey ?? "", config.baseURL, "auto", {
    providerId: OMNIROUTE_PROVIDER_ID,
    fetch: reading,
    // Retries belong to the router (another route) and the turn's ladder; the SDK waiting out a retry-after helps neither.
    maxRetries: 0,
  });
  const canonical = withCanonicalIds(OMNIROUTE_PROVIDER_ID, inner, context.entries);
  const prefix = `${OMNIROUTE_PROVIDER_ID}/`;
  const wireOf = (modelId: string) => (modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId);
  /** Auxiliary calls (titles, recaps, structured output) are answered by the same gateway and checked the same way. */
  const observe = (modelId: string): void => {
    const served = ledger.take(wireOf(modelId));
    if (served) context.onServed?.(modelId, served);
  };
  return {
    ...canonical,
    async generateText(request) {
      try {
        return await canonical.generateText(request);
      } finally {
        observe(request.modelId);
      }
    },
    ...(canonical.generateStructured
      ? {
          generateStructured: async (request: Parameters<NonNullable<ProviderAdapter["generateStructured"]>>[0]) => {
            try {
              return await (canonical.generateStructured as NonNullable<ProviderAdapter["generateStructured"]>)(
                request,
              );
            } finally {
              observe(request.modelId);
            }
          },
        }
      : {}),
    stream(request: ProviderStreamRequest): ProviderStream {
      const wire = wireOf(request.modelId);
      return canonical.stream({
        ...request,
        onStepFinish: (event) => {
          const served = ledger.take(wire);
          if (served) context.onServed?.(request.modelId, served);
          request.onStepFinish?.({
            ...event,
            usage:
              served?.costUsd !== undefined && event.usage.costUsdTicks === undefined
                ? { ...event.usage, costUsdTicks: Math.round(served.costUsd * 1_000_000) }
                : event.usage,
            ...(served?.servedModelId ? { servedModelId: `${prefix}${served.servedModelId}` } : {}),
            ...(served?.servedProviderId ? { servedProviderId: served.servedProviderId } : {}),
          });
        },
      });
    },
  };
}
