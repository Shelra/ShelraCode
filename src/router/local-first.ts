import { type HardwareProfile, localModelFitScore } from "../hardware/profile";
import type { LocalModelCandidate } from "../runtimes/types";

export type PrivacyPolicy = "local-only" | "local-first";

export interface RouteRequest {
  policy?: PrivacyPolicy;
  requiresTools?: boolean;
  contextTokens?: number;
  preferredModel?: string;
  hardware?: HardwareProfile;
}

export interface RouteDecision {
  kind: "local" | "unavailable";
  model?: LocalModelCandidate;
  reasons: string[];
}

/** Selects a local candidate before any future remote fallback is considered. */
export function selectLocalRoute(models: LocalModelCandidate[], request: RouteRequest = {}): RouteDecision {
  const reasons: string[] = [];
  const policy = request.policy ?? "local-first";
  let eligible = models.filter((model) => {
    if (request.requiresTools && !model.tools) {
      reasons.push(`${model.id}: tool capability unavailable`);
      return false;
    }
    if (request.requiresTools && (model.capabilityConfidence ?? "unknown") === "unknown") {
      reasons.push(`${model.id}: tool capability is unprobed; host will validate tool calls`);
    }
    if (request.contextTokens && model.contextWindow < request.contextTokens) {
      reasons.push(`${model.id}: context capacity is insufficient`);
      return false;
    }
    return true;
  });

  if (request.preferredModel) {
    const preferred = eligible.find((model) => model.id === request.preferredModel);
    if (preferred) eligible = [preferred, ...eligible.filter((model) => model !== preferred)];
    else reasons.push(`${request.preferredModel}: preferred local model is unavailable`);
  }

  eligible.sort(
    (a, b) =>
      localModelFitScore(b, request.hardware) - localModelFitScore(a, request.hardware) ||
      Number(b.loaded ?? false) - Number(a.loaded ?? false) ||
      b.contextWindow - a.contextWindow,
  );
  const selected = eligible[0];
  if (selected) {
    reasons.unshift(`selected local model ${selected.id} from ${selected.runtimeId}`);
    return { kind: "local", model: selected, reasons };
  }

  reasons.push(
    policy === "local-only" ? "local-only policy has no eligible model" : "no eligible local model discovered",
  );
  return { kind: "unavailable", reasons };
}
