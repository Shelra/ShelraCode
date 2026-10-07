import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { ModelPolicy } from "../models/routing";
import type { CatalogEntry } from "../models/types";
import type { ProviderCredential } from "../security/credentials";
import type { ProviderAdapter } from "./types";

/**
 * The one place that knows which providers exist. Everything else (the catalog, the router, the guard, the CLI, the
 * model picker) asks the registry, so a provider is added by writing a `ProviderDefinition` and listing it in
 * `defaultProviderDefinitions`, not by editing a switch in each of them.
 */

/** A provider's connection: where it is, and the key when it takes one. */
export interface ProviderConfig {
  providerId: string;
  baseURL: string;
  /** Absent for a keyless endpoint. */
  credential?: ProviderCredential;
  /** Where it came from, for notices ("OPENROUTER_API_KEY", "`shelra auth groq`"). Never the key. */
  source: string;
}

/** What a definition may read to find its configuration. Injected so tests never touch a real home folder. */
export interface ResolveDeps {
  env: NodeJS.ProcessEnv;
  storedCredential: (providerId: string) => ProviderCredential | undefined;
  /** Non-secret provider settings from `user-settings.json`. */
  settings: { omniroute?: { baseUrl?: string } };
}

export interface DiscoverContext {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  now?: () => number;
}

/** One answer's route as the provider reported it, when it reports one. */
export interface ServedRoute {
  /** The provider that actually ran the request, when a gateway says so. */
  servedProviderId?: string;
  servedModelId?: string;
  /** Cost the provider reports for the request, USD. */
  costUsd?: number;
}

export interface AdapterContext {
  /** The session's model mode, read live: it can change during the session. */
  policy: () => ModelPolicy;
  /** The provider's own catalog entries as last discovered. */
  entries: () => readonly CatalogEntry[];
  fetch?: FetchFunction;
  /** Called after each answer by a provider that reports who served it. */
  onServed?: (routeId: string, served: ServedRoute) => void;
}

/** One thing a person types to connect a provider. */
export interface CredentialField {
  name: "apiKey" | "accountId" | "url";
  label: string;
  /** Hidden while typed, and kept in the credential store (never the settings file). */
  secret: boolean;
  optional?: boolean;
  /**
   * The provider can work this out from the key (`deriveFields`): the person is asked for it only when it cannot.
   * Every provider asks for the key alone whenever it can.
   */
  derived?: boolean;
  /** One line that helps: where the value comes from. */
  hint?: string;
}

/** What `deriveFields` found, and what to tell the person about each field it could not find. */
export interface DerivedFields {
  found?: Partial<Record<CredentialField["name"], string>>;
  hints?: Partial<Record<CredentialField["name"], string>>;
  /** The provider refused the key itself: say so, and ask for nothing else. */
  rejected?: string;
}

export interface ProviderDefinition {
  /** The namespace of its canonical model ids: `groq` in `groq/openai/gpt-oss-120b`. */
  id: string;
  name: string;
  /** What to do when it is not configured. */
  setupHint: string;
  /** What `/config` and the first-run setup ask for, in order. */
  fields: readonly CredentialField[];
  /** Where a person gets a key, shown while asking for it. */
  keyUrl?: string;
  /**
   * Works out the fields marked `derived` from what the person already gave (Cloudflare's account id from its
   * token). Never throws: what it cannot find it leaves out, and the person is asked for that field alone.
   */
  deriveFields?: (
    input: Partial<Record<CredentialField["name"], string>>,
    context: DiscoverContext,
  ) => Promise<DerivedFields>;
  /**
   * Checks the credential itself when listing models would not (OpenRouter lists its models without a key).
   * Throws an Error whose message says why; resolves when the credential works.
   */
  validateCredential?: (config: ProviderConfig, context: DiscoverContext) => Promise<void>;
  /** Every configuration the environment and the stores offer, preferred first (an account may have several keys). */
  resolveConfigs(deps: ResolveDeps): ProviderConfig[];
  /** Its models. Bounded by the caller's signal; throws when it cannot answer. */
  discoverModels(config: ProviderConfig, context: DiscoverContext): Promise<CatalogEntry[]>;
  /** An adapter that speaks canonical ids (`provider/model`) on its public surface. */
  createAdapter(config: ProviderConfig, context: AdapterContext): ProviderAdapter;
  /** What the free plan allows, who pays beyond it, and what the provider may do with prompts. Absent: no free plan. */
  freePlan?: { plan: string; privacy?: string };
  /** The model a Mixed session starts on when the user picked none, if this provider has a sensible router. */
  mixedDefaultModelId?: string;
  /** True when requests can go out without a key. */
  keyless?: boolean;
  /** True when this provider can bill an account: Free mode treats its models as unproven until shown otherwise. */
  canBill: boolean;
  /** True when its adapter refuses a model that is not free on its own (the OpenRouter adapter reads prices itself). */
  selfEnforcing?: boolean;
}

export interface ConfiguredProvider {
  definition: ProviderDefinition;
  /** Preferred first. */
  configs: ProviderConfig[];
}

export class ProviderRegistry {
  private readonly byId = new Map<string, ProviderDefinition>();

  constructor(definitions: readonly ProviderDefinition[]) {
    for (const definition of definitions) {
      const id = definition.id.toLowerCase();
      if (this.byId.has(id)) throw new Error(`Provider "${id}" is registered twice.`);
      this.byId.set(id, definition);
    }
  }

  ids(): ReadonlySet<string> {
    return new Set(this.byId.keys());
  }

  get(id: string): ProviderDefinition | undefined {
    return this.byId.get(id.toLowerCase());
  }

  list(): ProviderDefinition[] {
    return [...this.byId.values()];
  }

  /** The providers the user can reach now, in registration order. */
  configured(deps: ResolveDeps): ConfiguredProvider[] {
    return this.list().flatMap((definition) => {
      try {
        const configs = definition.resolveConfigs(deps);
        return configs.length > 0 ? [{ definition, configs }] : [];
      } catch {
        // A definition that cannot read its configuration is simply not configured.
        return [];
      }
    });
  }
}
