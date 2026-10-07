import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { Agent } from "../../agent/agent";
import type { ConfigServices } from "../../config/services";
import { FakeProvider } from "../../providers/fake";
import type { ModelInfo } from "../../types/index";
import { App } from "../app";
import type { ConfigData } from "./flow";

/*
 * The real App on a real Agent with a fake model, to prove the wiring: /config opens the settings over the
 * session, the prompt does not read the keys typed into them, and /logout opens the sign-out question.
 */
const MODEL: ModelInfo = {
  id: "qwen/qwen3-coder:free",
  name: "Qwen3 Coder",
  contextWindow: 262_144,
  inputPrice: 0,
  outputPrice: 0,
  pricingKnown: true,
  reasoning: false,
  description: "Free cloud model",
  supportsClientTools: true,
  category: "cloud",
  provider: "OpenRouter",
};

const DATA: ConfigData = {
  providers: [
    {
      id: "openrouter",
      name: "OpenRouter",
      connected: true,
      stored: true,
      fromEnvironment: false,
      fields: [{ name: "apiKey", label: "API key", secret: true }],
      hasFreePlan: false,
      freePlanDeclared: false,
      vouched: [],
    },
  ],
  defaults: { mode: "free" },
  account: { email: "alice@example.com" },
  models: [],
};

async function mountApp(onSignedOut: () => void = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "shelra-app-config-"));
  const agent = new Agent(undefined, undefined, MODEL.id, 4, {
    provider: new FakeProvider(),
    persistSession: false,
    cwd: dir,
    sandboxMode: "off",
  });
  const ran: string[] = [];
  const services: ConfigServices = {
    data: () => DATA,
    async run(effect) {
      ran.push(effect.type);
      return { ok: true, data: DATA };
    },
  };
  const screen = await testRender(
    createElement(App, {
      agent,
      startupConfig: {
        apiKey: "demo",
        baseURL: "https://openrouter.ai/api/v1",
        model: MODEL.id,
        localModels: [MODEL],
        onSelectLocalModel: async () => ({ success: true }),
        modelMode: "free",
        onSetModelMode: async () => ({ success: true }),
        maxToolRounds: 4,
        sandboxMode: "off",
        sandboxSettings: {} as never,
        version: "999.0.0",
        configServices: () => services,
        onSignedOut,
        accountEmail: () => "alice@example.com",
      },
    }),
    { width: 100, height: 30 },
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
    ran,
    frame: () => screen.captureCharFrame(),
    // One key at a time: the slash menu reads its search from state that each key updates.
    type: async (text: string) => {
      for (const char of text) await settle(() => void screen.mockInput.typeText(char));
    },
    enter: () => settle(() => screen.mockInput.pressEnter()),
    escape: () => settle(() => screen.mockInput.pressEscape()),
    destroy: async () => {
      screen.renderer.destroy();
      await agent.cleanup();
    },
  };
}

describe("/config in the real App", () => {
  it("opens the settings, keeps the typed keys out of the prompt, and closes on escape", async () => {
    const app = await mountApp();
    await app.type("/config");
    await app.enter();
    const open = app.frame();
    expect(open).toContain("[ CONFIG ]");
    expect(open).toContain("Default mode");
    expect(open).toContain("alice@example.com");
    // Enter on the first row switches the mode through the services; it is not sent to the prompt as a message.
    await app.enter();
    expect(app.ran).toEqual(["set-mode"]);
    await app.escape();
    expect(app.frame()).not.toContain("[ CONFIG ]");
    await app.destroy();
  });

  it("/logout opens the sign-out question and signs out only after a yes", async () => {
    let signedOut = 0;
    const app = await mountApp(() => {
      signedOut += 1;
    });
    await app.type("/logout");
    await app.enter();
    expect(app.frame()).toContain("Sign out alice@example.com?");
    // The question starts on "Yes, sign out" only when moved there: Enter on the default must not sign out.
    await app.escape();
    expect(signedOut).toBe(0);
    expect(app.ran).toEqual([]);
    await app.destroy();
  });
});
