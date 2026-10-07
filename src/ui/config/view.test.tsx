import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { ProviderAdminRow } from "../../config/provider-admin";
import type { ConfigServices } from "../../config/services";
import type { ModelInfo } from "../../types/index";
import { dark } from "../theme";
import type { ConfigData, Effect } from "./flow";
import { ConfigView } from "./view";

function row(id: string, extra: Partial<ProviderAdminRow> = {}): ProviderAdminRow {
  return {
    id,
    name: id === "openrouter" ? "OpenRouter" : id[0]?.toUpperCase() + id.slice(1),
    connected: false,
    stored: false,
    fromEnvironment: false,
    fields: [{ name: "apiKey", label: "API key", secret: true }],
    hasFreePlan: id !== "openrouter",
    freePlanDeclared: false,
    vouched: [],
    ...extra,
  };
}

function model(provider: string, id: string, name: string): ModelInfo {
  return {
    id: `${provider}/${id}`,
    name,
    contextWindow: 128_000,
    inputPrice: 0,
    outputPrice: 0,
    reasoning: false,
    description: "",
    supportsClientTools: true,
    category: "cloud",
    provider,
    freeStatus: "free",
  };
}

function fakeServices(initial?: Partial<ConfigData>) {
  let data: ConfigData = {
    providers: [row("openrouter"), row("groq")],
    defaults: { mode: "free" },
    account: { email: "alice@example.com" },
    models: [model("openrouter", "vendor/alpha-70b", "Alpha 70B")],
    ...initial,
  };
  const effects: Effect[] = [];
  const services: ConfigServices = {
    data: () => data,
    async run(effect) {
      effects.push(effect);
      if (effect.type === "connect") {
        data = {
          ...data,
          providers: data.providers.map((item) =>
            item.id === effect.providerId ? { ...item, connected: true, stored: true } : item,
          ),
        };
        return { ok: true, message: "Connected.", data };
      }
      if (effect.type === "set-mode") {
        data = { ...data, defaults: { ...data.defaults, mode: effect.mode } };
        return { ok: true, data };
      }
      return { ok: true, data };
    },
  };
  return { services, effects };
}

async function mount(
  variant: "onboarding" | "config",
  size: { width: number; height: number },
  initial?: Partial<ConfigData>,
) {
  const fake = fakeServices(initial);
  const closes: { skipped: boolean; signedOut: boolean }[] = [];
  const screen = await testRender(
    <ConfigView variant={variant} services={fake.services} theme={dark} onClose={(result) => closes.push(result)} />,
    size,
  );
  await screen.renderOnce();
  const press = async (action: () => void) => {
    await act(async () => action());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    await screen.renderOnce();
  };
  return {
    ...fake,
    closes,
    frame: () => screen.captureCharFrame(),
    enter: () => press(() => screen.mockInput.pressEnter()),
    escape: () => press(() => screen.mockInput.pressEscape()),
    down: () => press(() => screen.mockInput.pressArrow("down")),
    type: (text: string) => press(() => void screen.mockInput.typeText(text)),
    destroy: () => screen.renderer.destroy(),
  };
}

const SIZES = [
  { width: 80, height: 24 },
  { width: 120, height: 40 },
];

describe("setup and /config, drawn", () => {
  for (const size of SIZES) {
    describe(`${size.width}x${size.height}`, () => {
      it("shows the welcome, then the providers, and fits the terminal", async () => {
        const view = await mount("onboarding", size);
        expect(view.frame()).toContain("Welcome to ShelraCode");
        expect(view.frame()).toContain("esc skip the setup");
        await view.enter();
        const frame = view.frame();
        expect(frame).toContain("OpenRouter");
        expect(frame).toContain("not set up");
        for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(size.width);
        view.destroy();
      });

      it("types a key as dots, never as text, and connects through the services", async () => {
        const view = await mount("onboarding", size);
        await view.enter();
        await view.enter(); // OpenRouter
        await view.enter(); // Connect
        await view.type("sk-or-secret-value");
        const frame = view.frame();
        expect(frame).not.toContain("sk-or-secret-value");
        expect(frame).toContain("●●●●");
        await view.enter();
        expect(view.effects).toEqual([
          { type: "connect", providerId: "openrouter", input: { apiKey: "sk-or-secret-value" } },
        ]);
        expect(view.frame()).toContain("Connected.");
        view.destroy();
      });

      it("walks the setup to the summary and closes once", async () => {
        const view = await mount("onboarding", size, {
          providers: [row("openrouter", { connected: true, stored: true })],
        });
        await view.enter(); // welcome -> providers
        await view.down(); // Continue
        await view.enter();
        expect(view.frame()).toContain("How should Shelra pick models?");
        await view.enter(); // Free
        expect(view.frame()).toContain("You are set up");
        await view.enter();
        expect(view.closes).toEqual([{ skipped: false, signedOut: false }]);
        expect(view.effects.map((effect) => effect.type)).toEqual(["set-mode", "finish"]);
        view.destroy();
      });

      it("escape on the welcome skips the setup", async () => {
        const view = await mount("onboarding", size);
        await view.escape();
        expect(view.closes).toEqual([{ skipped: true, signedOut: false }]);
        view.destroy();
      });

      it("/config lists the settings, switches the mode at once and closes on escape", async () => {
        const view = await mount("config", size);
        const frame = view.frame();
        expect(frame).toContain("Default mode");
        expect(frame).toContain("Providers and keys");
        expect(frame).toContain("Sign out of ShelraCode");
        expect(frame).toContain("alice@example.com");
        await view.enter();
        expect(view.effects).toEqual([{ type: "set-mode", mode: "mixed" }]);
        expect(view.frame()).toContain("Mixed");
        await view.escape();
        expect(view.closes).toEqual([{ skipped: false, signedOut: false }]);
        view.destroy();
      });
    });
  }
});
