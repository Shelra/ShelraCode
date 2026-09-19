import type { CatalogEntry } from "./types";

export type ModelPolicy = "free" | "auto" | "economy" | "balanced" | "quality" | "max" | "custom";

export interface ModelCapabilityRequirements {
  requiresTools?: boolean;
  requiresVision?: boolean;
  requiresReasoning?: boolean;
  requiresStructuredOutput?: boolean;
  minimumContext?: number;
}

export interface ModelRouteRequest extends ModelCapabilityRequirements {
  requestedModel?: string;
  policy?: ModelPolicy;
  allowPaid?: boolean;
  now?: number;
}

export interface ModelRouteDecision {
  modelId: string;
  entry?: CatalogEntry;
  candidates: CatalogEntry[];
  reasons: string[];
}

/**
 * Returns true only for a model whose catalog identity guarantees zero-cost
 * routing. OpenRouter's auto routers advertise a zero router price, but may
 * resolve the request to a paid model and therefore are never free-policy
 * candidates.
 */
export function isGuaranteedFree(entry: CatalogEntry): boolean {
  const id = entry.id.trim().toLowerCase();
  const providerModelId = entry.state.kind === "cloud" ? entry.state.providerModelId.trim().toLowerCase() : "";
  const routerId = providerModelId || id;
  if (routerId === "openrouter/free" || id === "openrouter/free") return true;
  if (
    routerId === "openrouter/auto" ||
    routerId === "openrouter/auto-beta" ||
    id === "openrouter/auto" ||
    id === "openrouter/auto-beta"
  ) {
    return false;
  }
  return entry.cost.free === true;
}

export function catalogModelId(providerModelId: string): string {
  const trimmed = providerModelId.trim();
  return trimmed.startsWith("openrouter/") ? trimmed : `openrouter/${trimmed}`;
}

/** Resolves canonical, provider-scoped and unambiguous suffix ids. */
export function resolveCatalogModel(
  entries: readonly CatalogEntry[],
  requestedModel: string,
): CatalogEntry | undefined {
  const normalized = requestedModel.trim().toLowerCase();
  if (!normalized) return undefined;
  const exact = entries.find(
    (entry) =>
      entry.id.toLowerCase() === normalized ||
      (entry.state.kind === "cloud" && entry.state.providerModelId.toLowerCase() === normalized),
  );
  if (exact) return exact;
  const suffixes = entries.filter(
    (entry) => entry.id.toLowerCase().endsWith(`/${normalized}`) || entry.name.toLowerCase() === normalized,
  );
  return suffixes.length === 1 ? suffixes[0] : undefined;
}

function eligible(entries: readonly CatalogEntry[], request: ModelRouteRequest): CatalogEntry[] {
  const now = Math.floor((request.now ?? Date.now()) / 1_000);
  return entries.filter((entry) => {
    if (entry.category !== "cloud" || entry.state.kind !== "cloud") return false;
    if (entry.state.expiresAt !== undefined && entry.state.expiresAt <= now) return false;
    const capabilities = entry.capabilities;
    if (request.requiresTools && !capabilities.tools) return false;
    if (request.requiresVision && !capabilities.vision) return false;
    if (request.requiresReasoning && !capabilities.reasoning) return false;
    if (request.requiresStructuredOutput && capabilities.structuredOutput !== true) return false;
    if (request.minimumContext !== undefined && entry.contextWindow < request.minimumContext) return false;
    return true;
  });
}

const FREE_ROUTER_ID = "openrouter/free";

/** OpenRouter's free router: a real endpoint that picks a model per request, so it is a fallback, not a candidate. */
export function isFreeRouter(entry: CatalogEntry): boolean {
  const providerModelId = entry.state.kind === "cloud" ? entry.state.providerModelId.trim().toLowerCase() : "";
  return entry.id.trim().toLowerCase() === FREE_ROUTER_ID || providerModelId === FREE_ROUTER_ID;
}

/** Total parameters in billions, read from the model id ("nemotron-3-ultra-550b-a55b" -> 550). Active-parameter suffixes are ignored. */
export function parseModelSizeB(id: string): number | undefined {
  const name = (id.trim().toLowerCase().split("/").pop() ?? "").replace(/:[a-z]+$/, "");
  const match = name.match(/(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z0-9])/);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

const TIER_UP = /(?:^|[-_.])(ultra|max|pro|large|xl|opus|sonnet|plus|prime)(?:[-_.]|$)/;
const TIER_DOWN = /(?:^|[-_.])(flash|lite|mini|nano|lightning|small|tiny|xs|edge|instant|micro)(?:[-_.]|$)/;

/**
 * A transparent, deterministic proxy for "how capable is this model" when all candidates cost the
 * same (free). It is a heuristic over what the catalog exposes, not a benchmark: reasoning support,
 * parameter-size class from the id, a size-tier keyword, and context as a small tiebreak.
 */
export function capabilityScore(entry: CatalogEntry): number {
  const name = entry.id.trim().toLowerCase().split("/").pop() ?? "";
  let score = entry.capabilities.reasoning ? 30 : 0;
  const size = parseModelSizeB(entry.id);
  score += size === undefined ? 40 : Math.min(80, Math.max(0, Math.log2(Math.max(size, 1)) * 8));
  if (TIER_UP.test(name)) score += 12;
  if (TIER_DOWN.test(name)) score -= 15;
  score += Math.min(4, entry.contextWindow / 262_144) * 2;
  return score;
}

function costScore(entry: CatalogEntry): number {
  return entry.cost.pricingKnown === false ? Number.POSITIVE_INFINITY : entry.cost.prompt + entry.cost.completion;
}

