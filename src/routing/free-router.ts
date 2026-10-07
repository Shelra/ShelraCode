import { capabilityScore, type ModelCapabilityRequirements } from "../models/routing";
import type { CatalogEntry } from "../models/types";
import { classifyFreeEligibility, type FreeAttestations, type FreeEligibility, isRouterEntry } from "./eligibility";
import type { HealthTracker } from "./health";

/**
 * Free routing: from every provider's catalog, the ordered list of routes a Free turn may run, best first. Pure and
 * deterministic: the same catalog, health and attestations give the same plan, so a test can assert it.
 *
 * Nothing here can add a route that `classifyFreeEligibility` refused, and the guard re-checks each call against the
 * same classifier, so a bug in the ranking can reorder routes but not make one paid.
 */

export interface FreeRouteRequest extends ModelCapabilityRequirements {
  /** Epoch ms; defaults to now. */
  now?: number;
  /** Provider ids never to use (a privacy requirement, a provider that is down). */
  excludeProviders?: ReadonlySet<string>;
  /** Canonical ids already tried this turn. */
  excludeRoutes?: ReadonlySet<string>;
}

export interface FreeRouteSignals {
  /** Remaining allowance of a provider, 0 (empty) to 1 (untouched), when known. */
  quotaHeadroom?: (providerId: string) => number | undefined;
}

export interface FreeRoute {
  /** Canonical id: `provider/providerModelId`. */
  id: string;
  providerId: string;
  providerModelId: string;
  entry: CatalogEntry;
  eligibility: FreeEligibility;
  score: number;
  /** The provider a gateway forwards to, when its id says so. */
  upstream?: string;
  /** True for the route taken only when nothing better is left (OpenRouter's free router). */
  lastResort: boolean;
  /** True when the route is still cooling down after a passing fault and is tried because nothing else is left. */
  probing?: boolean;
  /** Milliseconds of cooldown left, for a probing route. */
  cooldownRemainingMs?: number;
  /** Why it ranks where it does, for the trace. */
  reasons: string[];
}

export interface FreeRouteRejection {
  id: string;
  reason: string;
}

export interface FreeRoutePlan {
  routes: FreeRoute[];
  rejected: FreeRouteRejection[];
}

export function upstreamRouteKey(upstream: string): string {
  return `upstream:${upstream}`;
}

function providerModelIdOf(entry: CatalogEntry): string {
  return entry.state.kind === "cloud" ? entry.state.providerModelId : entry.id;
}

function upstreamOf(entry: CatalogEntry): string | undefined {
  return entry.state.kind === "cloud" ? entry.state.upstream : undefined;
}

function capabilityRefusal(entry: CatalogEntry, request: FreeRouteRequest): string | null {
  const { capabilities } = entry;
  if (request.requiresTools && !capabilities.tools) return "no tool calling";
  if (request.requiresVision && !capabilities.vision) return "no vision";
  if (request.requiresReasoning && !capabilities.reasoning) return "no reasoning";
  if (request.requiresStructuredOutput && capabilities.structuredOutput !== true) return "no structured output";
  if (request.minimumContext !== undefined && entry.contextWindow < request.minimumContext) {
    return `context ${entry.contextWindow} is below ${request.minimumContext}`;
  }
  return null;
}

/** How much to trust the numbers a catalog gives for capability and context. */
function confidenceBonus(entry: CatalogEntry): number {
  switch (entry.contextConfidence) {
    case "measured":
      return 8;
    case "declared":
      return 3;
    case "catalog":
      return 1;
    default:
      return 0;
  }
}

interface Scored {
  score: number;
  reasons: string[];
}

function scoreRoute(
  entry: CatalogEntry,
  routeId: string,
  health: HealthTracker | undefined,
  signals: FreeRouteSignals,
  now: number,
): Scored {
  const reasons: string[] = [];
  let score = capabilityScore(entry);
  reasons.push(`capability ${score.toFixed(0)}`);
  const trust = confidenceBonus(entry);
  if (trust > 0) {
    score += trust;
    reasons.push(`metadata ${entry.contextConfidence} (+${trust})`);
  }
  const view = health?.view(routeId);
  if (view?.lastSuccessAt !== undefined && now - view.lastSuccessAt < 30 * 60_000) {
    score += 10;
    reasons.push("answered in the last 30 minutes (+10)");
  }
  if (view && view.failures > 0) {
    const penalty = Math.min(18, view.failures * 6);
    score -= penalty;
    reasons.push(`${view.failures} failure(s) since it last answered (-${penalty})`);
  }
  if (view?.latencyMs !== undefined) {
    const adjust = view.latencyMs < 1_500 ? 6 : view.latencyMs > 8_000 ? -6 : 0;
    if (adjust !== 0) {
      score += adjust;
      reasons.push(`latency ${Math.round(view.latencyMs)} ms (${adjust > 0 ? "+" : ""}${adjust})`);
    }
  }
  const headroom = signals.quotaHeadroom?.(entry.provider);
  if (headroom !== undefined) {
    const bonus = Math.round(Math.min(1, Math.max(0, headroom)) * 10);
    score += bonus;
    reasons.push(`quota headroom ${(headroom * 100).toFixed(0)}% (+${bonus})`);
  }
  // A weak model on this machine is not preferred merely because it exists: remote first, local when it is all there is.
  if (entry.category === "local") {
    score -= 12;
    reasons.push("runs locally (-12)");
  }
  // One hop fewer: a gateway adds a second point of failure.
  if (upstreamOf(entry) !== undefined) {
    score -= 2;
    reasons.push("through a gateway (-2)");
  }
  return { score, reasons };
}

