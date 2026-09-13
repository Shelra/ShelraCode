import type { LocalModelCandidate, LocalRuntimeKind } from "../runtimes/types";
import type { ModelInfo } from "../types/index";

export type CatalogCategory = "local" | "cloud";
export type MetadataConfidence = "measured" | "declared" | "catalog" | "fallback" | "assumed";

export interface CatalogCapabilities {
  tools: boolean;
  reasoning: boolean;
  vision: boolean;
  structuredOutput?: boolean;
}

export interface CatalogCost {
  /** USD per token. */
  prompt: number;
  completion: number;
  /** USD per request, when OpenRouter reports a request-level charge. */
  request?: number;
  free: boolean;
  /** False when the provider omitted one of the prices; zero is not then treated as free. */
  pricingKnown?: boolean;
}

export interface LocalCatalogState {
  kind: "local";
  install: "installed" | "available";
  path?: string;
  sizeBytes?: number;
  quantization?: string;
  parameters?: number;
  estimatedMemoryGb?: number;
  runtimeId?: string;
  runtimeKind?: LocalRuntimeKind;
  servedContextWindow?: number;
}

export interface CloudCatalogState {
  kind: "cloud";
  /** Provider-scoped id placed on the wire. */
  providerModelId: string;
  apiKeyConfigured: boolean;
  notes: string[];
  moderated?: boolean;
  expiresAt?: number;
}

export interface CatalogEntry {
  /** Canonical addressable id, e.g. openrouter/google/gemma-3:free. */
  id: string;
  category: CatalogCategory;
  provider: string;
  name: string;
  description?: string;
  contextWindow: number;
  maxOutputTokens?: number;
  contextConfidence: MetadataConfidence;
  capabilities: CatalogCapabilities;
  cost: CatalogCost;
  state: LocalCatalogState | CloudCatalogState;
  fetchedAt?: string;
}

export function catalogEntryToModelInfo(entry: CatalogEntry): ModelInfo {
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
    runtimeKind:
      entry.category === "cloud"
        ? `cloud:${entry.provider}`
        : entry.state.kind === "local"
          ? entry.state.runtimeKind
          : undefined,
    supportsVision: entry.capabilities.vision,
    maxOutputTokens: entry.maxOutputTokens,
    category: entry.category,
    provider: entry.provider,
  };
}

export function catalogEntryToLocalModelCandidate(
  entry: CatalogEntry,
  baseURL: string,
): LocalModelCandidate | undefined {
  if (entry.state.kind !== "local") return undefined;
  return {
    id: entry.state.runtimeId ?? entry.id,
    name: entry.name,
    runtimeId: entry.state.runtimeId ?? "local",
    runtimeKind: entry.state.runtimeKind ?? "openai-compatible",
    baseURL,
    contextWindow: entry.contextWindow,
    tools: entry.capabilities.tools,
    structuredOutput: entry.capabilities.structuredOutput ?? false,
    reasoning: entry.capabilities.reasoning,
    source: "local",
    capabilityConfidence: entry.contextConfidence === "measured" ? "measured" : "declared",
    supportsVision: entry.capabilities.vision,
    parameters: entry.state.parameters,
    quantization: entry.state.quantization,
    memoryRequiredGb: entry.state.estimatedMemoryGb,
  };
}
