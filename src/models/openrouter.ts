import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getProductUserDir } from "../product/identity";
import type { CatalogCapabilities, CatalogCost, CatalogEntry } from "./types";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_CATALOG_TTL_MS = 6 * 60 * 60 * 1_000;
const OPENROUTER_ROUTER_IDS = new Set(["openrouter/free", "openrouter/auto", "openrouter/auto-beta"]);

type FetchLike = typeof fetch;

export interface OpenRouterCatalogOptions {
  apiKey?: string;
  baseURL?: string;
  cachePath?: string;
  ttlMs?: number;
  now?: () => number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}

export interface OpenRouterCatalogResult {
  entries: CatalogEntry[];
  fetchedAt?: string;
  source: "network" | "cache" | "stale-cache" | "empty";
  error?: string;
}

interface CacheFile {
  version: 1;
  fetchedAt: string;
  entries: CatalogEntry[];
}

interface RawOpenRouterModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  max_completion_tokens?: unknown;
  supported_parameters?: unknown;
  architecture?: unknown;
  pricing?: unknown;
  top_provider?: unknown;
  expiration_date?: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = nonNegativeNumber(value);
  return parsed && parsed >= 1 ? Math.floor(parsed) : undefined;
}

function dateToUnixSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : undefined;
}

function supportedParameters(raw: RawOpenRouterModel): Set<string> {
  if (!Array.isArray(raw.supported_parameters)) return new Set();
  return new Set(
    raw.supported_parameters
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.toLowerCase()),
  );
}

function capabilities(raw: RawOpenRouterModel): CatalogCapabilities {
  const supported = supportedParameters(raw);
  const architecture = record(raw.architecture);
  const inputModalities = Array.isArray(architecture?.input_modalities)
    ? architecture.input_modalities
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.toLowerCase())
    : [];
  return {
    tools: supported.has("tools") || supported.has("tool_choice"),
    reasoning: supported.has("reasoning") || supported.has("include_reasoning"),
    vision: inputModalities.includes("image") || inputModalities.includes("file"),
    structuredOutput: supported.has("structured_outputs") || supported.has("response_format") ? true : undefined,
  };
}

function cost(raw: RawOpenRouterModel): CatalogCost {
  const pricing = record(raw.pricing);
  const promptValue = nonNegativeNumber(pricing?.prompt);
  const completionValue = nonNegativeNumber(pricing?.completion);
  const prompt = promptValue ?? 0;
  const completion = completionValue ?? 0;
  const request = nonNegativeNumber(pricing?.request) ?? 0;
  const id = text(raw.id) ?? "";
  const lowerId = id.toLowerCase();
  const freeRouter = lowerId === "openrouter/free";
  const autoRouter = lowerId === "openrouter/auto" || lowerId === "openrouter/auto-beta";
  const pricingKnown = freeRouter || (!autoRouter && promptValue !== undefined && completionValue !== undefined);
  const free =
    freeRouter ||
    id.endsWith(":free") ||
    (!autoRouter && pricingKnown && prompt === 0 && completion === 0 && request === 0);
  return {
    prompt,
    completion,
    request,
    free,
    pricingKnown,
  };
}

function modelContext(raw: RawOpenRouterModel): {
  contextWindow: number;
  maxOutputTokens?: number;
  confidence: "declared" | "assumed";
} {
  const topProvider = record(raw.top_provider);
  const contextWindow = positiveInteger(topProvider?.context_length) ?? positiveInteger(raw.context_length);
  const maxOutputTokens =
    positiveInteger(topProvider?.max_completion_tokens) ?? positiveInteger(raw.max_completion_tokens);
  return contextWindow
    ? { contextWindow, ...(maxOutputTokens ? { maxOutputTokens } : {}), confidence: "declared" }
    : { contextWindow: 8_192, ...(maxOutputTokens ? { maxOutputTokens } : {}), confidence: "assumed" };
}

/** Pure conversion of OpenRouter's public `/models` object into Shelra's stable catalog shape. */
export function normalizeOpenRouterModel(
  rawValue: unknown,
  apiKeyConfigured = false,
  fetchedAt?: string,
): CatalogEntry | undefined {
  const raw = record(rawValue) as RawOpenRouterModel | null;
  const providerModelId = text(raw?.id);
  if (!raw || !providerModelId) return undefined;
  const prices = cost(raw);
  const context = modelContext(raw);
  const topProvider = record(raw.top_provider);
  const moderated = typeof topProvider?.is_moderated === "boolean" ? topProvider.is_moderated : undefined;
  const notes: string[] = [];
  if (prices.free) notes.push("Free variant; OpenRouter availability and data policy apply.");
  if (moderated) notes.push("Top provider reports moderation.");
  const expiresAt = dateToUnixSeconds(raw.expiration_date);
  if (expiresAt) notes.push(`Availability expires ${new Date(expiresAt * 1_000).toISOString()}.`);

  return {
    // OpenRouter's router ids are already provider-scoped (for example
    // `openrouter/free`). Prefixing them again would produce the invalid
    // canonical id `openrouter/openrouter/free` and make the models command
    // advertise a model the request adapter could not select consistently.
    id: OPENROUTER_ROUTER_IDS.has(providerModelId) ? providerModelId : `openrouter/${providerModelId}`,
    category: "cloud",
    provider: "openrouter",
    name: text(raw.name) ?? providerModelId,
    description: text(raw.description),
    contextWindow: context.contextWindow,
    ...(context.maxOutputTokens ? { maxOutputTokens: context.maxOutputTokens } : {}),
    contextConfidence: context.confidence,
    capabilities: capabilities(raw),
    cost: prices,
    state: {
      kind: "cloud",
      providerModelId,
      apiKeyConfigured,
      notes,
      ...(moderated === undefined ? {} : { moderated }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    },
    ...(fetchedAt ? { fetchedAt } : {}),
  };
}

export function parseOpenRouterModels(body: unknown, apiKeyConfigured = false, fetchedAt?: string): CatalogEntry[] {
  const root = record(body);
  const data = root?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const entry = normalizeOpenRouterModel(item, apiKeyConfigured, fetchedAt);
    return entry ? [entry] : [];
  });
}

