import type { ModelInfo, ReasoningEffort } from "../types/index";
import type { CatalogEntry } from "./types";

/** Runtime-primed metadata facade used by the legacy Agent/UI consumers. */
export const MODELS: ModelInfo[] = [];
export const DEFAULT_MODEL = "";

const aliases = new Map<string, string>();

export function normalizeModelId(modelId: string): string {
  return modelId.trim();
}

/** Replaces the in-memory view after a runtime has discovered models. */
export function primeCatalog(entries: readonly CatalogEntry[] | readonly ModelInfo[]): void {
  MODELS.splice(0, MODELS.length);
  aliases.clear();
  for (const entry of entries) {
    const info = "cost" in entry ? catalogEntryToInfo(entry) : entry;
    if (!info.id) continue;
    MODELS.push(info);
    for (const alias of info.aliases ?? []) aliases.set(normalizeModelId(alias).toLowerCase(), info.id);
  }
}

export function clearCatalog(): void {
  MODELS.splice(0, MODELS.length);
  aliases.clear();
}

export function getModelInfo(modelId: string): ModelInfo | undefined {
  const normalized = normalizeModelId(modelId);
  const direct = MODELS.find((model) => model.id === normalized);
  if (direct) return direct;
  const alias = aliases.get(normalized.toLowerCase());
  return alias ? MODELS.find((model) => model.id === alias) : undefined;
}

export function getModelIds(): string[] {
  return MODELS.map((model) => model.id);
}

export function isKnownModelId(modelId: string): boolean {
  return getModelInfo(modelId) !== undefined;
}

export function getSupportedReasoningEfforts(modelId: string): ReasoningEffort[] {
  const info = getModelInfo(modelId);
  if (!info?.reasoning || info.supportsReasoningEffort === false) return [];
  return ["low", "medium", "high"];
}

export function getEffectiveReasoningEffort(modelId: string, override?: ReasoningEffort): ReasoningEffort | undefined {
  const supported = getSupportedReasoningEfforts(modelId);
  if (override && supported.includes(override)) return override;
  const defaultEffort = getModelInfo(modelId)?.defaultReasoningEffort;
  return defaultEffort && supported.includes(defaultEffort) ? defaultEffort : undefined;
}

function catalogEntryToInfo(entry: CatalogEntry): ModelInfo {
  return {
    id: entry.id,
    name: entry.name,
    contextWindow: entry.contextWindow,
    inputPrice: entry.cost.prompt,
    outputPrice: entry.cost.completion,
    pricingKnown: entry.cost.pricingKnown ?? true,
    reasoning: entry.capabilities.reasoning,
    description: entry.description ?? `${entry.provider} ${entry.category} model`,
    supportsClientTools: entry.capabilities.tools,
    supportsMaxOutputTokens: entry.maxOutputTokens !== undefined,
    supportsReasoningEffort: entry.capabilities.reasoning,
    capabilityConfidence: entry.contextConfidence === "measured" ? "measured" : "declared",
    runtimeKind: entry.category === "cloud" ? `cloud:${entry.provider}` : undefined,
    supportsVision: entry.capabilities.vision,
    maxOutputTokens: entry.maxOutputTokens,
    category: entry.category,
    provider: entry.provider,
  };
}
