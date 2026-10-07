import { loadUserSettings, saveUserSettings, type UserSettings } from "../utils/settings";
import type { FreeAttestations } from "./eligibility";

/**
 * Providers the user named for this run only (`--provider groq`): an explicit choice of that provider for the run,
 * which says its key is the one they mean to use. Never saved, never read by another process.
 */
const sessionFreePlanProviders = new Set<string>();

export function declareFreePlanForSession(providerId: string): void {
  sessionFreePlanProviders.add(providerId);
}

/** What the user declared about Free eligibility, read from `user-settings.json` on every call (it can change live). */
export function loadFreeAttestations(settings: UserSettings = loadUserSettings()): FreeAttestations {
  const access = settings.freeAccess;
  const freePlanProviders = new Set([...sessionFreePlanProviders]);
  for (const id of access?.freePlanProviders ?? []) {
    if (typeof id === "string" && id.trim() !== "") freePlanProviders.add(id);
  }
  const freeModelPatterns: Record<string, string[]> = {};
  for (const [provider, patterns] of Object.entries(access?.freeModels ?? {})) {
    if (!Array.isArray(patterns)) continue;
    const clean = patterns.filter((pattern): pattern is string => typeof pattern === "string" && pattern.trim() !== "");
    if (clean.length > 0) freeModelPatterns[provider.toLowerCase()] = clean;
  }
  return { freePlanProviders, freeModelPatterns };
}

/** Declares that the provider's key is on a plan with no billing, or withdraws the declaration. */
export function setFreePlanProvider(providerId: string, free: boolean): void {
  const access = loadUserSettings().freeAccess ?? {};
  const providers = new Set(access.freePlanProviders ?? []);
  if (free) providers.add(providerId);
  else providers.delete(providerId);
  saveUserSettings({ freeAccess: { ...access, freePlanProviders: [...providers].sort() } });
}

/** Vouches for (or withdraws) model patterns of one provider. */
export function setFreeModelPatterns(providerId: string, patterns: readonly string[]): void {
  const access = loadUserSettings().freeAccess ?? {};
  const models = { ...(access.freeModels ?? {}) };
  if (patterns.length > 0) models[providerId] = [...patterns];
  else delete models[providerId];
  saveUserSettings({ freeAccess: { ...access, freeModels: models } });
}