function defaultCachePath(): string {
  return join(getProductUserDir(), "catalog", "openrouter.json");
}

async function readCache(cachePath: string, apiKeyConfigured: boolean): Promise<CacheFile | undefined> {
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8")) as Partial<CacheFile>;
    if (parsed.version !== 1 || typeof parsed.fetchedAt !== "string" || !Array.isArray(parsed.entries))
      return undefined;
    const entries = parsed.entries.filter(isCatalogEntry).map((entry) => {
      const providerModelId = entry.state.kind === "cloud" ? entry.state.providerModelId : "";
      const id = OPENROUTER_ROUTER_IDS.has(providerModelId) ? providerModelId : entry.id;
      return {
        ...entry,
        id,
        cost: normalizeCachedCost(entry.cost, providerModelId),
        state: { ...entry.state, apiKeyConfigured },
      };
    });
    return { version: 1, fetchedAt: parsed.fetchedAt, entries };
  } catch {
    return undefined;
  }
}

function isCatalogEntry(value: unknown): value is CatalogEntry {
  const entry = record(value);
  const state = record(entry?.state);
  return (
    typeof entry?.id === "string" &&
    entry.category === "cloud" &&
    entry.provider === "openrouter" &&
    typeof entry.name === "string" &&
    typeof entry.contextWindow === "number" &&
    entry.contextWindow > 0 &&
    record(entry.capabilities) !== null &&
    record(entry.cost) !== null &&
    state?.kind === "cloud" &&
    typeof state.providerModelId === "string"
  );
}

function normalizeCachedCost(cost: CatalogEntry["cost"], providerModelId: string): CatalogEntry["cost"] {
  const lowerId = providerModelId.trim().toLowerCase();
  if (lowerId === "openrouter/free") return { ...cost, free: true, pricingKnown: true };
  if (lowerId === "openrouter/auto" || lowerId === "openrouter/auto-beta") {
    return { ...cost, free: false, pricingKnown: false };
  }
  return cost;
}

async function writeCache(cachePath: string, cache: CacheFile): Promise<void> {
  try {
    await mkdir(join(cachePath, ".."), { recursive: true });
    const temporary = `${cachePath}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, cachePath);
  } catch {
    // Catalog caching is an optimization. A read-only home must not stop model discovery.
  }
}

function normalizedBaseURL(baseURL = OPENROUTER_BASE_URL): string {
  return baseURL.replace(/\/+$/u, "");
}

/** Loads a fresh catalog, refreshing over the network and falling back to stale cache offline. */
export async function fetchOpenRouterCatalog(options: OpenRouterCatalogOptions = {}): Promise<OpenRouterCatalogResult> {
  const now = options.now ?? Date.now;
  const cachePath = options.cachePath ?? defaultCachePath();
  const cached = await readCache(cachePath, Boolean(options.apiKey));
  const ttlMs = options.ttlMs ?? OPENROUTER_CATALOG_TTL_MS;
  if (cached && now() - Date.parse(cached.fetchedAt) <= ttlMs) {
    return { entries: cached.entries, fetchedAt: cached.fetchedAt, source: "cache" };
  }

  const fetchedAt = new Date(now()).toISOString();
  try {
    const response = await (options.fetchImpl ?? fetch)(`${normalizedBaseURL(options.baseURL)}/models`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ShelraCode/1",
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`OpenRouter model catalog returned HTTP ${response.status}`);
    const entries = parseOpenRouterModels(await response.json(), Boolean(options.apiKey), fetchedAt);
    if (entries.length === 0) throw new Error("OpenRouter returned no usable models");
    await writeCache(cachePath, { version: 1, fetchedAt, entries });
    return { entries, fetchedAt, source: "network" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cached && cached.entries.length > 0) {
      return { entries: cached.entries, fetchedAt: cached.fetchedAt, source: "stale-cache", error: message };
    }
    return { entries: [], source: "empty", error: message };
  }
}

export function isOpenRouterBaseURL(baseURL: string): boolean {
  const normalized = normalizedBaseURL(baseURL).toLowerCase();
  return normalized === OPENROUTER_BASE_URL || normalized === "https://openrouter.ai/api";
}
