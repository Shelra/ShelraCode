import type { CatalogEntry } from "../../models/types";
import { createOpenAICompatibleProvider } from "../../runtimes/local-provider";
import { withCanonicalIds } from "../canonical-adapter";
import { FREE_PROVIDER_IDS, FREE_PROVIDERS, type FreeProviderPreset } from "../free-providers";
import type { DerivedFields, DiscoverContext, ProviderConfig, ProviderDefinition, ResolveDeps } from "../registry";

/**
 * Groq, Gemini and Cloudflare Workers AI: providers with a free plan, not a price. Their models are `free-tier`:
 * Free mode runs them only when the user declared the key has no billing (`shelra providers allow-free <id>`),
 * because a key on a billed account is charged past the free quota.
 */

const MAX_DISCOVERED = 300;
const NOT_CHAT =
  /whisper|tts|guard|embed|moderation|imagen|image|veo|aqa|transcri|audio|playai|safeguard|rerank|orpheus/i;
const REASONING = /gpt-oss|qwq|deepseek-r1|qwen3|gemini-(?:2\.5|3)|reason|think|\br1\b|magistral|kimi-k2/i;
const VISION = /gemini|vision|llama-4|pixtral|gemma-3|qwen.*vl/i;

function fromEnv(names: readonly string[] | undefined, env: NodeJS.ProcessEnv): { value: string; name: string } | null {
  for (const name of names ?? []) {
    const value = env[name]?.trim();
    if (value) return { value, name };
  }
  return null;
}

function resolveConfigsFor(preset: FreeProviderPreset, deps: ResolveDeps): ProviderConfig[] {
  const saved = deps.storedCredential(preset.id);
  const key = fromEnv(preset.keyEnv, deps.env);
  const apiKey = key?.value ?? saved?.apiKey;
  if (!apiKey) return [];
  const accountId = fromEnv(preset.accountEnv, deps.env)?.value ?? saved?.accountId;
  if (preset.accountEnv && !accountId) return [];
  return [
    {
      providerId: preset.id,
      baseURL: preset.baseURL(accountId),
      credential: { apiKey, ...(accountId ? { accountId } : {}) },
      source: key ? key.name : `\`shelra auth ${preset.id}\``,
    },
  ];
}

function entryFor(
  preset: FreeProviderPreset,
  providerModelId: string,
  curated: boolean,
  contextWindow: number | undefined,
  fetchedAt: string,
): CatalogEntry {
  return {
    id: `${preset.id}/${providerModelId}`,
    category: "cloud",
    provider: preset.id,
    name: `${preset.name} · ${providerModelId}`,
    description: preset.plan,
    contextWindow: contextWindow ?? 128_000,
    // A curated model is one Shelra's authors checked with tools; a discovered one is a guess until measured.
    contextConfidence: curated ? "declared" : "fallback",
    capabilities: {
      tools: true,
      reasoning: REASONING.test(providerModelId),
      vision: VISION.test(providerModelId),
      structuredOutput: curated,
    },
    cost: { prompt: 0, completion: 0, free: true, pricingKnown: true, basis: "free-tier" },
    state: { kind: "cloud", providerModelId, apiKeyConfigured: true, notes: [preset.plan] },
    fetchedAt,
  };
}

