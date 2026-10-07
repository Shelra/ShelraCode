import { createDefaultRegistry, defaultResolveDeps } from "../providers/default-registry";
import { isValidOmniRouteBaseURL, normalizeOmniRouteBaseURL } from "../providers/omniroute";
import type { CredentialField, ProviderDefinition, ProviderRegistry, ResolveDeps } from "../providers/registry";
import { loadFreeAttestations, setFreeModelPatterns, setFreePlanProvider } from "../routing/attestations";
import { classifyFreeEligibility, type FreeAttestations } from "../routing/eligibility";
import {
  clearOpenRouterApiKey,
  clearProviderCredential,
  saveOpenRouterApiKey,
  saveProviderCredential,
} from "../security/credentials";
import { loadUserSettings, saveUserSettings } from "../utils/settings";

/*
 * Connecting, testing and disconnecting providers: what the first-run setup and `/config` do with keys. One service
 * for both, so a key entered in either lands in the same place as `shelra auth` puts it (the credential store, never
 * the settings file) and is tried before it is kept: a typo is found while the person is still looking at the box.
 */

export interface ProviderAdminRow {
  id: string;
  name: string;
  connected: boolean;
  /** Where the working configuration comes from ("OPENROUTER_API_KEY", "`shelra auth groq`"). */
  source?: string;
  /** A key or address saved with Shelra, which "disconnect" removes. */
  stored: boolean;
  /** Set in the environment, which wins over what is saved and is not Shelra's to remove. */
  fromEnvironment: boolean;
  fields: readonly CredentialField[];
  keyUrl?: string;
  /** Its free plan stops at a quota and bills a billed key, so Free mode needs the person to say theirs has none. */
  hasFreePlan: boolean;
  freePlanDeclared: boolean;
  plan?: string;
  privacy?: string;
  /** Models of this provider the person vouched for by name. */
  vouched: string[];
}

export interface ConnectInput {
  apiKey?: string;
  accountId?: string;
  url?: string;
}

export type ConnectResult =
  | { ok: true; models: number; free: number; warning?: string }
  /** `needs` names the one field the provider could not work out from the key: ask for it, then connect again. */
  | { ok: false; error: string; needs?: ConnectField };

export type ConnectField = "apiKey" | "accountId" | "url";

export interface ProviderAdminDeps {
  registry: ProviderRegistry;
  resolveDeps: () => ResolveDeps;
  attestations: () => FreeAttestations;
  fetch?: typeof fetch;
  /** How long a test of a credential may take. */
  timeoutMs?: number;
  save: (providerId: string, input: ConnectInput) => void;
  remove: (providerId: string) => void;
  setFreePlan: (providerId: string, declared: boolean) => void;
  setPatterns: (providerId: string, patterns: readonly string[]) => void;
  stored: (providerId: string) => boolean;
}

function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) if (secret && secret.length >= 4) out = out.split(secret).join("***");
  return out;
}

/** Saves a credential where `shelra auth` does. */
export function saveProviderInput(providerId: string, input: ConnectInput): void {
  if (providerId === "openrouter") {
    saveOpenRouterApiKey(input.apiKey ?? "");
    return;
  }
  if (providerId === "omniroute") {
    if (input.url) saveUserSettings({ omniroute: { baseUrl: normalizeOmniRouteBaseURL(input.url) } });
    if (input.apiKey) saveProviderCredential(providerId, { apiKey: input.apiKey });
    return;
  }
  saveProviderCredential(providerId, {
    apiKey: input.apiKey ?? "",
    ...(input.accountId ? { accountId: input.accountId } : {}),
  });
}

export function removeProviderInput(providerId: string): void {
  if (providerId === "openrouter") clearOpenRouterApiKey();
  else clearProviderCredential(providerId);
  if (providerId === "omniroute") saveUserSettings({ omniroute: undefined });
}

export function createProviderAdmin(overrides: Partial<ProviderAdminDeps> = {}): ProviderAdmin {
  const registry = overrides.registry ?? createDefaultRegistry();
  const deps: ProviderAdminDeps = {
    registry,
    resolveDeps: overrides.resolveDeps ?? defaultResolveDeps(),
    attestations: overrides.attestations ?? (() => loadFreeAttestations()),
    save: overrides.save ?? saveProviderInput,
    remove: overrides.remove ?? removeProviderInput,
    setFreePlan: overrides.setFreePlan ?? setFreePlanProvider,
    setPatterns: overrides.setPatterns ?? setFreeModelPatterns,
    stored:
      overrides.stored ??
      ((providerId) => {
        const resolved = defaultResolveDeps()();
        if (providerId === "omniroute")
          return Boolean(loadUserSettings().omniroute?.baseUrl) || Boolean(resolved.storedCredential(providerId));
        return Boolean(resolved.storedCredential(providerId));
      }),
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    ...(overrides.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {}),
  };
  return new ProviderAdmin(deps);
}

export class ProviderAdmin {
  constructor(private readonly deps: ProviderAdminDeps) {}