/**
 * The routes a Free turn may run. Every entry is classified; only eligible ones are ranked, the rest are returned in
 * `rejected` with the reason, which the status view and the trace repeat.
 */
export function planFreeRoutes(
  entries: readonly CatalogEntry[],
  request: FreeRouteRequest,
  context: {
    attestations: FreeAttestations;
    health?: HealthTracker;
    signals?: FreeRouteSignals;
    /**
     * Include routes that are cooling down after a passing fault (never after a spent quota, a refused key or a rate
     * limit), soonest back first. Eligibility is not relaxed: a route that is not proven free is still refused. Used
     * only when the ordinary plan is empty, so a turn is never left with no free model while one may well answer.
     */
    probeCooling?: boolean;
  },
): FreeRoutePlan {
  const now = request.now ?? Date.now();
  const nowSeconds = Math.floor(now / 1_000);
  const signals = context.signals ?? {};
  const routes: FreeRoute[] = [];
  const rejected: FreeRouteRejection[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const eligibility = classifyFreeEligibility(entry, context.attestations);
    const reject = (reason: string) => rejected.push({ id: entry.id, reason });
    if (!eligibility.eligible) {
      reject(`not free: ${eligibility.evidence}`);
      continue;
    }
    if (entry.state.kind === "cloud" && entry.state.expiresAt !== undefined && entry.state.expiresAt <= nowSeconds) {
      reject("expired");
      continue;
    }
    if (request.excludeProviders?.has(entry.provider)) {
      reject("provider excluded");
      continue;
    }
    if (request.excludeRoutes?.has(entry.id)) {
      reject("already tried this turn");
      continue;
    }
    const refusal = capabilityRefusal(entry, request);
    if (refusal) {
      reject(refusal);
      continue;
    }
    const upstream = upstreamOf(entry);
    let probing = false;
    let cooldownRemainingMs = 0;
    if (context.health) {
      if (!context.health.isAvailable(entry.id, entry.provider)) {
        cooldownRemainingMs = context.health.cooldownRemaining(entry.id, entry.provider);
        if (!(context.probeCooling && context.health.isTransient(entry.id, entry.provider))) {
          reject(`cooling down for ${Math.ceil(cooldownRemainingMs / 1_000)}s`);
          continue;
        }
        probing = true;
      }
      // A gateway forwarding to a provider that just failed would fail the same way.
      if (upstream && !context.health.isAvailable(upstreamRouteKey(upstream), upstreamRouteKey(upstream))) {
        const key = upstreamRouteKey(upstream);
        if (!(context.probeCooling && context.health.isTransient(key, key))) {
          reject(`its upstream ${upstream} is cooling down`);
          continue;
        }
        probing = true;
        cooldownRemainingMs = Math.max(cooldownRemainingMs, context.health.cooldownRemaining(key, key));
      }
    }
    const lastResort = isRouterEntry(entry);
    const { score, reasons } = scoreRoute(entry, entry.id, context.health, signals, now);
    routes.push({
      id: entry.id,
      providerId: entry.provider,
      providerModelId: providerModelIdOf(entry),
      entry,
      eligibility,
      score,
      ...(upstream ? { upstream } : {}),
      lastResort,
      ...(probing ? { probing: true, cooldownRemainingMs } : {}),
      reasons: [
        eligibility.evidence,
        ...reasons,
        ...(probing
          ? [
              `still cooling down for ${Math.ceil(cooldownRemainingMs / 1_000)}s after a passing fault: tried because nothing else is left`,
            ]
          : []),
      ],
    });
  }

  routes.sort((a, b) => {
    if (a.lastResort !== b.lastResort) return a.lastResort ? 1 : -1;
    // Routes that are available come first; among those still cooling, the one back soonest.
    if (a.probing !== b.probing) return a.probing ? 1 : -1;
    if (a.probing && b.probing) return (a.cooldownRemainingMs ?? 0) - (b.cooldownRemainingMs ?? 0) || b.score - a.score;
    return b.score - a.score || a.id.localeCompare(b.id);
  });
  return { routes, rejected };
}

/** The canonical ids of a plan, best first. */
export function routeIds(plan: FreeRoutePlan): string[] {
  return plan.routes.map((route) => route.id);
}
