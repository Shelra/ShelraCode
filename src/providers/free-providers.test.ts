import { describe, expect, it } from "vitest";
import type { ProviderCredential } from "../security/credentials";
import {
  configuredFreeProviders,
  createFreeProvider,
  FREE_PROVIDERS,
  freeProviderFallbackSources,
  resolveFreeProvider,
} from "./free-providers";

const noStored = () => undefined;

describe("free providers", () => {
  it("finds a key in the environment first, then the stored one, and never reports the key itself", () => {
    const stored = (id: string): ProviderCredential | undefined =>
      id === "gemini" ? { apiKey: "stored-gemini-key" } : undefined;
    const groq = resolveFreeProvider("groq", { KEY_GROQ: " env-groq-key " }, stored);
    expect(groq).toMatchObject({ credential: { apiKey: "env-groq-key" }, source: "KEY_GROQ" });
    const gemini = resolveFreeProvider("gemini", {}, stored);
    expect(gemini).toMatchObject({ credential: { apiKey: "stored-gemini-key" }, source: "`shelra auth gemini`" });
    expect(JSON.stringify([groq?.source, gemini?.source])).not.toContain('key"');
    expect(resolveFreeProvider("groq", {}, noStored)).toBeNull();
  });

  it("needs Cloudflare's account id as well as its token", () => {
    expect(resolveFreeProvider("cloudflare", { CLOUDFLARE_API_TOKEN: "token" }, noStored)).toBeNull();
    const cloudflare = resolveFreeProvider(
      "cloudflare",
      { CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "acct" },
      noStored,
    );
    expect(cloudflare?.credential).toEqual({ apiKey: "token", accountId: "acct" });
    expect(FREE_PROVIDERS.cloudflare.baseURL("acct")).toBe("https://api.cloudflare.com/client/v4/accounts/acct/ai/v1");
  });

  it("lists every provider the user can reach, in a fixed order", () => {
    const env = { GEMINI_API_KEY: "g", GROQ_API_KEY: "q", CLOUDFLARE_API_TOKEN: "c" };
    expect(configuredFreeProviders(env, noStored).map((provider) => provider.preset.id)).toEqual(["groq", "gemini"]);
  });

  it("serves the preset's default model on its OpenAI-compatible endpoint", () => {
    const groq = resolveFreeProvider("groq", { GROQ_API_KEY: "q" }, noStored);
    if (!groq) throw new Error("groq should resolve");
    const provider = createFreeProvider(groq);
    const runtime = provider.resolveModelRuntime("openai/gpt-oss-120b");
    expect(runtime.modelInfo).toMatchObject({ inputPrice: 0, outputPrice: 0, supportsClientTools: true });
    expect(runtime.modelInfo?.description).toContain("a key on a paid plan is billed by Groq");
  });

  it("states the plan and, where the terms allow it, the use of prompts in every switch notice", async () => {
    const env = { GROQ_API_KEY: "q", GEMINI_API_KEY: "g" };
    const [groq, gemini] = await Promise.all(
      freeProviderFallbackSources(configuredFreeProviders(env, noStored)).map((source) =>
        source({ modelId: "openrouter/free", signal: new AbortController().signal }),
      ),
    );
    expect(groq).toMatchObject({ modelId: "openai/gpt-oss-120b" });
    expect(groq?.label).toBe(
      "Groq (free plan: 30 requests a minute and 1,000 a day; a key on a paid plan is billed by Groq), with the key from GROQ_API_KEY",
    );
    expect(gemini?.label).toContain("Google may use prompts and outputs to improve its products");
  });
});
