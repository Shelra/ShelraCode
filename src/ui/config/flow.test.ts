import { describe, expect, it } from "vitest";
import type { Defaults } from "../../config/preferences";
import type { ProviderAdminRow } from "../../config/provider-admin";
import type { ModelInfo } from "../../types/index";
import {
  type Action,
  type ConfigData,
  type ConfigState,
  current,
  type Effect,
  hubRows,
  initialState,
  modelChoices,
  providerActions,
  step,
  type Variant,
} from "./flow";

function row(id: string, extra: Partial<ProviderAdminRow> = {}): ProviderAdminRow {
  const needsAccount = id === "cloudflare";
  return {
    id,
    name: id[0]?.toUpperCase() + id.slice(1),
    connected: false,
    stored: false,
    fromEnvironment: false,
    // The key alone; an account id is worked out from it and asked for only when the provider could not.
    fields: [
      { name: "apiKey", label: needsAccount ? "API token" : "API key", secret: true },
      ...(needsAccount ? ([{ name: "accountId", label: "Account ID", secret: false, derived: true }] as const) : []),
    ],
    hasFreePlan: id !== "openrouter",
    freePlanDeclared: false,
    vouched: [],
    ...extra,
  };
}

function model(provider: string, id: string, name = id): ModelInfo {
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

const MODELS = [
  model("openrouter", "vendor/alpha-70b", "Alpha 70B"),
  model("groq", "openai/gpt-oss-120b", "GPT OSS 120B"),
  model("groq", "mid-8b", "Mid 8B"),
];

function data(extra: Partial<ConfigData> = {}): ConfigData {
  return {
    providers: [row("openrouter"), row("groq"), row("cloudflare")],
    defaults: { mode: "free" },
    account: { email: "alice@example.com" },
    models: MODELS,
    ...extra,
  };
}

type Key = "enter" | "esc" | "up" | "down" | "backspace" | "pagedown" | (string & {});

/** Plays keys into the machine; returns the state and every effect it asked for, in order. */
function play(start: ConfigState, ...keys: Key[]) {
  let state = start;
  const effects: Effect[] = [];
  for (const key of keys) {
    const action: Action = {
      type: "key",
      key:
        key === "enter"
          ? { name: "return" }
          : key === "esc"
            ? { name: "escape" }
            : ["up", "down", "backspace", "pagedown"].includes(key)
              ? { name: key }
              : { name: key, sequence: key },
    };
    const result = step(state, action);
    state = result.state;
    if (result.effect) effects.push(result.effect);
  }
  return { state, effects };
}

const type = (text: string): Key[] => [...text];
const screenId = (state: ConfigState) => current(state).id;

function done(state: ConfigState, effect: Effect, ok = true, extra: { message?: string; data?: ConfigData } = {}) {
  return step(state, { type: "done", effect, ok, ...extra }).state;
}

describe("the first-run setup", () => {
  it("walks welcome, providers and mode, and saves the choice", () => {
    let { state } = play(initialState("onboarding", data()), "enter");
    expect(screenId(state)).toBe("providers");
    // Nothing is connected: the person is told once, then may go on.
    ({ state } = play(state, "down", "down", "down", "enter"));
    expect(screenId(state)).toBe("providers");
    expect(state.notice).toContain("nothing to run on");
    ({ state } = play(state, "enter"));
    expect(screenId(state)).toBe("mode");
    const chosen = play(state, "enter");
    expect(chosen.effects).toEqual([{ type: "set-mode", mode: "free" }]);
    expect(screenId(chosen.state)).toBe("summary");
    const finished = play(chosen.state, "enter");
    expect(finished.effects).toEqual([{ type: "finish", skipped: false }]);
    expect(finished.state.done).toEqual({ skipped: false });
  });

  it("can be skipped from the first screen", () => {
    const { state, effects } = play(initialState("onboarding", data()), "esc");
    expect(effects).toEqual([{ type: "finish", skipped: true }]);
    expect(state.done).toEqual({ skipped: true });
  });

  it("connects a provider: tests the key, then asks whether the free plan has billing, and remembers the answer", () => {
    let { state, effects } = play(initialState("onboarding", data()), "enter", "down", "enter", "enter");
    expect(screenId(state)).toBe("input");
    // The key is typed, never shown; Enter sends it to be tested.
    ({ state, effects } = play(state, ...type("gsk_secret"), "enter"));
    expect(effects).toEqual([{ type: "connect", providerId: "groq", input: { apiKey: "gsk_secret" } }]);
    expect(state.busy).toContain("Checking");

    const connected = data({
      providers: [row("openrouter"), row("groq", { connected: true, stored: true }), row("cloudflare")],
    });
    state = done(state, effects[0] as Effect, true, {
      data: connected,
      message: "Connected Groq: 5 models, 0 free now.",
    });
    expect(screenId(state)).toBe("billing");
    expect(state.notice).toContain("Connected Groq");

    // The safe answer (billing, or not sure) is the one under the cursor.
    const yes = play(state, "enter");
    expect(yes.effects).toEqual([{ type: "declare-free-plan", providerId: "groq", declared: false }]);
    const no = play(state, "up", "enter");
    expect(no.effects).toEqual([{ type: "declare-free-plan", providerId: "groq", declared: true }]);

    // Having answered, the setup does not ask again on the way to the mode.
    let after = no.state;
    after = step(after, {
      type: "data",
      data: data({
        providers: [
          row("openrouter"),
          row("groq", { connected: true, stored: true, freePlanDeclared: true }),
          row("cloudflare"),
        ],
      }),
    }).state;
    after = play(after, "esc", "down", "down", "down", "enter").state;
    expect(screenId(after)).toBe("mode");
  });

  it("asks the billing question once for a provider connected earlier, and once only", () => {
    const start = initialState(
      "onboarding",
      data({ providers: [row("openrouter"), row("groq", { connected: true, stored: true }), row("cloudflare")] }),
    );
    let { state } = play(start, "enter", "down", "down", "down", "enter");
    expect(screenId(state)).toBe("billing");
    // Answered "billing or not sure": the answer is kept as not declared, and it is not asked a second time.
    ({ state } = play(state, "enter"));
    expect(screenId(state)).toBe("mode");
  });

  it("asks for the token of Cloudflare alone, since its account id is found from the token", () => {
    const { state } = play(initialState("onboarding", data()), "enter", "down", "down", "enter", "enter");
    expect(current(state)).toMatchObject({ id: "input", fieldIndex: 0 });
    const sent = play(state, ...type("tok"), "enter");
    expect(sent.effects).toEqual([{ type: "connect", providerId: "cloudflare", input: { apiKey: "tok" } }]);
    expect(sent.state.busy).toBeDefined();
  });

  it("asks for the account id, and only that, when Cloudflare could not find it from the token", () => {
    let { state } = play(initialState("onboarding", data()), "enter", "down", "down", "enter", "enter");
    let effects: Effect[] = [];
    ({ state, effects } = play(state, ...type("tok"), "enter"));
    const needs = step(state, {
      type: "done",
      effect: effects[0] as Effect,
      ok: false,
      message: "Account ID is needed. This token cannot list its accounts.",
      needs: "accountId",
    }).state;
    // The token just typed is kept; the box now asks for the id.
    expect(current(needs)).toMatchObject({
      id: "input",
      fieldIndex: 1,
      values: { apiKey: "tok" },
      needs: ["accountId"],
      buffer: "",
    });
    const sent = play(needs, ...type("acc-123"), "enter");
    expect(sent.effects).toEqual([
      { type: "connect", providerId: "cloudflare", input: { apiKey: "tok", accountId: "acc-123" } },
    ]);
  });

  it("types a rejected token again from the first field, keeping what else was typed", () => {
    let { state } = play(initialState("onboarding", data()), "enter", "down", "down", "enter", "enter");
    let effects: Effect[] = [];
    ({ state, effects } = play(state, ...type("bad"), "enter"));
    state = done(state, effects[0] as Effect, false, { message: "Cloudflare rejected this token." });
    expect(current(state)).toMatchObject({
      id: "input",
      fieldIndex: 0,
      values: {},
      error: "Cloudflare rejected this token.",
    });
  });

  it("refuses an empty value, and a value that failed the test comes back with the reason and an empty box", () => {
    let { state } = play(initialState("onboarding", data()), "enter", "down", "enter", "enter", "enter");
    expect(current(state)).toMatchObject({ id: "input", error: "API key is required." });
    let effects: Effect[] = [];
    ({ state, effects } = play(state, ...type("wrong"), "enter"));
    state = done(state, effects[0] as Effect, false, { message: "Groq rejected this key." });
    expect(current(state)).toMatchObject({ id: "input", buffer: "", error: "Groq rejected this key." });
    expect(state.busy).toBeUndefined();
  });

  it("lets the person leave while a key is being tested, and a late answer does not pop another screen", () => {
    let { state, effects } = play(
      initialState("onboarding", data()),
      "enter",
      "down",
      "enter",
      "enter",
      ...type("k"),
      "enter",
    );
    expect(state.busy).toBeDefined();
    state = play(state, "esc").state;
    expect(state.busy).toBeUndefined();
    const before = state.stack.length;
    state = done(state, effects[0] as Effect, true, {
      data: data({ providers: [row("openrouter"), row("groq", { connected: true }), row("cloudflare")] }),
    });
    expect(state.stack.length).toBe(before);
    expect(screenId(state)).toBe("provider");
  });

  it("ignores keys while something is being checked", () => {
    const { state } = play(
      initialState("onboarding", data()),
      "enter",
      "down",
      "enter",
      "enter",
      ...type("k"),
      "enter",
    );
    const same = play(state, "down", "x", "enter");
    expect(same.state).toEqual(state);
    expect(same.effects).toEqual([]);
  });

  it("goes on to the default provider and model when the mode is Mixed", () => {
    const connected = data({
      providers: [
        row("openrouter", { connected: true }),
        row("groq", { connected: true, freePlanDeclared: true }),
        row("cloudflare"),
      ],
    });
    let { state } = play(initialState("onboarding", connected), "enter", "down", "down", "down", "enter");
    expect(screenId(state)).toBe("mode");
    let effects: Effect[] = [];
    ({ state, effects } = play(state, "down", "enter"));
    expect(effects).toEqual([{ type: "set-mode", mode: "mixed" }]);
    expect(screenId(state)).toBe("default-provider");
    // "No preference", then the connected providers.
    ({ state, effects } = play(state, "down", "down", "enter"));
    expect(effects).toEqual([{ type: "set-provider", providerId: "groq" }]);
    expect(screenId(state)).toBe("default-model");
    // Typing narrows the list; the first row is "no default", so the cursor goes down once for a model.
    ({ state, effects } = play(state, ...type("oss"), "down", "enter"));
    expect(effects).toEqual([{ type: "set-model", modelId: "groq/openai/gpt-oss-120b" }]);
    expect(screenId(state)).toBe("summary");
    expect(state.data.defaults).toEqual({ mode: "mixed", provider: "groq", model: "groq/openai/gpt-oss-120b" });
  });

  it("leaving the model step skips it", () => {
    const start = {
      ...initialState("onboarding", data()),
      stack: [{ id: "default-model" as const, query: "", index: 0 }],
    };
    expect(screenId(play(start, "esc").state)).toBe("summary");
  });
});

describe("/config", () => {
  const configured = () =>
    data({
      providers: [
        row("openrouter", { connected: true, stored: true }),
        row("groq", { connected: true, stored: true, freePlanDeclared: true }),
        row("cloudflare"),
      ],
      defaults: { mode: "free", provider: "groq" },
    });

  it("lists the defaults with their current values", () => {
    const rows = hubRows(configured());
    expect(rows.map((item) => [item.label, item.value])).toEqual([
      ["Default mode", "Free · Auto"],
      ["Default provider", "Groq"],
      ["Default model", "none"],
      ["Providers and keys", "2 connected"],
      ["Run the setup again", undefined],
      ["Sign out of ShelraCode", "alice@example.com"],
    ]);
  });

  it("switches the default mode at once", () => {
    const { effects } = play(initialState("config", configured()), "enter");
    expect(effects).toEqual([{ type: "set-mode", mode: "mixed" }]);
    const back = play(initialState("config", { ...configured(), defaults: { mode: "mixed" } }), "enter");
    expect(back.effects).toEqual([{ type: "set-mode", mode: "free" }]);
  });

  it("chooses the default provider and returns to the menu, or clears it", () => {
    // The cursor starts on the current default (Groq, third row): one up is OpenRouter, two up is "No preference".
    const pick = play(initialState("config", configured()), "down", "enter", "up", "enter");
    expect(pick.effects).toEqual([{ type: "set-provider", providerId: "openrouter" }]);
    expect(screenId(pick.state)).toBe("hub");
    expect(pick.state.data.defaults.provider).toBe("openrouter");
    const clear = play(initialState("config", configured()), "down", "enter", "up", "up", "enter");
    expect(clear.effects).toEqual([{ type: "set-provider", providerId: undefined }]);
    expect(clear.state.data.defaults).toEqual({ mode: "free" });
  });

  it("chooses the default model from the catalog, or none", () => {
    const opened = play(initialState("config", configured()), "down", "down", "enter");
    expect(opened.effects).toEqual([{ type: "refresh-models" }]);
    expect(current(opened.state)).toMatchObject({ id: "default-model" });
    const picked = play(opened.state, "down", "enter");
    expect(picked.effects).toEqual([{ type: "set-model", modelId: expect.stringContaining("/") }]);
    expect(screenId(picked.state)).toBe("hub");
    const cleared = play(opened.state, "enter");
    expect(cleared.effects).toEqual([{ type: "set-model", modelId: undefined }]);
  });

  it("lists every model of the catalog under its provider, and searches them", () => {
    const all = modelChoices(data(), "");
    expect(all.ids).toEqual(["", "openrouter/vendor/alpha-70b", "groq/openai/gpt-oss-120b", "groq/mid-8b"]);
    expect(modelChoices(data(), "groq mid").ids).toEqual(["", "groq/mid-8b"]);
    expect(modelChoices(data(), "zzz").ids).toEqual([""]);
  });

  it("manages a provider: connect, replace, remove, and the free-plan declaration", () => {
    let { state } = play(initialState("config", configured()), "down", "down", "down", "enter");
    expect(screenId(state)).toBe("providers");
    // Groq: connected, with a saved key and a free plan.
    ({ state } = play(state, "down", "enter"));
    const row_ = configured().providers[1] as ProviderAdminRow;
    expect(providerActions(row_).map((action) => action.id)).toEqual(["connect", "remove", "free-plan", "back"]);
    expect(play(state, "down", "enter").effects).toEqual([{ type: "disconnect", providerId: "groq" }]);
    expect(play(state, "down", "down", "enter").effects).toEqual([
      { type: "declare-free-plan", providerId: "groq", declared: false },
    ]);
    // Replacing opens the key box.
    expect(screenId(play(state, "enter").state)).toBe("input");
  });

  it("offers only Connect for a provider that is not set up, and no free plan for one without a plan", () => {
    expect(providerActions(row("cloudflare")).map((action) => action.id)).toEqual(["connect", "back"]);
    expect(
      providerActions(row("openrouter", { connected: true, stored: true, hasFreePlan: false })).map(
        (action) => action.id,
      ),
    ).toEqual(["connect", "remove", "back"]);
  });

  it("runs the setup again from the menu", () => {
    const { state } = play(initialState("config", configured()), "down", "down", "down", "down", "enter");
    expect(state.variant).toBe("onboarding");
    expect(screenId(state)).toBe("welcome");
  });

  it("signs out only after a confirmation that defaults to No", () => {
    const rows = hubRows(configured()).length;
    let { state } = play(initialState("config", configured()), ...Array(rows - 1).fill("down"), "enter");
    expect(current(state)).toMatchObject({ id: "confirm-signout", index: 1 });
    expect(play(state, "enter").state.stack.length).toBe(1);
    let effects: Effect[] = [];
    ({ state, effects } = play(state, "up", "enter"));
    expect(effects).toEqual([{ type: "sign-out" }]);
    state = done(state, effects[0] as Effect);
    expect(state.done).toEqual({ skipped: false, signedOut: true });
    // A failed sign-out says so and stays.
    const failed = done(
      play(initialState("config", configured()), ...Array(rows - 1).fill("down"), "enter", "up", "enter").state,
      { type: "sign-out" },
      false,
      { message: "offline" },
    );
    expect(failed.done).toBeUndefined();
    expect(failed.notice).toBe("offline");
  });

  it("closes with Escape from the menu, and goes back one screen from anywhere else", () => {
    expect(play(initialState("config", configured()), "esc").effects).toEqual([{ type: "finish", skipped: false }]);
    const inner = play(initialState("config", configured()), "down", "down", "down", "enter", "esc");
    expect(screenId(inner.state)).toBe("hub");
  });

  it("takes pasted text into the key box and the search box, without newlines", () => {
    let { state } = play(initialState("onboarding", data()), "enter", "down", "enter", "enter");
    state = step(state, { type: "paste", text: "gsk_pasted\n" }).state;
    expect(current(state)).toMatchObject({ id: "input", buffer: "gsk_pasted" });
    const search = play(initialState("config", configured()), "down", "down", "enter").state;
    expect(current(step(search, { type: "paste", text: "gpt oss" }).state)).toMatchObject({
      id: "default-model",
      query: "gpt oss",
    });
  });

  it("is finished once it is finished: later keys do nothing", () => {
    const finished = play(initialState("config", configured()), "esc").state;
    const again = play(finished, "enter", "down");
    expect(again.state).toBe(finished);
    expect(again.effects).toEqual([]);
  });
});

describe("variants and data", () => {
  it("starts on the welcome screen for the setup and the menu for /config", () => {
    for (const [variant, first] of [
      ["onboarding", "welcome"],
      ["config", "hub"],
    ] as [Variant, string][]) {
      expect(screenId(initialState(variant, data()))).toBe(first);
    }
  });

  it("takes fresh data without moving", () => {
    const state = initialState("config", data());
    const defaults: Defaults = { mode: "mixed" };
    const next = step(state, { type: "data", data: data({ defaults }) }).state;
    expect(next.data.defaults).toEqual(defaults);
    expect(next.stack).toEqual(state.stack);
  });
});
