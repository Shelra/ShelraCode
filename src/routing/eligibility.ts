import type { CatalogEntry } from "../models/types";

/**
 * What Shelra can prove about a model's cost, which is all Free mode may rest on. Unknown cost is never free.
 *
 * - `guaranteed-free`: the provider's own pricing says zero and Shelra trusts that contract (OpenRouter's `:free`
 *   variants and free router), or the model runs on this machine.
 * - `free-tier`: a free plan, not a price: it stops at a quota, and a key on a billed account can charge beyond it.
 *   Eligible only when the user said the key has no billing (a free-plan attestation), or vouched for the model.
 * - `unknown`: no authoritative price (a gateway's catalog, a missing field). Excluded, unless the user vouched.
 * - `paid`: priced above zero, or a router that bills whichever model it picks. Never eligible, never vouchable.
 */
export type FreeEligibilityLevel = "guaranteed-free" | "free-tier" | "unknown" | "paid";

export interface FreeEligibility {
  level: FreeEligibilityLevel;
  /** True when Free mode may run this model. */
  eligible: boolean;
  /** Why, in words a notice or a trace can repeat. Never a secret. */
  evidence: string;
}

/**
 * What the user declared, stored in settings (not secret): the providers whose key is on a plan with no billing, and
 * model patterns they vouch for. A pattern is relative to the provider (`opencode-free/*`); `*` only ends it.
 */
export interface FreeAttestations {
  freePlanProviders: ReadonlySet<string>;
  freeModelPatterns: Readonly<Record<string, readonly string[]>>;
}

export const NO_ATTESTATIONS: FreeAttestations = { freePlanProviders: new Set(), freeModelPatterns: {} };

/** OpenRouter's own routers: the free one answers with a free model, the auto ones bill whichever model they pick. */
const FREE_ROUTER_IDS = new Set(["openrouter/free"]);
const BILLING_ROUTER_IDS = new Set(["openrouter/auto", "openrouter/auto-beta"]);

function providerModelIdOf(entry: CatalogEntry): string {
  return entry.state.kind === "cloud" ? entry.state.providerModelId : entry.id;
}

/** A model that is really a router: it picks the model that serves the request, so what it costs is not its own. */
export function isRouterEntry(entry: CatalogEntry): boolean {
  if (entry.state.kind === "cloud" && entry.state.router === true) return true;
  const id = entry.id.trim().toLowerCase();
  return FREE_ROUTER_IDS.has(id) || BILLING_ROUTER_IDS.has(id);
}

function matchesPattern(modelId: string, pattern: string): boolean {
  const id = modelId.toLowerCase();
  const wanted = pattern.trim().toLowerCase();
  if (!wanted) return false;
  return wanted.endsWith("*") ? id.startsWith(wanted.slice(0, -1)) : id === wanted;
}

function vouchedFor(entry: CatalogEntry, attestations: FreeAttestations): boolean {
  const patterns = attestations.freeModelPatterns[entry.provider] ?? [];
  const modelId = providerModelIdOf(entry);
  return patterns.some((pattern) => matchesPattern(modelId, pattern));
}

function pricedZero(entry: CatalogEntry): boolean {
  const { cost } = entry;
  return cost.pricingKnown !== false && cost.prompt === 0 && cost.completion === 0 && (cost.request ?? 0) === 0;
}

function pricedAboveZero(entry: CatalogEntry): boolean {
  const { cost } = entry;
  return cost.prompt > 0 || cost.completion > 0 || (cost.request ?? 0) > 0;
}

/**
 * Classifies one catalog entry. Pure: the same entry and attestations always give the same answer, so Free routing and
 * the guard that backs it up cannot disagree.
 */
export function classifyFreeEligibility(
  entry: CatalogEntry,
  attestations: FreeAttestations = NO_ATTESTATIONS,
): FreeEligibility {
  const id = entry.id.trim().toLowerCase();
  if (FREE_ROUTER_IDS.has(id)) {
    return {
      level: "guaranteed-free",
      eligible: true,
      evidence: "OpenRouter's free router answers with free models only",
    };
  }
  if (entry.category === "local") {
    return { level: "guaranteed-free", eligible: true, evidence: "runs on this machine" };
  }
  if (isRouterEntry(entry)) {
    // A router bills whichever model it picks, and a gateway's free filter can fail open: never eligible, never vouchable.
    return { level: "paid", eligible: false, evidence: "a router that can pick a paid model" };
  }
  if (pricedAboveZero(entry)) {
    return { level: "paid", eligible: false, evidence: "the provider lists a price above zero" };
  }
  const basis = entry.cost.basis;
  if (basis === "published-zero" || (basis === undefined && entry.provider === "openrouter")) {
    if (entry.cost.free === true && pricedZero(entry)) {
      return { level: "guaranteed-free", eligible: true, evidence: "the provider lists a price of zero" };
    }
    if (vouchedFor(entry, attestations)) {
      return { level: "free-tier", eligible: true, evidence: "vouched for in your settings" };
    }
    return { level: "unknown", eligible: false, evidence: "the provider did not list a price" };
  }
  if (vouchedFor(entry, attestations)) {
    return { level: "free-tier", eligible: true, evidence: "vouched for in your settings" };
  }
  if (basis === "free-tier") {
    if (attestations.freePlanProviders.has(entry.provider)) {
      return { level: "free-tier", eligible: true, evidence: "free plan, with a key you declared has no billing" };
    }
    return {
      level: "free-tier",
      eligible: false,
      evidence: `a free plan, but a billed key would be charged: run \`shelra providers allow-free ${entry.provider}\` if yours has no billing`,
    };
  }
  return { level: "unknown", eligible: false, evidence: "no authoritative price for this model" };
}

/** True when Free mode may run the entry. */
export function isFreeEligible(entry: CatalogEntry, attestations: FreeAttestations = NO_ATTESTATIONS): boolean {
  return classifyFreeEligibility(entry, attestations).eligible;
}
