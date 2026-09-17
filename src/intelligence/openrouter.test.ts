import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenRouterProviderOptions } from "../providers/openrouter";
import type { ProviderAdapter, ProviderStructuredRequest } from "../providers/types";

const providerFactory = vi.fn<(apiKey: string, options?: OpenRouterProviderOptions) => ProviderAdapter>();

vi.mock("../providers/openrouter", () => ({
  createOpenRouterProvider: (...args: [string, OpenRouterProviderOptions]) => providerFactory(...args),
}));

import type { CatalogEntry } from "../models/types";
import { OpenRouterIntelligenceProvider } from "./openrouter";

function catalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "openrouter/test/free-coder",
    category: "cloud",
    provider: "openrouter",
    name: "Test Free Coder",
    contextWindow: 64_000,
    maxOutputTokens: 16_384,
    contextConfidence: "declared",
    capabilities: { tools: true, reasoning: true, vision: false, structuredOutput: true },
    cost: { prompt: 0, completion: 0, free: true, pricingKnown: true },
    state: { kind: "cloud", providerModelId: "test/free-coder", apiKeyConfigured: true, notes: [] },
    ...overrides,
  };
}

function fakeProvider() {
  const generateStructured = vi.fn(async (request: ProviderStructuredRequest) => ({
    data: { requirements: ["a real requirement"] },
    text: JSON.stringify({ requirements: ["a real requirement"] }),
    modelId: request.modelId,
    usage: { inputTokens: 20, outputTokens: 10, costUsdTicks: 0 },
  }));
  const provider: ProviderAdapter = {
    id: "openrouter",
    defaultModelId: "openrouter/test/free-coder",
    resolveModelRuntime: (modelId) => ({ modelId }),
    stream: () => {
      throw new Error("stream was not expected in this test");
    },
    generateText: async (request) => ({ text: "unused", modelId: request.modelId }),
    generateStructured,
    getToolContext: () => ({}),
  };
  return { provider, generateStructured };
}

