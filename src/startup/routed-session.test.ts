import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ModelPolicy, parseModelPolicy } from "../models/routing";
import type { CredentialFallbackSource } from "../providers/credential-fallback";
import { ProviderRegistry } from "../providers/registry";
import { RoutingProvider } from "../providers/routing-provider";
import type { ProviderAdapter } from "../providers/types";
import { CatalogService } from "../routing/catalog-service";
import type { FreeAttestations } from "../routing/eligibility";
import { HealthTracker } from "../routing/health";
import type { RoutingRuntime } from "../routing/runtime";
import {
  entry,
  FakeControl,
  fakeDefinition,
  freeTier,
  paid,
  publishedFree,
  resolveDepsFor,
} from "../routing/test-fixtures";
import { MODEL_POLICY_ENV } from "../utils/settings";
import { configureRoutedSession, type RoutedAgent } from "./routed-session";

/*
 * What a session does with the choices a person makes: the mode it starts in, the model or provider Mixed starts on,
 * and what happens when they switch mode or pick a model. The providers are fakes; the session code is the real one.
 */

let previousPolicy: string | undefined;
beforeEach(() => {
  previousPolicy = process.env[MODEL_POLICY_ENV];
});
afterEach(() => {
  if (previousPolicy === undefined) delete process.env[MODEL_POLICY_ENV];
  else process.env[MODEL_POLICY_ENV] = previousPolicy;
});

function stubAgent() {
  const state = {
    model: "",
    provider: undefined as ProviderAdapter | undefined,
    credential: undefined as unknown,
    fallback: undefined as unknown,
  };
  const agent: RoutedAgent = {
    setProvider(provider, modelId) {
      state.provider = provider;
      if (modelId) state.model = modelId;
    },
    getModel: () => state.model,
    setCredentialFallback(source) {
      state.credential = source;
    },
    setProviderFallback(source) {
      state.fallback = source;
    },
  };
  return { agent, state };
}

function runtimeWith(configured: string[]): () => RoutingRuntime {
  return () => {
    const controls = { openrouter: new FakeControl(), groq: new FakeControl(), omniroute: new FakeControl() };
    const registry = new ProviderRegistry([
      fakeDefinition(
        "openrouter",
        [
          publishedFree("openrouter", "vendor/free-70b:free", { reasoning: true }),
          paid("openrouter", "vendor/paid-405b"),
        ],
        controls.openrouter,
        { mixedDefaultModelId: "openrouter/auto" },
      ),
      fakeDefinition(
        "groq",
        [
          freeTier("groq", "small-8b"),
          freeTier("groq", "openai/gpt-oss-120b", { reasoning: true }),
          paid("groq", "mid-70b"),
        ],
        controls.groq,
      ),
      fakeDefinition(
        "omniroute",
        [entry({ provider: "omniroute", providerModelId: "auto", router: true, pricingKnown: false })],
        controls.omniroute,
        {
          mixedDefaultModelId: "omniroute/auto",
        },
      ),
    ]);
    const resolveDeps = resolveDepsFor(configured);
    const catalog = new CatalogService({ registry, resolveDeps, cacheDir: null });
    const health = new HealthTracker();
    const attestations = (): FreeAttestations => ({ freePlanProviders: new Set(), freeModelPatterns: {} });
    const policy = (): ModelPolicy => parseModelPolicy(process.env[MODEL_POLICY_ENV]) ?? "free";
    const provider = new RoutingProvider({
      registry,
      catalog,
      health,
      resolveDeps,
      policy,
      attestations,
      catalogWaitMs: 50,
    });
    return {
      registry,
      catalog,
      health,
      provider,
      resolveDeps,
      policy,
      attestations,
      async start() {
        await catalog.refresh();
      },
      async refresh() {
        await catalog.refresh({ force: true });
      },
      async reload() {
        await catalog.refresh({ force: true });
      },
      dispose() {},
    };
  };
}

const base = (extra: Partial<Parameters<typeof configureRoutedSession>[1]> = {}) => ({
  policy: "free" as ModelPolicy,
  explicitModelSelection: false,
  pickedModel: () => undefined as string | undefined,
  saveMode: () => {},
  ...extra,
});

describe("starting a session", () => {
  it("starts Free on Auto Free whatever model was saved: Free is automatic", async () => {
    const { agent, state } = stubAgent();
    const session = await configureRoutedSession(
      agent,
      base({ requestedModel: "openrouter/vendor/paid-405b", createRuntime: runtimeWith(["openrouter"]) }),
    );
    expect(session.modelId).toBe("shelra/free");
    expect(state.model).toBe("shelra/free");
    expect(process.env[MODEL_POLICY_ENV]).toBe("free");
  });

  it("is told, not surprised: a model asked for by name that Free cannot run stops the start with the reason", async () => {
    const { agent } = stubAgent();
    await expect(
      configureRoutedSession(
        agent,
        base({
          requestedModel: "openrouter/vendor/paid-405b",
          explicitModelSelection: true,
          createRuntime: runtimeWith(["openrouter"]),
        }),
      ),
    ).rejects.toThrow(/Free mode uses free models only|is paid/);
    const ok = stubAgent();
    const session = await configureRoutedSession(
      ok.agent,
      base({
        requestedModel: "openrouter/vendor/free-70b:free",
        explicitModelSelection: true,
        createRuntime: runtimeWith(["openrouter"]),
      }),
    );
    expect(session.modelId).toBe("openrouter/vendor/free-70b:free");
  });

  it("reports no provider with how to add one", async () => {
    await expect(configureRoutedSession(stubAgent().agent, base({ createRuntime: runtimeWith([]) }))).rejects.toThrow(
      /No model provider is configured/,
    );
  });

  it("gives Mixed no fallback in Free, and Auto Free as the fallback in Mixed", async () => {
    const free = stubAgent();
    await configureRoutedSession(free.agent, base({ createRuntime: runtimeWith(["openrouter"]) }));
    const freeSource = free.state.fallback as CredentialFallbackSource;
    expect(await freeSource({ modelId: "x", signal: new AbortController().signal })).toBeNull();

    const mixed = stubAgent();
    await configureRoutedSession(mixed.agent, base({ policy: "mixed", createRuntime: runtimeWith(["openrouter"]) }));
    process.env[MODEL_POLICY_ENV] = "mixed";
    const mixedSource = mixed.state.fallback as CredentialFallbackSource;
    expect(await mixedSource({ modelId: "x", signal: new AbortController().signal })).toMatchObject({
      modelId: "shelra/free",
    });
  });
});

