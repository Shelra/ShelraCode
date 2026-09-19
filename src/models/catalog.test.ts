import { afterEach, describe, expect, it } from "vitest";
import {
  clearCatalog,
  DEFAULT_MODEL,
  getModelIds,
  getModelInfo,
  MODELS,
  normalizeModelId,
  primeCatalog,
} from "./catalog";

describe("runtime model catalog", () => {
  afterEach(() => clearCatalog());

  it("does not select a model before a runtime primes metadata", () => {
    expect(MODELS).toEqual([]);
    expect(DEFAULT_MODEL).toBe("");
    expect(getModelIds()).toEqual([]);
    expect(getModelInfo("test-model-a")).toBeUndefined();
  });

  it("exposes normalized metadata after discovery and preserves aliases", () => {
    primeCatalog([
      {
        id: "openrouter/qwen/qwen3-coder:free",
        name: "Qwen 3 Coder",
        contextWindow: 32_768,
        inputPrice: 0,
        outputPrice: 0,
        reasoning: true,
        description: "coding model",
        aliases: ["qwen3-coder:free"],
        supportsClientTools: true,
        supportsReasoningEffort: true,
        supportsMaxOutputTokens: true,
        maxOutputTokens: 8_192,
        category: "cloud",
        provider: "openrouter",
      },
    ]);
    expect(getModelInfo("openrouter/qwen/qwen3-coder:free")?.contextWindow).toBe(32_768);
    expect(getModelInfo("qwen3-coder:free")?.id).toBe("openrouter/qwen/qwen3-coder:free");
    expect(getModelIds()).toEqual(["openrouter/qwen/qwen3-coder:free"]);
  });

  it("preserves discovered runtime identifiers", () => {
    expect(normalizeModelId(" hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M ")).toBe(
      "hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
    );
  });
});
