import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../types/index";
import {
  AUTO_FREE_ID,
  describeFreeSources,
  type PickerOptions,
  pickerItems,
  pickerModels,
  priceLabel,
  windowItems,
} from "./model-picker-data";

const NAMES: Record<string, string> = {
  openrouter: "OpenRouter",
  groq: "Groq",
  omniroute: "OmniRoute",
  gemini: "Google Gemini",
};
const providerName = (id: string) => NAMES[id] ?? id;
const ORDER = ["openrouter", "groq", "gemini", "omniroute"];

function model(provider: string, id: string, extra: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: `${provider}/${id}`,
    name: id,
    contextWindow: 128_000,
    inputPrice: 0,
    outputPrice: 0,
    reasoning: false,
    description: "",
    supportsClientTools: true,
    category: "cloud",
    provider,
    freeStatus: "free",
    ...extra,
  };
}

const AUTO = model("shelra", "free", { id: AUTO_FREE_ID, name: "Auto Free", provider: undefined });
const CATALOG = [
  model("omniroute", "groq/gpt-oss-120b", { freeStatus: "unproven" }),
  model("groq", "openai/gpt-oss-120b", { reasoning: true, freeStatus: "free-plan" }),
  model("openrouter", "anthropic/claude-sonnet", {
    inputPrice: 0.000003,
    outputPrice: 0.000015,
    freeStatus: "paid",
    supportsVision: true,
  }),
  model("openrouter", "vendor/qwen-70b:free", { reasoning: true }),
  AUTO,
  model("gemini", "gemini-2.5-flash", { supportsVision: true, freeStatus: "free-plan" }),
];
const options = (extra: Partial<PickerOptions> = {}): PickerOptions => ({
  mode: "mixed",
  query: "",
  providerName,
  providerOrder: ORDER,
  ...extra,
});

describe("pickerModels", () => {
  it("lists Auto Free first, then each provider's group in order, free before paid", () => {
    expect(pickerModels(CATALOG, options()).map((m) => m.id)).toEqual([
      AUTO_FREE_ID,
      "openrouter/vendor/qwen-70b:free",
      "openrouter/anthropic/claude-sonnet",
      "groq/openai/gpt-oss-120b",
      "gemini/gemini-2.5-flash",
      "omniroute/groq/gpt-oss-120b",
    ]);
  });

  it("shows Auto Free alone in Free mode: choosing a model is what Mixed is for", () => {
    expect(pickerModels(CATALOG, options({ mode: "free" })).map((m) => m.id)).toEqual([AUTO_FREE_ID]);
  });

  it("searches provider, model and capability together, every word must match", () => {
    const ids = (query: string) => pickerModels(CATALOG, options({ query })).map((m) => m.id);
    expect(ids("groq")).toEqual(["groq/openai/gpt-oss-120b", "omniroute/groq/gpt-oss-120b"]);
    expect(ids("omniroute groq")).toEqual(["omniroute/groq/gpt-oss-120b"]);
    expect(ids("vision")).toEqual(["openrouter/anthropic/claude-sonnet", "gemini/gemini-2.5-flash"]);
    expect(ids("google")).toEqual(["gemini/gemini-2.5-flash"]);
    expect(ids("reasoning free")).toEqual(["openrouter/vendor/qwen-70b:free"]);
    expect(ids("paid")).toEqual(["openrouter/anthropic/claude-sonnet"]);
    expect(ids("nothing matches this")).toEqual([]);
  });

  it("keeps Mixed's ordering for a catalog of thousands without redoing it per keystroke", () => {
    const big: ModelInfo[] = [];
    for (let index = 0; index < 5_000; index += 1) {
      big.push(
        model(ORDER[index % ORDER.length] as string, `model-${index}`, {
          freeStatus: index % 3 === 0 ? "free" : "paid",
        }),
      );
    }
    const started = performance.now();
    const all = pickerModels(big, options());
    for (const query of ["m", "mo", "mod", "model-4", "model-49"]) pickerModels(big, options({ query }));
    expect(all).toHaveLength(5_000);
    expect(performance.now() - started).toBeLessThan(400);
  });
});

describe("pickerItems and windowItems", () => {
  const big: ModelInfo[] = [];
  for (let index = 0; index < 3_000; index += 1)
    big.push(model(ORDER[index % 4] as string, `m${String(index).padStart(4, "0")}`));
  const items = pickerItems(pickerModels(big, options()), providerName);

  it("puts a heading with a count over each provider's group", () => {
    const headers = items.filter((item) => item.kind === "header");
    expect(headers.map((item) => (item.kind === "header" ? item.label : ""))).toEqual([
      "OpenRouter",
      "Groq",
      "Google Gemini",
      "OmniRoute",
    ]);
    expect(headers.every((item) => item.kind === "header" && item.count === 750)).toBe(true);
  });

  it("draws no heading when everything is one group of Shelra's own", () => {
    expect(pickerItems([AUTO], providerName).map((item) => item.kind)).toEqual(["model"]);
  });

  it("returns only the rows that fit, with the selected one in view, however large the catalog", () => {
    for (const selected of [0, 1, 500, 1_500, 2_999]) {
      const target = items.filter((item) => item.kind === "model")[selected];
      for (const lines of [6, 11, 24]) {
        const view = windowItems(items, target?.key, lines);
        const used = view.items.reduce((sum, item) => sum + (item.kind === "header" ? 1 : 2), 0);
        expect(used).toBeLessThanOrEqual(lines);
        expect(view.items.some((item) => item.key === target?.key)).toBe(true);
        expect(view.above + view.items.length + view.below).toBe(items.length);
        expect(view.items.length).toBeLessThan(30);
      }
    }
  });

  it("shows everything when it fits", () => {
    const small = pickerItems(pickerModels(CATALOG, options()), providerName);
    const view = windowItems(small, small[1]?.key, 200);
    expect(view.items).toHaveLength(small.length);
    expect(view.above + view.below).toBe(0);
  });
});

describe("priceLabel and describeFreeSources", () => {
  it("says what Shelra can prove, not what a zero price field suggests", () => {
    expect(priceLabel(model("openrouter", "a"))).toBe("free");
    expect(priceLabel(model("groq", "b", { freeStatus: "free-plan" }))).toBe("free plan, not declared");
    expect(priceLabel(model("omniroute", "c", { freeStatus: "unproven" }))).toBe("price not proven");
    expect(priceLabel(model("omniroute", "auto", { freeStatus: "router" }))).toBe("router, price varies");
    expect(priceLabel(CATALOG[2] as ModelInfo)).toBe("$3.00/M in · $15.00/M out");
    expect(priceLabel(model("local", "q", { category: "local", freeStatus: undefined }))).toBe("local");
  });

  it("counts Free mode's routes per provider", () => {
    expect(describeFreeSources(CATALOG, providerName)).toBe("1 OpenRouter");
    expect(describeFreeSources([], providerName)).toBe("no free model is available yet");
  });
});
