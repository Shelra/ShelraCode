import { getModelInfo } from "../models/catalog";

/** The model answering a turn: the one it runs on, and for a router (`openrouter/auto`) the model that answered. */
export interface AnsweringModel {
  modelId: string;
  servedModelId?: string;
}

const ROUTER_LABELS: Record<string, string> = { "openrouter/auto": "auto", "openrouter/free": "free" };

/** A catalog name without its vendor ("Anthropic: Claude Sonnet 4.5" → "Claude Sonnet 4.5"), or the id's last part. */
function shortName(modelId: string): string {
  const name = getModelInfo(modelId)?.name;
  if (name) return name.replace(/^[^:]+:\s+/u, "");
  return modelId.split("/").at(-1) ?? modelId;
}

/**
 * The footer's name for the model answering, or null when the chosen model is: a fallback shows its own name, a
 * router shows the model it picked ("Claude Sonnet 4.5 · auto"), and a model from OpenRouter's server-side fallback
 * list says so ("Qwen3 Coder · fallback").
 */
export function answeringModelLabel(answering: AnsweringModel | null, chosenModelId: string): string | null {
  if (!answering) return null;
  if (answering.servedModelId) {
    return `${shortName(answering.servedModelId)} · ${ROUTER_LABELS[answering.modelId] ?? "fallback"}`;
  }
  if (answering.modelId === chosenModelId) return null;
  return getModelInfo(answering.modelId)?.name ?? answering.modelId;
}

/** A model that costs nothing to call: the free router, a `:free` variant, or a known zero price (a local model). */
export function isFreeModelId(modelId: string): boolean {
  if (modelId === "openrouter/free" || modelId.endsWith(":free")) return true;
  const info = getModelInfo(modelId);
  return info !== undefined && info.pricingKnown !== false && info.inputPrice === 0 && info.outputPrice === 0;
}
