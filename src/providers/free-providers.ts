import { createOpenAICompatibleProvider } from "../runtimes/local-provider";
import { getStoredProviderCredential, type ProviderCredential } from "../security/credentials";
import { sessionModelPolicy } from "../utils/settings";
import type { CredentialFallbackSource } from "./credential-fallback";
import type { ProviderAdapter } from "./types";

/**
 * Free providers beyond OpenRouter (owner's decision, 2026-09-23): each can run a session or a benchmark
 * when chosen, and continues a turn when OpenRouter's free models cannot serve it. Which ones still have a
 * free plan, and what their terms say about the prompts they receive, is in
 * docs/future-research/05_FREE_AND_LOW_COST_LLM_INFRASTRUCTURE.md; the notices below repeat it to the user.
 */

export const FREE_PROVIDER_IDS = ["groq", "gemini", "cloudflare"] as const;
export type FreeProviderId = (typeof FREE_PROVIDER_IDS)[number];

export interface FreeProviderPreset {
  id: FreeProviderId;
  name: string;
  /** Environment variables that may hold the API key; the first one set wins over the stored key. */
  keyEnv: readonly string[];
  /** Environment variables that may hold the account id, for an endpoint that names the account. */
  accountEnv?: readonly string[];
  baseURL: (accountId?: string) => string;
  /** Models that use tools well, most preferred first; the first is the default. */
  models: readonly string[];
  /** What the free plan allows, and who pays beyond it. */
  plan: string;
  /** Set when the free plan's terms let the provider use prompts and outputs; said at every switch. */
  privacy?: string;
}

export const FREE_PROVIDERS: Readonly<Record<FreeProviderId, FreeProviderPreset>> = {
  groq: {
    id: "groq",
    name: "Groq",
    keyEnv: ["GROQ_API_KEY", "KEY_GROQ"],
    baseURL: () => "https://api.groq.com/openai/v1",
    models: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"],
    plan: "free plan: 30 requests a minute and 1,000 a day; a key on a paid plan is billed by Groq",
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    // Only a key named for Gemini: a GOOGLE_API_KEY set for another Google service would otherwise send
    // the session's prompts to Gemini's free tier, whose terms let Google read them.
    keyEnv: ["GEMINI_API_KEY"],
    baseURL: () => "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    plan: "free tier, limits unpublished; a key on a billed project is charged by Google",
    privacy: "on the free tier Google may use prompts and outputs to improve its products, and people may read them",
  },
  cloudflare: {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    keyEnv: ["CLOUDFLARE_API_TOKEN"],
    accountEnv: ["CLOUDFLARE_ACCOUNT_ID"],
    baseURL: (accountId) => `https://api.cloudflare.com/client/v4/accounts/${accountId ?? ""}/ai/v1`,
    models: ["@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"],
    plan: "10,000 neurons a day free; beyond that a Workers Paid plan is billed by Cloudflare",
  },
};

