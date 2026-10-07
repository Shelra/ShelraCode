import { fetchOpenRouterCatalog, OPENROUTER_BASE_URL } from "../../models/openrouter";
import { createOpenRouterProvider } from "../openrouter";
import type { ProviderConfig, ProviderDefinition, ResolveDeps } from "../registry";

/** Environment variables that name an OpenRouter key; a key meant for another service is never read as one. */
const KEY_ENV = ["OPENROUTER_API_KEY", "KEY_OPENROUTER"] as const;

function resolveConfigs(deps: ResolveDeps): ProviderConfig[] {
  const sources: Array<{ key: string | undefined; source: string }> = [
    ...KEY_ENV.map((name) => ({ key: deps.env[name], source: name })),
    { key: deps.storedCredential("openrouter")?.apiKey, source: "`shelra auth openrouter`" },
  ];
  const seen = new Set<string>();
  return sources.flatMap(({ key, source }) => {
    const trimmed = key?.trim();
    if (!trimmed || seen.has(trimmed)) return [];
    seen.add(trimmed);
    return [{ providerId: "openrouter", baseURL: OPENROUTER_BASE_URL, credential: { apiKey: trimmed }, source }];
  });
}

export const OPENROUTER_FREE_PLAN =
  "free models: 20 requests a minute and 50 a day (1,000 a day after buying $10 of credits); a paid model is never used in Free mode";

/** OpenRouter: priced per model, so its free models are known free from its own catalog. */
export function openRouterDefinition(): ProviderDefinition {
  return {
    id: "openrouter",
    name: "OpenRouter",
    canBill: true,
    selfEnforcing: true,
    setupHint: "set OPENROUTER_API_KEY or run `shelra auth openrouter <key>`",
    fields: [{ name: "apiKey", label: "OpenRouter API key", secret: true, hint: "starts with sk-or-" }],
    keyUrl: "https://openrouter.ai/keys",
    async validateCredential(config, context) {
      // OpenRouter lists its models to anyone, so the models call proves nothing about the key; /key does.
      const response = await (context.fetch ?? fetch)(`${config.baseURL.replace(/\/+$/u, "")}/key`, {
        headers: { Authorization: `Bearer ${config.credential?.apiKey ?? ""}` },
        signal: context.signal,
      });
      if (response.status === 401 || response.status === 403) throw new Error("OpenRouter rejected this key.");
      if (!response.ok) throw new Error(`OpenRouter answered HTTP ${response.status} when checking the key.`);
    },
    freePlan: { plan: OPENROUTER_FREE_PLAN },
    mixedDefaultModelId: "openrouter/auto",
    resolveConfigs,
    async discoverModels(config, context) {
      const result = await fetchOpenRouterCatalog({
        ...(config.credential ? { apiKey: config.credential.apiKey } : {}),
        baseURL: config.baseURL,
        ...(context.signal ? { signal: context.signal } : {}),
        ...(context.fetch ? { fetchImpl: context.fetch } : {}),
        ...(context.now ? { now: context.now } : {}),
      });
      if (result.entries.length === 0) throw new Error(result.error ?? "OpenRouter returned no usable models");
      return result.entries;
    },
    createAdapter(config, context) {
      return createOpenRouterProvider(config.credential?.apiKey ?? "", {
        baseURL: config.baseURL,
        entries: context.entries,
        requireParameters: true,
        policy: context.policy(),
        ...(context.fetch ? { fetch: context.fetch } : {}),
      });
    },
  };
}
