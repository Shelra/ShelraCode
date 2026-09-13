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

function costScore(entry: CatalogEntry): number {
  return entry.cost.pricingKnown === false ? Number.POSITIVE_INFINITY : entry.cost.prompt + entry.cost.completion;
}

function rank(entries: CatalogEntry[], policy: ModelPolicy): CatalogEntry[] {
  return [...entries].sort((a, b) => {
    const aFree = isGuaranteedFree(a);
    const bFree = isGuaranteedFree(b);
    if (aFree !== bFree) return aFree ? -1 : 1;
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

  const candidates = rank(
    eligible(entries, request).filter((entry) => policy !== "free" || isGuaranteedFree(entry)),
    policy,
  );
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
      "ranked by cost first, then context",
    ].filter((reason): reason is string => Boolean(reason)),
  };
}
