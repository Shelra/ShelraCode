import { testRender } from "@opentui/react/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../types/index";
import { ModelPickerModal } from "./model-picker";
import { AUTO_FREE_ID, pickerModels } from "./model-picker-data";
import { dark } from "./theme";

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
    contextWindow: 131_072,
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

function catalog(size: number): ModelInfo[] {
  const models: ModelInfo[] = [AUTO];
  for (let index = 0; index < size; index += 1) {
    const provider = ORDER[index % ORDER.length] as string;
    models.push(
      model(provider, `vendor/model-${String(index).padStart(4, "0")}`, {
        freeStatus: index % 4 === 0 ? "paid" : index % 4 === 1 ? "free-plan" : "free",
        inputPrice: index % 4 === 0 ? 0.000003 : 0,
        outputPrice: index % 4 === 0 ? 0.000015 : 0,
        reasoning: index % 5 === 0,
        supportsVision: index % 7 === 0,
      }),
    );
  }
  return models;
}

async function frameOf(node: ReactNode, width: number, height: number) {
  const screen = await testRender(node, { width, height });
  await screen.renderOnce();
  const frame = screen.captureCharFrame();
  screen.renderer.destroy();
  return frame;
}

function picker(
  mode: "free" | "mixed",
  all: ModelInfo[],
  size: { width: number; height: number },
  extra: { query?: string; selected?: number } = {},
) {
  const models = pickerModels(all, { mode, query: extra.query ?? "", providerName, providerOrder: ORDER });
  return (
    <ModelPickerModal
      t={dark}
      currentModel={AUTO_FREE_ID}
      selectedIndex={extra.selected ?? 0}
      width={size.width}
      height={size.height}
      searchQuery={extra.query ?? ""}
      models={models}
      allModels={all}
      mode={mode}
      providerName={providerName}
      reasoningEffortByModel={{}}
      switching={false}
      error={null}
    />
  );
}

const SIZES = [
  { width: 80, height: 24 },
  { width: 120, height: 40 },
];

describe("ModelPickerModal in Free mode", () => {
  for (const size of SIZES) {
    it(`shows Auto Free and where its routes come from at ${size.width}x${size.height}`, async () => {
      const frame = await frameOf(picker("free", catalog(40), size), size.width, size.height);
      expect(frame).toContain("[ MODELS ]");
      expect(frame).toContain("Free · Auto");
      expect(frame).toContain("Auto Free");
      expect(frame).toContain("Free routes:");
      expect(frame).toContain("ctrl+f switches to Mixed");
      // The catalog is not a menu here: no provider heading, no other model.
      expect(frame).not.toContain("model-0003");
      expect(frame).not.toContain("Groq ·");
    });
  }
});

describe("ModelPickerModal in Mixed mode", () => {
  for (const size of SIZES) {
    it(`groups models by provider and stays inside the screen at ${size.width}x${size.height}`, async () => {
      const frame = await frameOf(picker("mixed", catalog(40), size), size.width, size.height);
      expect(frame).toContain("[ MODELS ]");
      expect(frame).toContain("Mixed");
      expect(frame).toContain("Auto Free");
      expect(frame).toContain("OpenRouter · 10");
      expect(frame).toContain("enter select");
      for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(size.width);
      expect(frame.replace(/\n$/u, "").split("\n").length).toBeLessThanOrEqual(size.height);
    });
  }

  it("draws only what fits for a catalog of five thousand models, and scrolls to the selection", async () => {
    const all = catalog(5_000);
    const size = { width: 120, height: 40 };
    const started = performance.now();
    const top = await frameOf(picker("mixed", all, size), size.width, size.height);
    const deep = await frameOf(picker("mixed", all, size, { selected: 3_000 }), size.width, size.height);
    const elapsed = performance.now() - started;
    expect(top).toContain(" more below");
    expect(top).not.toContain("model-4999");
    expect(deep).toContain(" more above");
    expect(deep).toContain(" more below");
    // Two full renders of a 5,000-model catalog stay quick because only the visible rows are drawn.
    expect(elapsed).toBeLessThan(4_000);
  });

  it("filters by provider, model and capability, and says when nothing matches", async () => {
    const all = catalog(60);
    const size = { width: 100, height: 30 };
    const groq = await frameOf(picker("mixed", all, size, { query: "groq vision" }), size.width, size.height);
    expect(groq).toContain("Groq · ");
    expect(groq).not.toContain("OpenRouter · ");
    const none = await frameOf(picker("mixed", all, size, { query: "zzzzzz" }), size.width, size.height);
    expect(none).toContain("No models match your search");
  });

  it("tells a free model from one on a free plan Shelra cannot see the billing of, and from a paid one", async () => {
    const size = { width: 120, height: 40 };
    const frame = await frameOf(picker("mixed", catalog(8), size), size.width, size.height);
    expect(frame).toContain("free plan, not declared");
    expect(frame).toContain("$3.00/M in");
    expect(frame).toMatch(/\bfree · 131K ctx/u);
  });
});