  /** One row per provider, for the list the person picks from. */
  rows(): ProviderAdminRow[] {
    const attestations = this.deps.attestations();
    const resolveDeps = this.deps.resolveDeps();
    return this.deps.registry.list().map((definition) => {
      const configs = definition.resolveConfigs(resolveDeps);
      const first = configs[0];
      const stored = this.deps.stored(definition.id);
      const fromEnvironment = Boolean(first) && !String(first?.source).startsWith("`shelra");
      const hasFreePlan = Boolean(definition.freePlan) && !definition.selfEnforcing;
      return {
        id: definition.id,
        name: definition.name,
        connected: configs.length > 0,
        ...(first ? { source: first.source } : {}),
        stored,
        fromEnvironment,
        fields: definition.fields,
        ...(definition.keyUrl ? { keyUrl: definition.keyUrl } : {}),
        hasFreePlan,
        freePlanDeclared: attestations.freePlanProviders.has(definition.id),
        ...(definition.freePlan ? { plan: definition.freePlan.plan } : {}),
        ...(definition.freePlan?.privacy ? { privacy: definition.freePlan.privacy } : {}),
        vouched: [...(attestations.freeModelPatterns[definition.id] ?? [])],
      };
    });
  }

  /** Reads the values a person typed into the provider's fields and says what is missing or wrong, before any network. */
  validateInput(definition: ProviderDefinition, input: ConnectInput): string | null {
    for (const field of definition.fields) {
      const value = (input[field.name] ?? "").trim();
      if (!value && !field.optional) return `${field.label} is required.`;
      if (field.name === "url" && value && !isValidOmniRouteBaseURL(value)) {
        return `${field.label} must start with http:// or https://.`;
      }
      if (field.secret && /\s/u.test(value)) return `${field.label} has spaces in it; paste only the key.`;
    }
    return null;
  }

  /**
   * Tries the credential against the provider, and keeps it only when it works (or, with `keepIfUnreachable`, when the
   * provider could not be reached at all, which says nothing about the key). Never returns or logs the secret.
   */
  async connect(
    providerId: string,
    rawInput: ConnectInput,
    options: { keepIfUnreachable?: boolean; signal?: AbortSignal } = {},
  ): Promise<ConnectResult> {
    const definition = this.deps.registry.get(providerId);
    if (!definition) return { ok: false, error: `Unknown provider "${providerId}".` };
    const input: ConnectInput = {
      ...(rawInput.apiKey?.trim() ? { apiKey: rawInput.apiKey.trim() } : {}),
      ...(rawInput.accountId?.trim() ? { accountId: rawInput.accountId.trim() } : {}),
      ...(rawInput.url?.trim() ? { url: rawInput.url.trim() } : {}),
    };
    // Fields the provider can work out from the key are not asked for; only what it could not find is.
    const missingDerived = definition.fields.filter((field) => field.derived && !input[field.name]);
    if (missingDerived.length > 0 && definition.deriveFields && input.apiKey) {
      const lookup = AbortSignal.timeout(this.deps.timeoutMs ?? 8_000);
      const derived = await definition.deriveFields(input, {
        ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}),
        signal: options.signal ? AbortSignal.any([options.signal, lookup]) : lookup,
      });
      for (const [name, value] of Object.entries(derived.found ?? {})) {
        if (value) input[name as ConnectField] = value;
      }
      if (derived.rejected) return { ok: false, error: redact(derived.rejected, [input.apiKey]) };
      const stillMissing = missingDerived.find((field) => !input[field.name] && !field.optional);
      if (stillMissing) {
        const hint = derived.hints?.[stillMissing.name] ?? stillMissing.hint;
        return {
          ok: false,
          error: redact(hint ? `${stillMissing.label} is needed. ${hint}` : `${stillMissing.label} is required.`, [
            input.apiKey,
          ]),
          needs: stillMissing.name,
        };
      }
    }
    const problem = this.validateInput(definition, input);
    if (problem) return { ok: false, error: problem };

    const candidate: ResolveDeps = {
      env: {},
      storedCredential: (id) =>
        id === providerId && input.apiKey
          ? { apiKey: input.apiKey, ...(input.accountId ? { accountId: input.accountId } : {}) }
          : undefined,
      settings: providerId === "omniroute" && input.url ? { omniroute: { baseUrl: input.url } } : {},
    };
    const config = definition.resolveConfigs(candidate)[0];
    if (!config) return { ok: false, error: "These values do not make a working connection." };

    const timeout = AbortSignal.timeout(this.deps.timeoutMs ?? 8_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const context = { ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}), signal };
    const secrets = [input.apiKey, input.accountId];
    let unreachable = false;
    try {
      await definition.validateCredential?.(config, context);
      const entries = await definition.discoverModels(config, context);
      this.deps.save(providerId, input);
      const attestations = this.deps.attestations();
      const free = entries.filter((entry) => classifyFreeEligibility(entry, attestations).eligible).length;
      return { ok: true, models: entries.length, free };
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error), secrets);
      // A refusal is the key's fault; a timeout or a refused connection is the network's or the service's.
      unreachable = /fetch failed|timed? ?out|timeout|ECONN|ENOTFOUND|network|aborted/iu.test(message);
      if (unreachable && options.keepIfUnreachable) {
        this.deps.save(providerId, input);
        return {
          ok: true,
          models: 0,
          free: 0,
          warning: `Saved, but ${definition.name} could not be reached to check it (${message}).`,
        };
      }
      return { ok: false, error: message };
    }
  }

  disconnect(providerId: string): void {
    this.deps.remove(providerId);
    // What was declared about a key is void once the key is gone.
    this.deps.setFreePlan(providerId, false);
    this.deps.setPatterns(providerId, []);
  }

  setFreePlan(providerId: string, declared: boolean): void {
    this.deps.setFreePlan(providerId, declared);
  }
}