describe("OpenRouter intelligence adapter", () => {
  beforeEach(() => {
    providerFactory.mockReset();
  });

  it("routes a structured autonomy call through the provider-neutral adapter", async () => {
    const fake = fakeProvider();
    providerFactory.mockReturnValueOnce(fake.provider);
    const model = catalogEntry();
    const intelligence = new OpenRouterIntelligenceProvider({
      apiKey: "test-key",
      entries: [model],
      policy: "free",
    });

    const result = await intelligence.complete<{ requirements: string[] }>({
      role: "interpret",
      system: "system",
      prompt: "prompt",
      schema: { type: "object" },
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ requirements: ["a real requirement"] });
    expect(fake.generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: model.id,
        schemaName: "shelra_interpret",
      }),
    );
    expect(providerFactory).toHaveBeenCalledWith("test-key", expect.objectContaining({ requireParameters: true }));
  });

  it("keeps implementation output bounded for economical coding models", async () => {
    const fake = fakeProvider();
    providerFactory.mockReturnValueOnce(fake.provider);
    const intelligence = new OpenRouterIntelligenceProvider({
      apiKey: "test-key",
      entries: [catalogEntry()],
      policy: "free",
    });

    await intelligence.complete({
      role: "implement",
      system: "system",
      prompt: "write the complete relevant files",
      schema: { type: "object" },
    });

    expect(fake.generateStructured).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 6_000 }));
  });

  it("does not dispatch a paid request when Free policy has no capable free model", async () => {
    const intelligence = new OpenRouterIntelligenceProvider({
      apiKey: "test-key",
      entries: [
        catalogEntry({
          id: "openrouter/test/paid-coder",
          name: "Test Paid Coder",
          cost: { prompt: 0.000001, completion: 0.000002, free: false, pricingKnown: true },
          state: { kind: "cloud", providerModelId: "test/paid-coder", apiKeyConfigured: true, notes: [] },
        }),
      ],
      policy: "free",
    });

    const result = await intelligence.complete({
      role: "plan",
      system: "system",
      prompt: "prompt",
      schema: { type: "object" },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Paid fallback was not enabled");
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("enforces a zero request budget before the provider is called", async () => {
    const fake = fakeProvider();
    providerFactory.mockReturnValueOnce(fake.provider);
    const paid = catalogEntry({
      id: "openrouter/test/paid-coder",
      name: "Test Paid Coder",
      cost: { prompt: 0.001, completion: 0.001, free: false, pricingKnown: true },
      state: { kind: "cloud", providerModelId: "test/paid-coder", apiKeyConfigured: true, notes: [] },
    });
    const intelligence = new OpenRouterIntelligenceProvider({
      apiKey: "test-key",
      entries: [paid],
      policy: "auto",
      maxCostUsd: 0,
    });

    const result = await intelligence.complete({
      role: "implement",
      system: "system",
      prompt: "write code",
      schema: { type: "object" },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("budget");
    expect(fake.generateStructured).not.toHaveBeenCalled();
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("allows the OpenRouter free router with an empty catalog", async () => {
    const fake = fakeProvider();
    providerFactory.mockReturnValueOnce(fake.provider);
    const intelligence = new OpenRouterIntelligenceProvider({
      apiKey: "test-key",
      entries: [],
      policy: "free",
      modelId: "openrouter/free",
    });

    await expect(
      intelligence.complete({
        role: "interpret",
        system: "system",
        prompt: "prompt",
        schema: { type: "object" },
      }),
    ).resolves.toMatchObject({ ok: true, usage: { costAvailable: true, costUsd: 0, model: "openrouter/free" } });
    expect(providerFactory).toHaveBeenCalledWith(
      "test-key",
      expect.objectContaining({ modelId: "openrouter/free", requireParameters: true }),
    );
  });

  it("does not treat the free router as structured-capable when concrete catalog models exist", async () => {
    const fake = fakeProvider();
    providerFactory.mockReturnValueOnce(fake.provider);
    const concrete = catalogEntry({ id: "openrouter/test/concrete-free" });
    const router = catalogEntry({
      id: "openrouter/free",
      name: "Free Router",
      capabilities: { tools: true, reasoning: true, vision: false, structuredOutput: false },
      state: { kind: "cloud", providerModelId: "openrouter/free", apiKeyConfigured: true, notes: [] },
    });
    const intelligence = new OpenRouterIntelligenceProvider({
      apiKey: "test-key",
      entries: [router, concrete],
      policy: "free",
      modelId: "openrouter/free",
    });

    await expect(
      intelligence.complete({
        role: "interpret",
        system: "system",
        prompt: "prompt",
        schema: { type: "object" },
      }),
    ).resolves.toMatchObject({ ok: true, usage: { model: concrete.id } });
    expect(providerFactory).toHaveBeenCalledWith("test-key", expect.objectContaining({ modelId: concrete.id }));
  });

  it("keeps an explicitly selected capable free router ahead of concrete fallbacks", async () => {
    const fake = fakeProvider();
    providerFactory.mockReturnValueOnce(fake.provider);
    const router = catalogEntry({
      id: "openrouter/free",
      name: "Free Router",
      state: { kind: "cloud", providerModelId: "openrouter/free", apiKeyConfigured: true, notes: [] },
    });
    const concrete = catalogEntry({ id: "openrouter/test/concrete-free" });
    const intelligence = new OpenRouterIntelligenceProvider({
      apiKey: "test-key",
      entries: [concrete, router],
      policy: "free",
      modelId: "openrouter/free",
    });

    const result = await intelligence.complete({
      role: "interpret",
      system: "system",
      prompt: "prompt",
      schema: { type: "object" },
    });

    expect(result.ok).toBe(true);
    expect(result.usage.model).toBe("openrouter/free");
    expect(providerFactory).toHaveBeenCalledWith("test-key", expect.objectContaining({ modelId: "openrouter/free" }));
  });

  it("tries another eligible model after malformed structured output", async () => {
    const first = fakeProvider();
    first.generateStructured.mockRejectedValueOnce(new Error("No output generated."));
    const second = fakeProvider();
    providerFactory.mockImplementationOnce(() => first.provider).mockImplementationOnce(() => second.provider);
    const entries = [
      catalogEntry({ id: "openrouter/test/first", name: "First" }),
      catalogEntry({ id: "openrouter/test/second", name: "Second" }),
    ];
    const intelligence = new OpenRouterIntelligenceProvider({ apiKey: "test-key", entries, policy: "free" });

    const result = await intelligence.complete({
      role: "interpret",
      system: "system",
      prompt: "prompt",
      schema: { type: "object" },
    });

    expect(result.ok).toBe(true);
    expect(providerFactory).toHaveBeenCalledTimes(2);
    expect(first.generateStructured).toHaveBeenCalledOnce();
    expect(second.generateStructured).toHaveBeenCalledOnce();
  });

  it("retains eligible alternatives even when a preferred model is configured", async () => {
    const first = fakeProvider();
    first.generateStructured.mockRejectedValueOnce(new Error("No output generated."));
    const second = fakeProvider();
    providerFactory.mockImplementationOnce(() => first.provider).mockImplementationOnce(() => second.provider);
    const preferred = catalogEntry({ id: "openrouter/test/preferred" });
    const alternative = catalogEntry({ id: "openrouter/test/alternative" });
    const intelligence = new OpenRouterIntelligenceProvider({
      apiKey: "test-key",
      entries: [preferred, alternative],
      policy: "free",
      modelId: preferred.id,
    });

    const result = await intelligence.complete({
      role: "interpret",
      system: "system",
      prompt: "prompt",
      schema: { type: "object" },
    });

    expect(result.ok).toBe(true);
    expect(providerFactory).toHaveBeenCalledTimes(2);
  });

  it("does not switch models when strict model control is enabled", async () => {
    const selected = fakeProvider();
    selected.generateStructured.mockRejectedValueOnce(new Error("Selected model unavailable."));
    providerFactory.mockReturnValueOnce(selected.provider);
    const preferred = catalogEntry({ id: "openrouter/test/preferred" });
    const alternative = catalogEntry({ id: "openrouter/test/alternative" });
    const intelligence = new OpenRouterIntelligenceProvider({
      apiKey: "test-key",
      entries: [preferred, alternative],
      policy: "free",
      modelId: preferred.id,
      strictModel: true,
    });

    const result = await intelligence.complete({
      role: "interpret",
      system: "system",
      prompt: "prompt",
      schema: { type: "object" },
    });

    expect(result).toMatchObject({ ok: false, usage: { model: preferred.id } });
    expect(providerFactory).toHaveBeenCalledTimes(1);
    expect(providerFactory).toHaveBeenCalledWith(
      "test-key",
      expect.objectContaining({ modelId: preferred.id, fallbackModels: [preferred.id] }),
    );
  });

  it("hard-stops a provider that ignores abort and falls back to another model", async () => {
    const hanging = fakeProvider();
    hanging.generateStructured.mockImplementationOnce(() => new Promise(() => {}));
    const second = fakeProvider();
    providerFactory.mockImplementationOnce(() => hanging.provider).mockImplementationOnce(() => second.provider);
    const entries = [
      catalogEntry({ id: "openrouter/test/hanging", name: "Hanging" }),
      catalogEntry({ id: "openrouter/test/recovery", name: "Recovery" }),
    ];
    const intelligence = new OpenRouterIntelligenceProvider({ apiKey: "test-key", entries, policy: "free" });

    const result = await intelligence.complete({
      role: "interpret",
      system: "system",
      prompt: "prompt",
      schema: { type: "object" },
      timeoutMs: 20,
    });

    expect(result.ok).toBe(true);
    expect(providerFactory).toHaveBeenCalledTimes(2);
    expect(hanging.generateStructured).toHaveBeenCalledOnce();
    expect(second.generateStructured).toHaveBeenCalledOnce();
  });
});
