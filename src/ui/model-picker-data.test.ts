import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../types/index";
import {
  AUTO_FREE_ID,
  describeFreeSources,
  formatProviderTabs,
  nextProviderTab,
  type PickerOptions,
  pickerItems,
  pickerModels,
  pickerSearch,
  priceLabel,
  providerTabs,
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

describe("search filters and ranking", () => {
  const WIDE = [
    model("openrouter", "vendor/llama-3.3-70b-instruct:free", { contextWindow: 131_072 }),
    model("openrouter", "vendor/tiny-8b:free", { contextWindow: 8_000, supportsClientTools: false }),
    model("openrouter", "anthropic/claude-sonnet", {
      freeStatus: "paid",
      inputPrice: 0.000003,
      outputPrice: 0.000015,
      supportsVision: true,
      contextWindow: 1_000_000,
    }),
    model("groq", "llama-3.3-70b-versatile", { freeStatus: "free-plan", contextWindow: 131_072 }),
    model("groq", "openai/gpt-oss-120b", { reasoning: true, freeStatus: "free-plan", contextWindow: 131_072 }),
    model("gemini", "gemini-2.5-flash", { supportsVision: true, freeStatus: "free-plan", contextWindow: 1_048_576 }),
    model("local", "qwen-7b", { category: "local", provider: undefined, freeStatus: undefined }),
  ];
  const ids = (query: string, extra: Partial<PickerOptions> = {}) =>
    pickerModels(WIDE, options({ query, ...extra })).map((m) => m.id);

  it("filters by provider with @ or provider:, by the start of a provider's id or name", () => {
    expect(ids("@groq")).toEqual(["groq/llama-3.3-70b-versatile", "groq/openai/gpt-oss-120b"]);
    expect(ids("provider:goog")).toEqual(["gemini/gemini-2.5-flash"]);
    expect(ids("@groq llama")).toEqual(["groq/llama-3.3-70b-versatile"]);
    expect(ids("@nothing")).toEqual([]);
  });

  it("filters by price, capability and context size", () => {
    // A local model costs nothing, so it is free too.
    expect(ids("free tools")).toEqual(["openrouter/vendor/llama-3.3-70b-instruct:free", "local/qwen-7b"]);
    expect(ids("ctx>500k")).toEqual(["openrouter/anthropic/claude-sonnet", "gemini/gemini-2.5-flash"]);
    expect(ids("1m+")).toEqual(["openrouter/anthropic/claude-sonnet", "gemini/gemini-2.5-flash"]);
    expect(ids("ctx<16k")).toEqual(["openrouter/vendor/tiny-8b:free"]);
    expect(ids("local")).toEqual(["local/qwen-7b"]);
    // A bare size in a model name is text, not a context filter.
    expect(ids("70b")).toEqual(["openrouter/vendor/llama-3.3-70b-instruct:free", "groq/llama-3.3-70b-versatile"]);
  });

  it("excludes with a leading minus", () => {
    expect(ids("llama -groq")).toEqual(["openrouter/vendor/llama-3.3-70b-instruct:free"]);
    expect(ids("@openrouter -paid -free")).toEqual([]);
    expect(ids("vision -paid")).toEqual(["gemini/gemini-2.5-flash"]);
    expect(ids("-")).toHaveLength(WIDE.length);
  });

  it("ranks a provider named, then a name that starts with the word, ahead of a match inside", () => {
    // "llama" starts the name of Groq's and is inside OpenRouter's id path after a slash: both rank as word starts,
    // and the provider group with the better hit leads.
    expect(ids("gemini")[0]).toBe("gemini/gemini-2.5-flash");
    const qwen = pickerModels(
      [
        model("openrouter", "vendor/not-quite-qwen"),
        model("groq", "qwen-32b", { freeStatus: "free-plan" }),
        model("gemini", "alias-of-qwen-thing", { freeStatus: "free-plan" }),
      ],
      options({ query: "qwen" }),
    ).map((m) => m.id);
    expect(qwen[0]).toBe("groq/qwen-32b");
  });

  it("keeps a provider's models together under one heading when ranking", () => {
    const result = pickerModels(WIDE, options({ query: "llama" }));
    const providers = result.map((m) => m.provider);
    expect(providers).toEqual([...providers].sort((a, b) => providers.indexOf(a) - providers.indexOf(b)));
    expect(new Set(providers).size).toBe(providers.filter((p, i) => providers.indexOf(p) === i).length);
  });

  it("falls back to the closest names when nothing matches exactly", () => {
    const missed = pickerSearch(WIDE, options({ query: "glama" }));
    expect(missed.fuzzy).toBe(true);
    expect(missed.models.map((m) => m.id)).toContain("groq/llama-3.3-70b-versatile");
    expect(pickerSearch(WIDE, options({ query: "zzzqq" }))).toMatchObject({ fuzzy: false, models: [] });
    const typo = pickerSearch(WIDE, options({ query: "gptoss" }));
    expect(typo.fuzzy).toBe(true);
    expect(typo.models.map((m) => m.id)).toEqual(["groq/openai/gpt-oss-120b"]);
    // A query that matches exactly never reports fuzzy.
    expect(pickerSearch(WIDE, options({ query: "gpt-oss" })).fuzzy).toBe(false);
  });

  it("offers provider tabs with what the search finds in each, and a chosen tab narrows the list", () => {
    const tabs = providerTabs(WIDE, options({ query: "llama" }));
    expect(tabs.map((t) => [t.id, t.count])).toEqual([
      ["", 2],
      ["openrouter", 1],
      ["groq", 1],
    ]);
    expect(providerTabs(WIDE, options()).map((t) => t.label)).toEqual([
      "All",
      "OpenRouter",
      "Groq",
      "Google Gemini",
      "Local",
    ]);
    expect(ids("", { provider: "groq" })).toEqual(["groq/llama-3.3-70b-versatile", "groq/openai/gpt-oss-120b"]);
    // The chosen tab stays listed even when the search finds nothing in it.
    const none = providerTabs(WIDE, options({ query: "claude", provider: "groq" }));
    expect(none.find((t) => t.id === "groq")?.count).toBe(0);
  });

  it("cycles through the tabs that have models, wrapping, and never lands on an empty one", () => {
    const tabs = providerTabs(WIDE, options({ query: "llama" }));
    expect(nextProviderTab(tabs, "", 1)).toBe("openrouter");
    expect(nextProviderTab(tabs, "openrouter", 1)).toBe("groq");
    expect(nextProviderTab(tabs, "groq", 1)).toBe("");
    expect(nextProviderTab(tabs, "", -1)).toBe("groq");
  });

  it("fits the tabs in the room it has, keeping the active one in view", () => {
    const tabs = providerTabs(WIDE, options());
    const wide = formatProviderTabs(tabs, "", 120);
    expect(wide).toBe("[All 7]  OpenRouter 3  Groq 2  Google Gemini 1  Local 1");
    const narrow = formatProviderTabs(tabs, "local", 30);
    expect(narrow.length).toBeLessThanOrEqual(30);
    expect(narrow).toContain("[Local 1]");
  });
});

describe("a configured provider that lists nothing", () => {
  const problems = [{ id: "omniroute", name: "OmniRoute", reason: "OmniRoute refused the key (HTTP 401)." }];
  const base = [
    model("openrouter", "vendor/a:free"),
    model("groq", "openai/gpt-oss-120b", { freeStatus: "free-plan" }),
  ];

  it("keeps its tab, marked, after the providers that list models", () => {
    const tabs = providerTabs(base, options({ problems }));
    expect(tabs.map((t) => [t.id, t.count, t.problem ? "problem" : ""])).toEqual([
      ["", 2, ""],
      ["openrouter", 1, ""],
      ["groq", 1, ""],
      ["omniroute", 0, "problem"],
    ]);
    expect(formatProviderTabs(tabs, "", 120)).toBe("[All 2]  OpenRouter 1  Groq 1  OmniRoute ✗");
    expect(formatProviderTabs(tabs, "omniroute", 120)).toContain("[OmniRoute ✗]");
  });

  it("can be chosen with Tab, so the reason can be read, and does not distort the counts", () => {
    const tabs = providerTabs(base, options({ problems }));
    expect(nextProviderTab(tabs, "groq", 1)).toBe("omniroute");
    expect(nextProviderTab(tabs, "omniroute", 1)).toBe("");
    expect(tabs[0]?.count).toBe(2);
    // Chosen, it lists nothing, and the search never invents models for it.
    expect(pickerModels(base, options({ provider: "omniroute", problems })).map((m) => m.id)).toEqual([]);
  });

  it("is not shown as a problem once it lists models", () => {
    const withModels = [...base, model("omniroute", "auto/coding", { freeStatus: "unproven" })];
    const tabs = providerTabs(withModels, options({ problems }));
    expect(tabs.find((t) => t.id === "omniroute")).toMatchObject({ count: 1 });
    expect(tabs.find((t) => t.id === "omniroute")?.problem).toBeUndefined();
  });
});

describe("a provider that answers from its last good list", () => {
  const stale = [{ id: "groq", name: "Groq", reason: "Groq refused the key (HTTP 401).", stale: true }];
  const base = [
    model("openrouter", "vendor/a:free"),
    model("groq", "openai/gpt-oss-120b", { freeStatus: "free-plan" }),
  ];

  it("keeps its models and count, and carries a warning the tab shows with a mark", () => {
    const tabs = providerTabs(base, options({ problems: stale }));
    expect(tabs.find((t) => t.id === "groq")).toMatchObject({ count: 1, warning: "Groq refused the key (HTTP 401)." });
    expect(tabs.find((t) => t.id === "groq")?.problem).toBeUndefined();
    expect(formatProviderTabs(tabs, "", 120)).toBe("[All 2]  OpenRouter 1  Groq 1 !");
    expect(pickerModels(base, options({ provider: "groq", problems: stale })).map((m) => m.id)).toEqual([
      "groq/openai/gpt-oss-120b",
    ]);
  });
});
