import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "../models/types";
import { buildOpenRouterRequestBody, createOpenRouterProvider, openRouterWireModelId } from "./openrouter";

const entry: CatalogEntry = {
  id: "openrouter/google/gemma-3:free",
  category: "cloud",
  provider: "openrouter",
  name: "Gemma 3",
  contextWindow: 32_768,
  maxOutputTokens: 8_192,
  contextConfidence: "declared",
  capabilities: { tools: true, reasoning: false, vision: false },
  cost: { prompt: 0, completion: 0, free: true },
  state: { kind: "cloud", providerModelId: "google/gemma-3:free", apiKeyConfigured: true, notes: [] },
};

describe("OpenRouter provider adapter", () => {
  it("keeps canonical ids inside Shelra and provider ids on the wire", () => {
    expect(openRouterWireModelId("openrouter/google/gemma-3:free")).toBe("google/gemma-3:free");
    expect(openRouterWireModelId("openrouter/free")).toBe("openrouter/free");
  });

  it("exposes catalog metadata through the provider-neutral runtime", () => {
    const provider = createOpenRouterProvider("secret-not-printed", { entries: [entry], modelId: entry.id });
    expect(provider.id).toBe("openrouter");
    expect(provider.resolveModelRuntime(entry.id)).toMatchObject({
      modelId: entry.id,
      modelInfo: { contextWindow: 32_768, supportsClientTools: true, category: "cloud", provider: "openrouter" },
    });
  });

  it("translates canonical fallback ids and provider policy into OpenRouter's wire body", () => {
    expect(
      buildOpenRouterRequestBody(
        { model: "qwen/qwen3-coder:free", messages: [] },
        {
          fallbackModels: ["openrouter/qwen/qwen3-coder:free", "openrouter/openai/gpt-4o-mini"],
          providerOrder: ["together", "openai"],
          allowProviderFallbacks: true,
          dataCollection: "deny",
          zeroDataRetention: true,
          requireParameters: true,
        },
      ),
    ).toMatchObject({
      models: ["qwen/qwen3-coder:free", "openai/gpt-4o-mini"],
      provider: {
        order: ["together", "openai"],
        allow_fallbacks: true,
        data_collection: "deny",
        zdr: true,
        require_parameters: true,
      },
    });
  });

  it("keeps OpenRouter router ids canonical", () => {
    expect(openRouterWireModelId("openrouter/free")).toBe("openrouter/free");
    expect(openRouterWireModelId("openrouter/auto")).toBe("openrouter/auto");
  });

  it("leaves the server fallback list bounded to the provider contract", () => {
    const body = buildOpenRouterRequestBody(
      { model: "qwen/qwen3-coder:free" },
      { fallbackModels: ["a", "b", "c", "d"] },
    );
    expect(body.models).toEqual(["a", "b", "c"]);
  });
});