export function isFreeProviderId(value: string): value is FreeProviderId {
  return (FREE_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Why `--provider` cannot apply to this invocation, or null. It runs a headless prompt (`-p`) or a benchmark;
 * elsewhere it was dropped without a word, and the `-m` meant for that provider then chose a model on
 * OpenRouter, where the same id can be a paid one (review round 3, 2026-09-24).
 */
export function freeProviderCliError(input: {
  provider?: string;
  prompt: boolean;
  autonomous: boolean;
  verify: boolean;
}): string | null {
  if (!input.provider || (input.prompt && !input.autonomous && !input.verify)) return null;
  return `--provider ${input.provider} runs a headless prompt: pass -p "..." (or use \`shelra bench --provider ${input.provider}\`).`;
}

/** A provider the user can reach: its key (and account) from the environment or `shelra auth`. */
export interface ConfiguredFreeProvider {
  preset: FreeProviderPreset;
  credential: ProviderCredential;
  /** Where the key came from, for notices. Never the key itself. */
  source: string;
}

function fromEnv(names: readonly string[] | undefined, env: NodeJS.ProcessEnv): { value: string; name: string } | null {
  for (const name of names ?? []) {
    const value = env[name]?.trim();
    if (value) return { value, name };
  }
  return null;
}

export function resolveFreeProvider(
  id: FreeProviderId,
  env: NodeJS.ProcessEnv = process.env,
  stored: (id: string) => ProviderCredential | undefined = getStoredProviderCredential,
): ConfiguredFreeProvider | null {
  const preset = FREE_PROVIDERS[id];
  const saved = stored(id);
  const key = fromEnv(preset.keyEnv, env);
  const apiKey = key?.value ?? saved?.apiKey;
  if (!apiKey) return null;
  const accountId = fromEnv(preset.accountEnv, env)?.value ?? saved?.accountId;
  if (preset.accountEnv && !accountId) return null;
  return {
    preset,
    credential: { apiKey, ...(accountId ? { accountId } : {}) },
    source: key ? key.name : `\`shelra auth ${id}\``,
  };
}

/** The provider a session or a benchmark was told to use, or an error that says how to configure it. */
export function requireFreeProvider(
  id: FreeProviderId,
  env: NodeJS.ProcessEnv = process.env,
  stored: (id: string) => ProviderCredential | undefined = getStoredProviderCredential,
): ConfiguredFreeProvider {
  const configured = resolveFreeProvider(id, env, stored);
  if (configured) return configured;
  const preset = FREE_PROVIDERS[id];
  // Key variables are alternatives; an account id is needed as well.
  const key = preset.keyEnv.join(" or ");
  const needed = preset.accountEnv ? `${key} and ${preset.accountEnv.join(" or ")}` : key;
  throw new Error(`No ${preset.name} credentials: set ${needed} or run \`shelra auth ${id}\`.`);
}

/** Every free provider the user can reach, in the order of FREE_PROVIDER_IDS. */
export function configuredFreeProviders(
  env: NodeJS.ProcessEnv = process.env,
  stored: (id: string) => ProviderCredential | undefined = getStoredProviderCredential,
): ConfiguredFreeProvider[] {
  return FREE_PROVIDER_IDS.flatMap((id) => {
    const configured = resolveFreeProvider(id, env, stored);
    return configured ? [configured] : [];
  });
}

export function createFreeProvider(configured: ConfiguredFreeProvider, modelId?: string): ProviderAdapter {
  const { preset, credential } = configured;
  const model = modelId?.trim() || (preset.models[0] as string);
  return createOpenAICompatibleProvider(credential.apiKey, preset.baseURL(credential.accountId), model, {
    providerId: preset.id,
    modelInfo: {
      id: model,
      name: `${preset.name} ${model}`,
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
}

/** What a switch to this provider costs and exposes, said in the notice. */
export function describeFreeProvider(preset: FreeProviderPreset): string {
  return preset.privacy ? `${preset.plan}; ${preset.privacy}` : preset.plan;
}

/**
 * Where a turn continues when OpenRouter's free models cannot serve it (the daily quota spent, no model
 * answering): each configured free provider in turn, on its default model, each tried once per session.
 */
/**
 * Another provider's key can be on a paid plan that bills, so a session in Free mode never moves to one on its own
 * (owner, 2026-09-24: paid providers only in Mixed): the turn ends "Limited" with the time its free allowance comes
 * back instead. In Mixed the chain answers as before. The chain itself is kept, so a switch to Mixed later still
 * finds every provider.
 */
export function outsideFreeMode(chain: CredentialFallbackSource): CredentialFallbackSource {
  return async (request) => (sessionModelPolicy() === "free" ? null : chain(request));
}

export function freeProviderFallbackSources(providers: readonly ConfiguredFreeProvider[]): CredentialFallbackSource[] {
  return providers.map(
    (configured): CredentialFallbackSource =>
      async () => ({
        provider: createFreeProvider(configured),
        modelId: configured.preset.models[0] as string,
        label: `${configured.preset.name} (${describeFreeProvider(configured.preset)}), with the key from ${configured.source}`,
      }),
  );
}
