import { describe, expect, it } from "vitest";
import { capabilityScore, isFreeRouter, parseModelSizeB, routeCatalogModel, startupModelRequest } from "./routing";
import type { CatalogEntry } from "./types";

function model(
  id: string,
  options: { free?: boolean; reasoning?: boolean; tools?: boolean; context?: number } = {},
): CatalogEntry {
  const free = options.free ?? true;
  return {
    id: `openrouter/${id}`,
    category: "cloud",
    provider: "openrouter",
    name: id,
    contextWindow: options.context ?? 262_144,
    contextConfidence: "declared",
    capabilities: { tools: options.tools ?? true, reasoning: options.reasoning ?? true, vision: false },
    cost: { prompt: free ? 0 : 0.00001, completion: free ? 0 : 0.00002, free },
    state: { kind: "cloud", providerModelId: id, apiKeyConfigured: true, notes: [] },
  };
}

function router(): CatalogEntry {
  const entry = model("free", { context: 200_000 });
  entry.id = "openrouter/free";
  entry.state = { kind: "cloud", providerModelId: "openrouter/free", apiKeyConfigured: true, notes: [] };
  return entry;
}

const CATALOG = [
  model("liquid/lfm-2.5-2.6b:free", { context: 65_536 }),
  model("deepseek/deepseek-v4-flash-0731:free", { context: 1_048_576 }),
  model("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"),
  model("google/gemma-4-31b-it:free"),
  model("nvidia/nemotron-3-super-120b-a12b:free", { context: 1_000_000 }),
  model("nvidia/nemotron-3-ultra-550b-a55b:free", { context: 1_000_000 }),
  router(),
];

describe("parseModelSizeB", () => {
  it("reads total parameters and ignores active-parameter suffixes", () => {
    expect(parseModelSizeB("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free")).toBe(550);
    expect(parseModelSizeB("google/gemma-4-26b-a4b-it:free")).toBe(26);
    expect(parseModelSizeB("liquid/lfm-2.5-2.6b:free")).toBe(2.6);
    expect(parseModelSizeB("qwen/qwen3.8-27b:free")).toBe(27);
    expect(parseModelSizeB("openai/gpt-oss-120b")).toBe(120);
  });

  it("returns undefined when the id carries no size", () => {
    expect(parseModelSizeB("deepseek/deepseek-v4-flash-0731:free")).toBeUndefined();
    expect(parseModelSizeB("nex-agi/nex-n2.5-pro:free")).toBeUndefined();
    expect(parseModelSizeB("openrouter/free")).toBeUndefined();
  });
});

describe("capabilityScore", () => {
  it("ranks a large reasoning model above small, flash and nano tiers", () => {
    const score = (id: string) => capabilityScore(CATALOG.find((entry) => entry.id.endsWith(id)) as CatalogEntry);
    expect(score("nemotron-3-ultra-550b-a55b:free")).toBeGreaterThan(score("nemotron-3-super-120b-a12b:free"));
    expect(score("nemotron-3-super-120b-a12b:free")).toBeGreaterThan(score("gemma-4-31b-it:free"));
    expect(score("gemma-4-31b-it:free")).toBeGreaterThan(score("nemotron-3-nano-omni-30b-a3b-reasoning:free"));
    expect(score("gemma-4-31b-it:free")).toBeGreaterThan(score("lfm-2.5-2.6b:free"));
    expect(score("gemma-4-31b-it:free")).toBeGreaterThan(score("deepseek-v4-flash-0731:free"));
  });

  it("credits reasoning support", () => {
    const withReasoning = model("acme/coder-30b:free", { reasoning: true });
    const without = model("acme/coder-30b:free", { reasoning: false });
    expect(capabilityScore(withReasoning)).toBeGreaterThan(capabilityScore(without));
  });
});

describe("free policy routing", () => {
  it("picks the most capable free model and closes the fallback list with the router", () => {
    const route = routeCatalogModel(CATALOG, { policy: "free", requiresTools: true });
    expect(route.modelId).toBe("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free");
    expect(route.candidates.slice(0, 3).map((entry) => entry.id)).toEqual([
      "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
      "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
      "openrouter/free",
    ]);
    expect(route.reasons.join(" ")).toContain("capability");
  });

  it("does not let the router win on context size alone", () => {
    const route = routeCatalogModel([router(), model("acme/tiny-2b:free", { context: 8_192 })], {
      policy: "free",
      requiresTools: true,
    });
    expect(isFreeRouter(route.candidates[0] as CatalogEntry)).toBe(false);
    expect(route.modelId).toBe("openrouter/acme/tiny-2b:free");
  });

  it("falls back to the router when it is the only free candidate", () => {
    const route = routeCatalogModel([router()], { policy: "free", requiresTools: true });
    expect(route.modelId).toBe("openrouter/free");
  });

  it("never selects a paid model under the free policy", () => {
    const route = routeCatalogModel([model("acme/huge-900b", { free: false }), model("acme/small-7b:free")], {
      policy: "free",
      requiresTools: true,
    });
    expect(route.modelId).toBe("openrouter/acme/small-7b:free");
  });

  it("keeps cost-first ranking for the other policies", () => {
    const route = routeCatalogModel(
      [model("acme/expensive-500b", { free: false }), model("acme/cheap-7b", { free: false })],
      {
        policy: "economy",
        requiresTools: true,
      },
    );
    expect(route.modelId).toBe("openrouter/acme/expensive-500b");
  });
});

describe("startupModelRequest", () => {
  const base = { policy: "free" as const, explicitModelSelection: false };

  it("uses the router when the catalog is unavailable", () => {
    expect(startupModelRequest([], { ...base })).toBe("openrouter/free");
  });

  it("lets capability ranking choose when nothing usable is saved", () => {
    expect(startupModelRequest(CATALOG, { ...base })).toBeUndefined();
  });

  it("ignores a saved paid model under the free policy", () => {
    const catalog = [...CATALOG, model("qwen/qwen3-coder-30b-a3b-instruct", { free: false })];
    expect(
      startupModelRequest(catalog, { ...base, requestedModel: "qwen/qwen3-coder-30b-a3b-instruct" }),
    ).toBeUndefined();
  });

  it("honours a saved model that is still free, including a deliberately saved router", () => {
    expect(startupModelRequest(CATALOG, { ...base, requestedModel: "google/gemma-4-31b-it:free" })).toBe(
      "google/gemma-4-31b-it:free",
    );
    expect(startupModelRequest(CATALOG, { ...base, requestedModel: "openrouter/free" })).toBe("openrouter/free");
  });

  it("honours an explicit selection over everything", () => {
    expect(startupModelRequest(CATALOG, { ...base, explicitModelSelection: true, requestedModel: "paid/thing" })).toBe(
      "paid/thing",
    );
  });

  it("uses the router when no free model could be ranked", () => {
    expect(startupModelRequest([router()], { ...base })).toBe("openrouter/free");
    expect(startupModelRequest([model("acme/no-tools-7b:free", { tools: false }), router()], { ...base })).toBe(
      "openrouter/free",
    );
  });

  it("leaves other policies alone", () => {
    expect(startupModelRequest(CATALOG, { policy: "quality", explicitModelSelection: false })).toBeUndefined();
    expect(
      startupModelRequest(CATALOG, { policy: "quality", explicitModelSelection: false, requestedModel: "x/y" }),
    ).toBe("x/y");
  });
});
