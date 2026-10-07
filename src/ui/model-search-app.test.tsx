import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { Agent } from "../agent/agent";
import { FakeProvider } from "../providers/fake";
import type { ModelInfo } from "../types/index";
import { App } from "./app";

/*
 * The real App on a real Agent with a fake model, to prove the search of /models works end to end: typing filters
 * and ranks, `@provider` narrows, Tab and Shift+Tab walk the provider tabs, and closing forgets the tab.
 */
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

const CATALOG = [
  model("openrouter", "vendor/llama-3.3-70b-instruct:free"),
  model("openrouter", "anthropic/claude-sonnet", { freeStatus: "paid", inputPrice: 0.000003, outputPrice: 0.000015 }),
  model("groq", "llama-3.3-70b-versatile", { freeStatus: "free-plan" }),
  model("groq", "openai/gpt-oss-120b", { freeStatus: "free-plan", reasoning: true }),
  model("gemini", "gemini-2.5-flash", { freeStatus: "free-plan", supportsVision: true, contextWindow: 1_048_576 }),
];

async function mountApp() {
  const dir = mkdtempSync(join(tmpdir(), "shelra-app-search-"));
  const agent = new Agent(undefined, undefined, CATALOG[0]?.id, 4, {
    provider: new FakeProvider(),
    persistSession: false,
    cwd: dir,
    sandboxMode: "off",
  });
  const screen = await testRender(
    createElement(App, {
      agent,
      startupConfig: {
        apiKey: "demo",
        baseURL: "https://openrouter.ai/api/v1",
        model: CATALOG[0]?.id as string,
        localModels: CATALOG,
        onSelectLocalModel: async () => ({ success: true }),
        modelMode: "mixed",
        onSetModelMode: async () => ({ success: true }),
        maxToolRounds: 4,
        sandboxMode: "off",
        sandboxSettings: {} as never,
        version: "999.0.0",
      },
    }),
    { width: 100, height: 34 },
  );
  await screen.renderOnce();
  const settle = async (action: () => void) => {
    await act(async () => action());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    await screen.renderOnce();
  };
  return {
    frame: () => screen.captureCharFrame(),
    type: async (text: string) => {
      for (const char of text) await settle(() => void screen.mockInput.typeText(char));
    },
    enter: () => settle(() => screen.mockInput.pressEnter()),
    escape: () => settle(() => screen.mockInput.pressEscape()),
    // Shift+Tab is what a terminal sends as ESC [ Z; the mock's own modifier does not produce it.
    tab: (shift = false) => settle(() => (shift ? screen.mockInput.pressKey("[Z") : screen.mockInput.pressTab())),
    destroy: async () => {
      screen.renderer.destroy();
      await agent.cleanup();
    },
  };
}

describe("searching models in the real App", () => {
  it("opens /models with a tab per provider and counts, and Tab narrows to one provider", async () => {
    const app = await mountApp();
    await app.type("/models");
    await app.enter();
    const open = app.frame();
    expect(open).toContain("[ MODELS ]");
    expect(open).toContain("[All 5]");
    expect(open).toContain("OpenRouter 2");
    expect(open).toContain("Groq 2");
    await app.tab();
    expect(app.frame()).toContain("[OpenRouter 2]");
    expect(app.frame()).toContain("2 of 5");
    await app.tab();
    expect(app.frame()).toContain("[Groq 2]");
    expect(app.frame()).not.toContain("anthropic/claude-sonnet");
    await app.tab(true);
    expect(app.frame()).toContain("[OpenRouter 2]");
    await app.destroy();
  });

  it("filters and ranks as the person types, with provider and capability filters", async () => {
    const app = await mountApp();
    await app.type("/models");
    await app.enter();
    await app.type("llama");
    expect(app.frame()).toContain("2 of 5");
    expect(app.frame()).toContain("[All 2]");
    await app.type(" @groq");
    expect(app.frame()).toContain("1 of 5");
    expect(app.frame()).toContain("llama-3.3-70b-versatile");
    expect(app.frame()).not.toContain("vendor/llama");
    await app.type(" zzz");
    expect(app.frame()).toContain('No models match "llama @groq zzz"');
    await app.destroy();
  });

  it("forgets the provider tab when the picker is closed and opened again", async () => {
    const app = await mountApp();
    await app.type("/models");
    await app.enter();
    await app.tab();
    expect(app.frame()).toContain("[OpenRouter 2]");
    await app.escape();
    await app.type("/models");
    await app.enter();
    expect(app.frame()).toContain("[All 5]");
    await app.destroy();
  });
});
