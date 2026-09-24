import { describe, expect, it } from "vitest";
import { isGuaranteedFree, modelAfterModeChange, parseModelPolicy, routeCatalogModel } from "./routing";
import type { CatalogEntry } from "./types";

function entry(id: string, free: boolean, tools: boolean, contextWindow = 32_768): CatalogEntry {
  return {
    id: `openrouter/${id}`,
    category: "cloud",
    provider: "openrouter",
    name: id,
    contextWindow,
    contextConfidence: "declared",
    capabilities: { tools, reasoning: false, vision: false },
    cost: { prompt: free ? 0 : 0.00001, completion: free ? 0 : 0.00002, free },
    state: { kind: "cloud", providerModelId: id, apiKeyConfigured: true, notes: [] },
  };
}

describe("capability-aware model routing", () => {
  it("does not trust zero router pricing for OpenRouter auto", () => {
    const auto = entry("auto", true, true);
    auto.id = "openrouter/auto";
    auto.state = { kind: "cloud", providerModelId: "openrouter/auto", apiKeyConfigured: true, notes: [] };

    expect(isGuaranteedFree(auto)).toBe(false);
    expect(() => routeCatalogModel([auto], { policy: "free", requiresTools: true })).toThrow(
      "Paid fallback was not enabled",
    );
  });

  it("selects the cheapest capable free model and excludes paid models", () => {
    const result = routeCatalogModel(
      [entry("paid/coder", false, true), entry("free/no-tools", true, false), entry("free/coder", true, true)],
      {
        policy: "free",
        requiresTools: true,
      },
    );
    expect(result.modelId).toBe("openrouter/free/coder");
    expect(result.entry?.cost.free).toBe(true);
  });

  it("never silently turns a free route into paid fallback", () => {
    expect(() =>
      routeCatalogModel([entry("paid/coder", false, true)], { policy: "free", requiresTools: true }),
    ).toThrow("Paid fallback was not enabled");
  });

  it("runs a paid model only under a paid policy or Mixed mode, never in Free mode however it is asked for", () => {
    const selected = routeCatalogModel([entry("paid/coder", false, true)], { policy: "auto", requiresTools: true });
    expect(selected.modelId).toBe("openrouter/paid/coder");
    // Owner, 2026-09-24: with Free active, a paid model is blocked, an explicit pick included.
    expect(() =>
      routeCatalogModel([entry("paid/coder", false, true)], {
        requestedModel: "paid/coder",
        policy: "free",
        requiresTools: true,
      }),
    ).toThrow("Free mode uses free models only");
    const mixed = routeCatalogModel([entry("paid/coder", false, true)], {
      requestedModel: "paid/coder",
      policy: "mixed",
      requiresTools: true,
    });
    expect(mixed.modelId).toBe("openrouter/paid/coder");
  });

  it("lets OpenRouter's auto router choose in Mixed mode when the user picked nothing", () => {
    const route = routeCatalogModel([entry("paid/coder", false, true), entry("free/coder", true, true)], {
      policy: "mixed",
      requiresTools: true,
    });
    expect(route.modelId).toBe("openrouter/auto");
  });

  it("keeps the model when switching to Mixed, and leaves a paid one for the best free model when switching to Free", () => {
    const entries = [entry("paid/coder", false, true), entry("free/coder", true, true)];
    expect(modelAfterModeChange(entries, "openrouter/paid/coder", "mixed")).toBe("openrouter/paid/coder");
    expect(modelAfterModeChange(entries, "openrouter/free/coder", "free")).toBe("openrouter/free/coder");
    expect(modelAfterModeChange(entries, "openrouter/paid/coder", "free")).toBe("openrouter/free/coder");
    expect(modelAfterModeChange(entries, "openrouter/free", "free")).toBe("openrouter/free");
  });

  it("reads a mode from the command line or settings, with paid as another name for Mixed", () => {
    expect(parseModelPolicy("Free")).toBe("free");
    expect(parseModelPolicy("mixed")).toBe("mixed");
    expect(parseModelPolicy("paid")).toBe("mixed");
    expect(parseModelPolicy("economy")).toBe("economy");
    expect(parseModelPolicy("gratis")).toBeNull();
    expect(parseModelPolicy(undefined)).toBeNull();
  });

  it("supports the OpenRouter free router as an explicit strategy", () => {
    const result = routeCatalogModel([], { requestedModel: "openrouter/free", policy: "free", requiresTools: true });
    expect(result.modelId).toBe("openrouter/free");
    expect(result.entry).toBeUndefined();
  });

  it("uses catalog capabilities when the free router is present", () => {
    const router = entry("free", true, true, 200_000);
    router.id = "openrouter/free";
    router.state = { kind: "cloud", providerModelId: "openrouter/free", apiKeyConfigured: true, notes: [] };
    router.capabilities.structuredOutput = true;

    const result = routeCatalogModel([router], {
      requestedModel: "openrouter/free",
      policy: "free",
      requiresTools: true,
      requiresStructuredOutput: true,
    });

    expect(result.modelId).toBe("openrouter/free");
    expect(result.entry?.id).toBe("openrouter/free");
  });
});
