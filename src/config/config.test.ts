import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ProviderDefinition, ProviderRegistry, type ResolveDeps } from "../providers/registry";
import type { FreeAttestations } from "../routing/eligibility";
import { type entry, freeTier, publishedFree } from "../routing/test-fixtures";
import {
  loadDefaults,
  markOnboarded,
  needsOnboarding,
  resetOnboarding,
  saveDefaultMode,
  saveDefaultModel,
  saveDefaultProvider,
} from "./preferences";
import { createProviderAdmin } from "./provider-admin";

let home = "";
let previous: { HOME?: string; USERPROFILE?: string } = {};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "shelra-config-"));
  previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});

afterEach(() => {
  if (previous.HOME === undefined) delete process.env.HOME;
  else process.env.HOME = previous.HOME;
  if (previous.USERPROFILE === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previous.USERPROFILE;
  rmSync(home, { recursive: true, force: true });
});

const settingsFile = () =>
  JSON.parse(readFileSync(join(home, ".shelra", "user-settings.json"), "utf8")) as Record<string, unknown>;

describe("defaults", () => {
  it("start as Free with nothing chosen", () => {
    expect(loadDefaults({})).toEqual({ mode: "free" });
  });

  it("are saved at once, in the user settings, and read back", () => {
    saveDefaultMode("mixed");
    saveDefaultProvider("groq");
    saveDefaultModel("groq/openai/gpt-oss-120b");
    expect(settingsFile()).toMatchObject({
      modelMode: "mixed",
      defaultProvider: "groq",
      defaultModel: "groq/openai/gpt-oss-120b",
    });
    expect(loadDefaults()).toEqual({ mode: "mixed", provider: "groq", model: "groq/openai/gpt-oss-120b" });
    saveDefaultProvider(undefined);
    saveDefaultModel(undefined);
    expect(loadDefaults()).toEqual({ mode: "mixed" });
    expect(settingsFile()).not.toHaveProperty("defaultProvider");
  });

  it("read an unknown saved mode as Free, never as a paid one", () => {
    expect(loadDefaults({ modelMode: "premium" as never })).toEqual({ mode: "free" });
  });
});

describe("the first-run setup", () => {
  const person = { interactive: true, hasProvider: false };

  it("runs once for a person at the keyboard who has set nothing up", () => {
    expect(needsOnboarding({ ...person, settings: {} })).toBe(true);
    markOnboarded();
    expect(needsOnboarding({ ...person, settings: { onboarded: true } })).toBe(false);
  });

  it("does not run for a headless run", () => {
    expect(needsOnboarding({ interactive: false, hasProvider: false, settings: {} })).toBe(false);
  });

  it("does not ask someone who already had Shelra set up before it existed", () => {
    expect(needsOnboarding({ ...person, hasProvider: true, settings: {} })).toBe(false);
    expect(needsOnboarding({ ...person, settings: { modelMode: "mixed" } })).toBe(false);
    expect(needsOnboarding({ ...person, settings: { defaultModel: "openrouter/free" } })).toBe(false);
  });

  it("runs again after /logout resets it", () => {
    markOnboarded();
    expect(settingsFile().onboarded).toBe(true);
    resetOnboarding();
    expect(settingsFile().onboarded).toBe(false);
    // Asked again even though a provider is set up by now.
    expect(needsOnboarding({ ...person, hasProvider: true, settings: { onboarded: false } })).toBe(true);
  });
});

/** Providers as the admin sees them: what they ask for, what they list, whether the key works. */
function definition(
  id: string,
  behavior: {
    models?: () => ReturnType<typeof entry>[];
    validate?: () => Promise<void>;
    optionalKey?: boolean;
    account?: boolean;
  } = {},
): ProviderDefinition {
  return {
    id,
    name: id.toUpperCase(),
    canBill: true,
    freePlan: id === "free-plan" ? { plan: "30 requests a minute", privacy: "prompts may be read" } : undefined,
    setupHint: `set ${id}`,
    fields: [
      ...(behavior.account ? ([{ name: "accountId", label: "Account ID", secret: false }] as const) : []),
      { name: "apiKey", label: "API key", secret: true, optional: behavior.optionalKey },
    ],
    keyUrl: `https://keys.example/${id}`,
    resolveConfigs: (deps: ResolveDeps) =>
      deps.storedCredential(id)
        ? [
            {
              providerId: id,
              baseURL: "https://x.invalid",
              credential: deps.storedCredential(id),
              source: "`shelra auth`",
            },
          ]
        : [],
    discoverModels: async () => (behavior.models ?? (() => [publishedFree(id, "a:free"), freeTier(id, "b")]))(),
    createAdapter: () => {
      throw new Error("not used");
    },
    ...(behavior.validate ? { validateCredential: behavior.validate } : {}),
  };
}

function admin(
  definitions: ProviderDefinition[],
  options: { connected?: string[]; attest?: Partial<FreeAttestations> } = {},
) {
  const saved: Array<{ id: string; input: unknown }> = [];
  const removed: string[] = [];
  const declared: Array<[string, boolean]> = [];
  const patterns: Array<[string, readonly string[]]> = [];
  const connected = new Set(options.connected ?? []);
  const service = createProviderAdmin({
    registry: new ProviderRegistry(definitions),
    resolveDeps: () => ({
      env: {},
      storedCredential: (id) => (connected.has(id) ? { apiKey: `stored-${id}` } : undefined),
      settings: {},
    }),
    attestations: () => ({ freePlanProviders: new Set(), freeModelPatterns: {}, ...options.attest }),
    save: (id, input) => {
      saved.push({ id, input });
      connected.add(id);
    },
    remove: (id) => {
      removed.push(id);
      connected.delete(id);
    },
    setFreePlan: (id, value) => declared.push([id, value]),
    setPatterns: (id, list) => patterns.push([id, list]),
    stored: (id) => connected.has(id),
  });
  return { service, saved, removed, declared, patterns };
}

describe("ProviderAdmin.rows", () => {
  it("says what is connected, what each provider asks for and where to get it", () => {
    const { service } = admin(
      [definition("openrouter"), definition("free-plan"), definition("cf", { account: true })],
      {
        connected: ["free-plan"],
        attest: { freePlanProviders: new Set(["free-plan"]) },
      },
    );
    const rows = service.rows();
    expect(rows.map((row) => [row.id, row.connected])).toEqual([
      ["openrouter", false],
      ["free-plan", true],
      ["cf", false],
    ]);
    const plan = rows.find((row) => row.id === "free-plan");
    expect(plan).toMatchObject({
      stored: true,
      hasFreePlan: true,
      freePlanDeclared: true,
      plan: "30 requests a minute",
      keyUrl: "https://keys.example/free-plan",
    });
    expect(rows.find((row) => row.id === "cf")?.fields.map((field) => field.name)).toEqual(["accountId", "apiKey"]);
  });
});

describe("ProviderAdmin.connect", () => {
  it("tests the key before keeping it, trims what was pasted, and counts the models", async () => {
    const { service, saved } = admin([definition("free-plan")]);
    const result = await service.connect("free-plan", { apiKey: "  secret-key-123  " });
    expect(result).toEqual({ ok: true, models: 2, free: 1 });
    expect(saved).toEqual([{ id: "free-plan", input: { apiKey: "secret-key-123" } }]);
  });

  it("keeps nothing when the provider refuses the key, and never repeats the key in the error", async () => {
    const refuse = definition("free-plan");
    refuse.discoverModels = async () => {
      throw new Error("model list answered HTTP 401 for Bearer secret-key-123");
    };
    const { service, saved } = admin([refuse]);
    const result = await service.connect("free-plan", { apiKey: "secret-key-123" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-key-123");
    expect(saved).toEqual([]);
  });

  it("checks the key itself when listing models proves nothing, as OpenRouter needs", async () => {
    const validate = vi.fn(async () => {
      throw new Error("OpenRouter rejected this key.");
    });
    const { service, saved } = admin([definition("openrouter", { validate })]);
    expect(await service.connect("openrouter", { apiKey: "sk-or-bad" })).toEqual({
      ok: false,
      error: "OpenRouter rejected this key.",
    });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(saved).toEqual([]);
  });

  it("refuses an empty, spaced or missing value before touching the network", async () => {
    const discover = vi.fn(async () => []);
    const probe = definition("free-plan");
    probe.discoverModels = discover;
    const { service, saved } = admin([probe, definition("cf", { account: true })]);
    expect(await service.connect("free-plan", { apiKey: "   " })).toEqual({ ok: false, error: "API key is required." });
    expect(await service.connect("free-plan", { apiKey: "two words" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("spaces"),
    });
    expect(await service.connect("cf", { apiKey: "token" })).toEqual({ ok: false, error: "Account ID is required." });
    expect(await service.connect("nope", { apiKey: "x" })).toMatchObject({ ok: false });
    expect(discover).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it("accepts a key-less provider when its key is optional, and checks the address", async () => {
    const gateway = definition("omniroute", { optionalKey: true });
    gateway.fields = [
      { name: "url", label: "Address", secret: false },
      { name: "apiKey", label: "Key", secret: true, optional: true },
    ];
    gateway.resolveConfigs = (deps) =>
      deps.settings.omniroute?.baseUrl
        ? [{ providerId: "omniroute", baseURL: deps.settings.omniroute.baseUrl, source: "x" }]
        : [];
    const { service, saved } = admin([gateway]);
    expect(await service.connect("omniroute", { url: "localhost:20128" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("http"),
    });
    expect(await service.connect("omniroute", { url: "http://localhost:20128/v1" })).toMatchObject({ ok: true });
    expect(saved).toEqual([{ id: "omniroute", input: { url: "http://localhost:20128/v1" } }]);
  });

  it("can keep a key when the service could not be reached at all, and says so", async () => {
    const down = definition("free-plan");
    down.discoverModels = async () => {
      throw new TypeError("fetch failed");
    };
    const { service, saved } = admin([down]);
    expect(await service.connect("free-plan", { apiKey: "k-1234" })).toMatchObject({ ok: false });
    expect(saved).toEqual([]);
    const kept = await service.connect("free-plan", { apiKey: "k-1234" }, { keepIfUnreachable: true });
    expect(kept).toMatchObject({ ok: true, models: 0, warning: expect.stringContaining("could not be reached") });
    expect(saved).toHaveLength(1);
  });
});

describe("ProviderAdmin.disconnect and setFreePlan", () => {
  it("removes the key and everything declared about it", () => {
    const { service, removed, declared, patterns } = admin([definition("free-plan")], { connected: ["free-plan"] });
    service.disconnect("free-plan");
    expect(removed).toEqual(["free-plan"]);
    expect(declared).toEqual([["free-plan", false]]);
    expect(patterns).toEqual([["free-plan", []]]);
    expect(service.rows()[0]?.connected).toBe(false);
  });

  it("records what the person says about billing", () => {
    const { service, declared } = admin([definition("free-plan")]);
    service.setFreePlan("free-plan", true);
    expect(declared).toEqual([["free-plan", true]]);
  });
});
