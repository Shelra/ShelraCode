import { describe, expect, it } from "vitest";
import { AUTO_FREE_MODEL_ID, canonicalModelId, formatModelRef, isAutoFreeModel, parseModelRef } from "./model-ref";

const PROVIDERS = new Set(["openrouter", "groq", "gemini", "cloudflare", "omniroute"]);

describe("parseModelRef", () => {
  it("reads a namespaced id into its provider and the id that provider uses", () => {
    expect(parseModelRef("groq/openai/gpt-oss-120b", PROVIDERS)).toEqual({
      providerId: "groq",
      providerModelId: "openai/gpt-oss-120b",
      canonical: "groq/openai/gpt-oss-120b",
      legacy: false,
    });
    expect(parseModelRef("omniroute/auto/coding", PROVIDERS).providerModelId).toBe("auto/coding");
    expect(parseModelRef("cloudflare/@cf/openai/gpt-oss-120b", PROVIDERS).providerModelId).toBe(
      "@cf/openai/gpt-oss-120b",
    );
  });

  it("keeps OpenRouter ids as they were: namespaced or bare", () => {
    expect(parseModelRef("openrouter/google/gemma-3:free", PROVIDERS).canonical).toBe("openrouter/google/gemma-3:free");
    const bare = parseModelRef("google/gemma-3:free", PROVIDERS);
    expect(bare.canonical).toBe("openrouter/google/gemma-3:free");
    expect(bare.legacy).toBe(true);
    expect(parseModelRef("openrouter/free", PROVIDERS).providerModelId).toBe("free");
  });

  it("does not mistake an upstream vendor for a provider", () => {
    // `google/…` is a vendor on OpenRouter, not the `gemini` provider; only registered ids are namespaces.
    expect(parseModelRef("google/gemini-2.5-flash", PROVIDERS).providerId).toBe("openrouter");
    expect(parseModelRef("qwen/qwen3-coder", PROVIDERS).providerId).toBe("openrouter");
  });

  it("gives two providers' copies of one upstream model different ids", () => {
    const viaGroq = parseModelRef("groq/openai/gpt-oss-120b", PROVIDERS).canonical;
    const viaOpenRouter = parseModelRef("openrouter/openai/gpt-oss-120b", PROVIDERS).canonical;
    const viaGateway = parseModelRef("omniroute/groq/openai/gpt-oss-120b", PROVIDERS).canonical;
    expect(new Set([viaGroq, viaOpenRouter, viaGateway]).size).toBe(3);
  });

  it("treats the namespace case-insensitively and ignores a lone provider name", () => {
    expect(parseModelRef("GROQ/llama", PROVIDERS).providerId).toBe("groq");
    expect(parseModelRef("groq", PROVIDERS).legacy).toBe(true);
    expect(parseModelRef("groq/", PROVIDERS).legacy).toBe(true);
  });
});

describe("canonicalModelId and the auto-free model", () => {
  it("normalizes ids and returns an empty string for none", () => {
    expect(canonicalModelId("  deepseek/deepseek-v4:free ", PROVIDERS)).toBe("openrouter/deepseek/deepseek-v4:free");
    expect(canonicalModelId("   ", PROVIDERS)).toBe("");
    expect(formatModelRef("groq", "x/y")).toBe("groq/x/y");
  });

  it("recognizes the virtual Free model", () => {
    expect(isAutoFreeModel(AUTO_FREE_MODEL_ID)).toBe(true);
    expect(isAutoFreeModel(" SHELRA/free ")).toBe(true);
    expect(isAutoFreeModel("openrouter/free")).toBe(false);
    // Even with no provider registered under that name, it parses as the router's own namespace.
    expect(parseModelRef(AUTO_FREE_MODEL_ID, PROVIDERS).providerId).toBe("shelra");
  });
});