function rank(entries: CatalogEntry[], policy: ModelPolicy): CatalogEntry[] {
  return [...entries].sort((a, b) => {
    const aFree = isGuaranteedFree(a);
    const bFree = isGuaranteedFree(b);
    if (aFree !== bFree) return aFree ? -1 : 1;
    // Every free model costs the same, so cost cannot rank them: prefer the most capable one.
    if (policy === "free") return capabilityScore(b) - capabilityScore(a) || b.contextWindow - a.contextWindow;
    if (policy === "max" || policy === "quality") {
      return b.contextWindow - a.contextWindow || costScore(b) - costScore(a);
    }
    return costScore(a) - costScore(b) || b.contextWindow - a.contextWindow;
  });
}

/** Capability-first routing. A free-only route never falls through to a paid entry. */
export function routeCatalogModel(
  entries: readonly CatalogEntry[],
  request: ModelRouteRequest = {},
): ModelRouteDecision {
  const policy = request.policy ?? "free";
  if (request.requestedModel) {
    const requested = request.requestedModel.trim();
    if (requested.toLowerCase() === "openrouter/free") {
      const routerEntry = resolveCatalogModel(entries, "openrouter/free");
      if (routerEntry) {
        const eligibleRouter = eligible([routerEntry], request)[0];
        if (!eligibleRouter) {
          throw new Error(`OpenRouter's free router cannot satisfy this task's capability requirements.`);
        }
        return {
          modelId: eligibleRouter.id,
          entry: eligibleRouter,
          candidates: [eligibleRouter],
          reasons: ["explicitly selected OpenRouter's free router", "free"],
        };
      }
      return {
        modelId: "openrouter/free",
        candidates: [],
        reasons: ["explicitly selected OpenRouter's free router"],
      };
    }
    const entry = resolveCatalogModel(entries, requested);
    if (!entry) throw new Error(`Model "${requested}" was not found in the current OpenRouter catalog.`);
    if (policy === "free" && !request.allowPaid && !isGuaranteedFree(entry)) {
      throw new Error(
        `Model "${entry.name}" is paid and Free policy is active; choose --model-policy auto/economy explicitly.`,
      );
    }
    const eligibleEntry = eligible([entry], request)[0];
    if (!eligibleEntry) throw new Error(`Model "${entry.name}" cannot satisfy this task's capability requirements.`);
    return {
      modelId: eligibleEntry.id,
      entry: eligibleEntry,
      candidates: [eligibleEntry],
      reasons: [
        "explicitly selected",
        ...(isGuaranteedFree(eligibleEntry) ? ["free"] : ["paid by explicit selection"]),
      ],
    };
  }

  const pool = eligible(entries, request).filter((entry) => policy !== "free" || isGuaranteedFree(entry));
  const router = policy === "free" ? pool.find(isFreeRouter) : undefined;
  const ranked = rank(router ? pool.filter((entry) => entry !== router) : pool, policy);
  // OpenRouter's server-side fallback list holds three ids: best, second best, then the free router,
  // so a busy or rate-limited top model degrades to "some free model" instead of failing the turn.
  const candidates = router ? [...ranked.slice(0, 2), router, ...ranked.slice(2)] : ranked;
  if (candidates.length === 0) {
    const capabilityText = [
      request.requiresTools ? "tool calling" : undefined,
      request.requiresVision ? "vision" : undefined,
      request.minimumContext ? `${request.minimumContext} token context` : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      policy === "free"
        ? `No currently available free OpenRouter model satisfies ${capabilityText || "the task"}. Paid fallback was not enabled.`
        : `No currently available OpenRouter model satisfies ${capabilityText || "the task"}.`,
    );
  }
  const selected = candidates[0];
  return {
    modelId: selected.id,
    entry: selected,
    candidates,
    reasons: [
      selected.cost.free ? "free under the active policy" : "paid model permitted by the active policy",
      request.requiresTools ? "supports tools" : undefined,
      request.minimumContext ? `fits ${request.minimumContext} token minimum context` : undefined,
      policy === "free"
        ? "ranked by capability: reasoning, model size class, then context"
        : "ranked by cost first, then context",
      router && selected !== router ? "the free router is the last fallback" : undefined,
    ].filter((reason): reason is string => Boolean(reason)),
  };
}

/**
 * The model to request at startup. An explicit choice or a still-free saved preference wins. With
 * neither, the free policy leaves the choice to capability ranking (`undefined`) rather than the
 * router, because the router may answer with a very small model. Any situation where ranking would
 * have nothing to rank falls back to the router, which needs no catalog.
 */
export function startupModelRequest(
  entries: readonly CatalogEntry[],
  input: { requestedModel?: string; policy: ModelPolicy; explicitModelSelection: boolean },
): string | undefined {
  const { requestedModel, policy, explicitModelSelection } = input;
  if (entries.length === 0) return FREE_ROUTER_ID;
  if (policy !== "free") return requestedModel;
  if (explicitModelSelection) return requestedModel;
  if (requestedModel) {
    if (requestedModel.trim().toLowerCase() === FREE_ROUTER_ID) return requestedModel;
    const saved = resolveCatalogModel(entries, requestedModel);
    if (saved && isGuaranteedFree(saved)) return requestedModel;
  }
  const hasRankedFree = eligible(entries, { requiresTools: true }).some(
    (entry) => isGuaranteedFree(entry) && !isFreeRouter(entry),
  );
  return hasRankedFree ? undefined : FREE_ROUTER_ID;
}