describe("the provider Mixed mode starts on", () => {
  const mixed = (extra: Partial<Parameters<typeof configureRoutedSession>[1]>, configured: string[]) =>
    configureRoutedSession(
      stubAgent().agent,
      base({ policy: "mixed", createRuntime: runtimeWith(configured), ...extra }),
    );

  it("is the first configured provider's router when nothing was chosen", async () => {
    expect((await mixed({}, ["groq", "openrouter"])).modelId).toBe("openrouter/auto");
    expect((await mixed({}, ["omniroute"])).modelId).toBe("omniroute/auto");
  });

  it("is the default provider's router when it has one", async () => {
    expect((await mixed({ defaultProvider: () => "omniroute" }, ["openrouter", "omniroute"])).modelId).toBe(
      "omniroute/auto",
    );
  });

  it("is the default provider's most capable model when it has no router", async () => {
    expect((await mixed({ defaultProvider: () => "groq" }, ["openrouter", "groq"])).modelId).toBe(
      "groq/openai/gpt-oss-120b",
    );
  });

  it("falls back to the first router when the default provider is no longer configured", async () => {
    expect((await mixed({ defaultProvider: () => "groq" }, ["openrouter"])).modelId).toBe("openrouter/auto");
  });

  it("yields to a model the person picked", async () => {
    const session = await mixed({ requestedModel: "groq/mid-70b", defaultProvider: () => "omniroute" }, [
      "groq",
      "omniroute",
    ]);
    expect(session.modelId).toBe("groq/mid-70b");
  });

  it("ignores a saved model whose provider is gone", async () => {
    const session = await mixed({ requestedModel: "groq/mid-70b", defaultProvider: () => "omniroute" }, ["omniroute"]);
    expect(session.modelId).toBe("omniroute/auto");
  });

  it("is never read by Free mode", async () => {
    const session = await configureRoutedSession(
      stubAgent().agent,
      base({ defaultProvider: () => "groq", createRuntime: runtimeWith(["groq", "openrouter"]) }),
    );
    expect(session.modelId).toBe("shelra/free");
  });
});

describe("changing the mode and the model while it runs", () => {
  it("switches Free to Mixed on the saved pick, back to Free on Auto Free, and saves each mode", async () => {
    const saved: ModelPolicy[] = [];
    const { agent, state } = stubAgent();
    const session = await configureRoutedSession(
      agent,
      base({
        pickedModel: () => "groq/mid-70b",
        saveMode: (mode) => saved.push(mode),
        createRuntime: runtimeWith(["groq", "openrouter"]),
      }),
    );
    expect(await session.setPolicy("mixed")).toMatchObject({ success: true, modelId: "groq/mid-70b" });
    expect(state.model).toBe("groq/mid-70b");
    expect(process.env[MODEL_POLICY_ENV]).toBe("mixed");
    // The paid model Mixed was on is not kept when the session goes back to Free.
    expect(await session.setPolicy("free")).toMatchObject({ success: true, modelId: "shelra/free" });
    expect(state.model).toBe("shelra/free");
    expect(saved).toEqual(["mixed", "free"]);
  });

  it("keeps a model that Free can run when the mode changes to Free", async () => {
    const { agent, state } = stubAgent();
    const session = await configureRoutedSession(
      agent,
      base({
        policy: "mixed",
        requestedModel: "openrouter/vendor/free-70b:free",
        createRuntime: runtimeWith(["openrouter"]),
      }),
    );
    expect(state.model).toBe("openrouter/vendor/free-70b:free");
    expect(await session.setPolicy("free")).toMatchObject({ modelId: "openrouter/vendor/free-70b:free" });
  });

  it("refuses a paid pick in Free and accepts it in Mixed", async () => {
    const { agent, state } = stubAgent();
    const session = await configureRoutedSession(agent, base({ createRuntime: runtimeWith(["openrouter"]) }));
    expect(await session.selectModel("openrouter/vendor/paid-405b")).toMatchObject({
      success: false,
      error: expect.stringMatching(/paid|free models only/i),
    });
    expect(state.model).toBe("shelra/free");
    await session.setPolicy("mixed");
    expect(await session.selectModel("openrouter/vendor/paid-405b")).toEqual({ success: true });
    expect(state.model).toBe("openrouter/vendor/paid-405b");
  });

  it("lists Auto Free first and says which models Free can run", async () => {
    const session = await configureRoutedSession(
      stubAgent().agent,
      base({ createRuntime: runtimeWith(["openrouter", "groq"]) }),
    );
    const models = session.models();
    expect(models[0]).toMatchObject({ id: "shelra/free", name: "Auto Free", freeStatus: "free" });
    const byId = new Map(models.map((model) => [model.id, model.freeStatus]));
    expect(byId.get("openrouter/vendor/free-70b:free")).toBe("free");
    expect(byId.get("openrouter/vendor/paid-405b")).toBe("paid");
    expect(byId.get("groq/small-8b")).toBe("free-plan");
  });
});
