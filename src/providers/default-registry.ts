import { loadFreeAttestations } from "../routing/attestations";
import { getStoredOpenRouterApiKey, getStoredProviderCredential } from "../security/credentials";
import { loadUserSettings, sessionModelPolicy } from "../utils/settings";
import { freePlanDefinitions } from "./definitions/free-plan";
import { omniRouteDefinition } from "./definitions/omniroute";
import { openRouterDefinition } from "./definitions/openrouter";
import type { FreeGuardOptions } from "./free-guard";
import { type ProviderDefinition, ProviderRegistry, type ResolveDeps } from "./registry";

/**
 * Every provider Shelra can route to, in the order they are listed and tried when nothing else ranks them. Adding a
 * provider is writing its `ProviderDefinition` and listing it here: the catalog, the router, the guard, `shelra auth`
 * and `shelra providers` all read the registry.
 */
export function defaultProviderDefinitions(): ProviderDefinition[] {
  return [openRouterDefinition(), ...freePlanDefinitions(), omniRouteDefinition()];
}

export function createDefaultRegistry(): ProviderRegistry {
  return new ProviderRegistry(defaultProviderDefinitions());
}

export interface ResolveOverrides {
  /** An OpenRouter key given for this run (`--api-key`): tried before the environment and the stored one. */
  openRouterKey?: string;
}

/** Where a provider's configuration comes from in the product: the environment, the credential store, the settings. */
export function defaultResolveDeps(overrides: ResolveOverrides = {}): () => ResolveDeps {
  return () => ({
    env: overrides.openRouterKey ? { ...process.env, OPENROUTER_API_KEY: overrides.openRouterKey } : process.env,
    storedCredential: (providerId) => {
      if (providerId === "openrouter") {
        const apiKey = getStoredOpenRouterApiKey();
        return apiKey ? { apiKey } : undefined;
      }
      return getStoredProviderCredential(providerId);
    },
    settings: loadUserSettings(),
  });
}

/** Provider ids that can bill an account, read once from the definitions. */
let billableIds: ReadonlySet<string> | undefined;
function billableProviderIds(): ReadonlySet<string> {
  billableIds ??= new Set(
    defaultProviderDefinitions()
      .filter((definition) => definition.canBill && !definition.selfEnforcing)
      .map((d) => d.id),
  );
  return billableIds;
}

/** How `Agent.setProvider` checks an adapter that did not come through the routing provider. */
export function defaultFreeGuardOptions(): FreeGuardOptions {
  return {
    policy: sessionModelPolicy,
    declaredFree: () => loadFreeAttestations().freePlanProviders,
    billableProviderIds: billableProviderIds(),
  };
}

let displayNames: ReadonlyMap<string, string> | undefined;

/** A provider's name for people ("Groq"), from its id; the id itself for one that is not registered. */
export function providerDisplayName(providerId: string): string {
  displayNames ??= new Map(defaultProviderDefinitions().map((definition) => [definition.id, definition.name]));
  return displayNames.get(providerId) ?? providerId;
}

/** The registered provider ids in the order their groups are listed. */
export function providerListOrder(): string[] {
  return defaultProviderDefinitions().map((definition) => definition.id);
}
