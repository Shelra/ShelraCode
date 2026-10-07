/**
 * Canonical model identity. A model is `provider/providerModelId`: `groq/openai/gpt-oss-120b`,
 * `omniroute/auto/coding`, `openrouter/anthropic/claude-sonnet-4`. The provider is always the first segment, so two
 * providers serving the same upstream model never collide.
 *
 * Ids saved before providers were namespaced are bare OpenRouter ids (`google/gemma-3:free`) or already
 * `openrouter/…`; both still resolve, to OpenRouter, exactly as they did.
 */

/** The router Shelra itself runs in Free mode: it picks among every eligible free route, per request. */
export const AUTO_FREE_PROVIDER_ID = "shelra";
export const AUTO_FREE_MODEL_ID = `${AUTO_FREE_PROVIDER_ID}/free`;

/** The provider a bare, un-namespaced id has always meant. */
export const LEGACY_PROVIDER_ID = "openrouter";

export interface ModelRef {
  providerId: string;
  /** The id the provider itself uses: what goes on its wire. */
  providerModelId: string;
  /** `providerId/providerModelId`. */
  canonical: string;
  /** True when the id carried no provider and was read as the legacy one. */
  legacy: boolean;
}

/** Joins a provider and its model id into the canonical id. */
export function formatModelRef(providerId: string, providerModelId: string): string {
  return `${providerId}/${providerModelId}`;
}

export function isAutoFreeModel(modelId: string): boolean {
  return modelId.trim().toLowerCase() === AUTO_FREE_MODEL_ID;
}

/**
 * Reads a model id against the providers that exist. Only a registered provider id counts as a namespace: any other
 * first segment is an upstream vendor (`google/…`, `qwen/…`) and the id is a legacy OpenRouter one.
 */
export function parseModelRef(modelId: string, providerIds: ReadonlySet<string>): ModelRef {
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    const head = trimmed.slice(0, slash).toLowerCase();
    const rest = trimmed.slice(slash + 1);
    if (rest && (providerIds.has(head) || head === AUTO_FREE_PROVIDER_ID)) {
      return { providerId: head, providerModelId: rest, canonical: formatModelRef(head, rest), legacy: false };
    }
  }
  return {
    providerId: LEGACY_PROVIDER_ID,
    providerModelId: trimmed,
    canonical: formatModelRef(LEGACY_PROVIDER_ID, trimmed),
    legacy: true,
  };
}

/** The canonical form of any id a user, a setting or an old session may hold. */
export function canonicalModelId(modelId: string, providerIds: ReadonlySet<string>): string {
  const trimmed = modelId.trim();
  if (!trimmed) return "";
  return parseModelRef(trimmed, providerIds).canonical;
}