function numberField(item: Record<string, unknown>, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = item[name];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

async function discover(
  preset: FreeProviderPreset,
  config: ProviderConfig,
  context: DiscoverContext,
): Promise<CatalogEntry[]> {
  const fetchedAt = new Date((context.now ?? Date.now)()).toISOString();
  const curated = preset.models.map((id) => entryFor(preset, id, true, undefined, fetchedAt));
  // Cloudflare's OpenAI-compatible route lists no models; its curated ones are the catalog.
  if (preset.id === "cloudflare") return curated;
  const response = await (context.fetch ?? fetch)(`${config.baseURL.replace(/\/+$/u, "")}/models`, {
    headers: {
      Accept: "application/json",
      ...(config.credential ? { Authorization: `Bearer ${config.credential.apiKey}` } : {}),
    },
    signal: context.signal,
  });
  if (!response.ok) throw new Error(`${preset.name} model list answered HTTP ${response.status}`);
  const body = (await response.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) throw new Error(`${preset.name} model list had no data`);
  const byId = new Map(curated.map((entry) => [(entry.state as { providerModelId: string }).providerModelId, entry]));
  for (const item of body.data.slice(0, MAX_DISCOVERED)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string") continue;
    const id = record.id.replace(/^models\//u, "");
    if (!id || NOT_CHAT.test(id) || record.active === false) continue;
    const context_ = numberField(record, "context_window", "context_length", "inputTokenLimit");
    const known = byId.get(id);
    if (known) {
      if (context_) known.contextWindow = context_;
      continue;
    }
    byId.set(id, entryFor(preset, id, false, context_, fetchedAt));
  }
  return [...byId.values()];
}

/**
 * Cloudflare's endpoint names the account, but the token already says which accounts it reaches: ask Cloudflare, and
 * use the account when there is exactly one. A token that may not list its accounts, or reaches several, leaves the
 * person to paste the id, with a line that says why.
 */
async function deriveCloudflareAccount(
  input: Partial<Record<"apiKey" | "accountId" | "url", string>>,
  context: DiscoverContext,
): Promise<DerivedFields> {
  if (input.accountId || !input.apiKey) return {};
  const where = "Cloudflare dashboard, account home (the id in the address bar).";
  try {
    const response = await (context.fetch ?? fetch)("https://api.cloudflare.com/client/v4/accounts?per_page=50", {
      headers: { Accept: "application/json", Authorization: `Bearer ${input.apiKey}` },
      signal: context.signal,
    });
    // 401 is the token's fault; 403 is a token that may not list accounts.
    if (response.status === 401) return { rejected: "Cloudflare rejected this token." };
    if (response.status === 403) {
      return { hints: { accountId: `This token cannot list its accounts. Paste the account id: ${where}` } };
    }
    if (!response.ok) return { hints: { accountId: `Paste the account id: ${where}` } };
    const body = (await response.json()) as { result?: { id?: unknown; name?: unknown }[] };
    const accounts = (body.result ?? []).filter(
      (item): item is { id: string; name?: unknown } => typeof item.id === "string",
    );
    const only = accounts.length === 1 ? accounts[0] : undefined;
    if (only) return { found: { accountId: only.id } };
    if (accounts.length === 0) {
      return { hints: { accountId: `This token reaches no account. Paste the account id: ${where}` } };
    }
    const names = accounts
      .map((item) => `${typeof item.name === "string" ? item.name : "account"} ${item.id}`)
      .join("; ");
    return { hints: { accountId: `This token reaches several accounts (${names}). Paste the one to use.` } };
  } catch {
    return { hints: { accountId: `Cloudflare could not be asked. Paste the account id: ${where}` } };
  }
}

const KEY_URLS: Record<string, string> = {
  groq: "https://console.groq.com/keys",
  gemini: "https://aistudio.google.com/apikey",
  cloudflare: "https://dash.cloudflare.com/profile/api-tokens",
};

export function freePlanDefinition(preset: FreeProviderPreset): ProviderDefinition {
  return {
    id: preset.id,
    name: preset.name,
    canBill: true,
    freePlan: { plan: preset.plan, ...(preset.privacy ? { privacy: preset.privacy } : {}) },
    // The key first and alone: an account id, where the endpoint needs one, is found from the token.
    fields: [
      { name: "apiKey", label: preset.accountEnv ? "API token" : "API key", secret: true },
      ...(preset.accountEnv
        ? ([
            {
              name: "accountId",
              label: "Account ID",
              secret: false,
              derived: true,
              hint: "Cloudflare dashboard, account home",
            },
          ] as const)
        : []),
    ],
    ...(preset.id === "cloudflare" ? { deriveFields: deriveCloudflareAccount } : {}),
    keyUrl: KEY_URLS[preset.id],
    setupHint: `set ${preset.keyEnv.join(" or ")}${preset.accountEnv ? ` and ${preset.accountEnv.join(" or ")}` : ""}, or run \`shelra auth ${preset.id}\``,
    resolveConfigs: (deps) => resolveConfigsFor(preset, deps),
    discoverModels: (config, context) => discover(preset, config, context),
    createAdapter(config, context) {
      const credential = config.credential;
      if (!credential) throw new Error(`${preset.name} has no key configured.`);
      const first = preset.models[0] as string;
      const inner = createOpenAICompatibleProvider(credential.apiKey, config.baseURL, first, {
        providerId: preset.id,
        ...(context.fetch ? { fetch: context.fetch } : {}),
        modelInfo: {
          id: first,
          name: `${preset.name} ${first}`,
          contextWindow: 128_000,
          inputPrice: 0,
          outputPrice: 0,
          reasoning: false,
          description: `${preset.name}, ${preset.plan}`,
          supportsClientTools: true,
          supportsMaxOutputTokens: true,
          capabilityConfidence: "unknown",
        },
      });
      return withCanonicalIds(preset.id, inner, context.entries);
    },
  };
}

export function freePlanDefinitions(): ProviderDefinition[] {
  return FREE_PROVIDER_IDS.map((id) => freePlanDefinition(FREE_PROVIDERS[id]));
}
