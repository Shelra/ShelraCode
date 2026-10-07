import { describe, expect, it } from "vitest";
import type { ModelPolicy } from "../models/routing";
import { CatalogService } from "../routing/catalog-service";
import type { FreeAttestations } from "../routing/eligibility";
import { HealthTracker } from "../routing/health";
import {
  drain,
  entry,
  FakeControl,
  fakeDefinition,
  freeTier,
  gatewayModel,
  paid,
  publishedFree,
  resolveDepsFor,
} from "../routing/test-fixtures";
import { ProviderRegistry } from "./registry";
import { FreeModeRefusalError, NoFreeRouteError, type RoutingEvent, RoutingProvider } from "./routing-provider";

const FREE = "shelra/free";

interface World {
  provider: RoutingProvider;
  controls: Record<string, FakeControl>;
  health: HealthTracker;
  catalog: CatalogService;
  events: RoutingEvent[];
  clock: { now: number };
  setPolicy: (policy: ModelPolicy) => void;
  attest: FreeAttestations;
  callsTo: (providerId: string) => number;
  totalCalls: () => number;
}

interface Spec {
  id: string;
  models: ReturnType<typeof entry>[];
  configured?: boolean;
}

async function world(
  specs: Spec[],
  options: { policy?: ModelPolicy; attest?: Partial<FreeAttestations> } = {},
): Promise<World> {
  const controls: Record<string, FakeControl> = {};
  const definitions = specs.map((spec) => {
    const control = new FakeControl();
    controls[spec.id] = control;
    return fakeDefinition(spec.id, spec.models, control);
  });
  const registry = new ProviderRegistry(definitions);
  const configured = specs.filter((spec) => spec.configured !== false).map((spec) => spec.id);
  const clock = { now: 10_000_000 };
  const catalog = new CatalogService({
    registry,
    resolveDeps: resolveDepsFor(configured),
    cacheDir: null,
    now: () => clock.now,
  });
  await catalog.refresh();
  const health = new HealthTracker({ now: () => clock.now });
  let policy: ModelPolicy = options.policy ?? "free";
  const attest: FreeAttestations = {
    freePlanProviders: options.attest?.freePlanProviders ?? new Set(),
    freeModelPatterns: options.attest?.freeModelPatterns ?? {},
  };
  const events: RoutingEvent[] = [];
  const provider = new RoutingProvider({
    registry,
    catalog,
    health,
    resolveDeps: resolveDepsFor(configured),
    policy: () => policy,
    attestations: () => attest,
    now: () => clock.now,
    onEvent: (event) => events.push(event),
    catalogWaitMs: 50,
  });
  return {
    provider,
    controls,
    health,
    catalog,
    events,
    clock,
    attest,
    setPolicy: (next) => {
      policy = next;
    },
    callsTo: (providerId) => controls[providerId]?.calls.length ?? 0,
    totalCalls: () => Object.values(controls).reduce((sum, control) => sum + control.calls.length, 0),
  };
}

const streamRequest = (modelId: string) => ({
  modelId,
  system: "s",
  messages: [{ role: "user", content: "hi" }],
  tools: { read_file: {} },
  maxSteps: 3,
});

describe("RoutingProvider in Free mode", () => {
  it("runs a request on the best eligible free route of any provider", async () => {
    const w = await world([
      {
        id: "openrouter",
        models: [
          publishedFree("openrouter", "vendor/small-3b:free"),
          publishedFree("openrouter", "vendor/big-120b:free", { reasoning: true }),
        ],
      },
      { id: "groq", models: [freeTier("groq", "openai/gpt-oss-120b", { reasoning: true })] },
    ]);
    const result = await drain(w.provider.stream(streamRequest(FREE)));
    expect(result.error).toBeUndefined();
    const call = Object.values(w.controls).flatMap((control) => control.calls)[0];
    expect(call?.modelId).toBe("openrouter/vendor/big-120b:free");
    expect(w.events.find((event) => event.type === "route")).toMatchObject({
      chosen: "openrouter/vendor/big-120b:free",
    });
    // The answer is reported under the route that served it.
    expect(w.provider.lastRoute()).toBe("openrouter/vendor/big-120b:free");
    expect(w.provider.id).toBe("openrouter");
  });

  it("never reaches a paid, unknown or unvouched route, whatever the request is", async () => {
    const w = await world([
      {
        id: "paidco",
        models: [paid("paidco", "big"), entry({ provider: "paidco", providerModelId: "mystery", pricingKnown: false })],
      },
      { id: "groq", models: [freeTier("groq", "openai/gpt-oss-120b")] },
      {
        id: "omniroute",
        models: [
          gatewayModel("auto/coding:free", { router: true, free: true }),
          gatewayModel("groq/openai/gpt-oss-120b", { upstream: "groq", free: true, pricingKnown: true }),
        ],
      },
    ]);
    // Nothing is proven free: the plan is empty, and no provider is contacted.
    const stream = await drain(w.provider.stream(streamRequest(FREE)));
    expect(stream.error).toBeInstanceOf(NoFreeRouteError);
    await expect(w.provider.generateText({ modelId: FREE, system: "s", prompt: "p" })).rejects.toBeInstanceOf(
      NoFreeRouteError,
    );
    await expect(
      w.provider.generateStructured({ modelId: FREE, system: "s", prompt: "p", schema: {} }),
    ).rejects.toBeInstanceOf(NoFreeRouteError);
    expect(w.totalCalls()).toBe(0);
  });

  it("holds under many iterations: not one call reaches a route that is not proven free", async () => {
    const w = await world(
      [
        { id: "paidco", models: [paid("paidco", "a"), paid("paidco", "b", { free: true })] },
        {
          id: "openrouter",
          models: [
            publishedFree("openrouter", "x-70b:free"),
            paid("openrouter", "y"),
            entry({ provider: "openrouter", providerModelId: "auto", free: true, pricingKnown: false }),
          ],
        },
        { id: "groq", models: [freeTier("groq", "g1"), freeTier("groq", "g2")] },
        {
          id: "omniroute",
          models: [gatewayModel("auto", { router: true }), gatewayModel("openai/gpt-5", { upstream: "openai" })],
        },
      ],
      { attest: { freePlanProviders: new Set(), freeModelPatterns: {} } },
    );
    const allowed = new Set(["openrouter/x-70b:free"]);
    for (let index = 0; index < 300; index += 1) {
      // Failures come and go; whatever the health, only the one proven route may be called.
      if (index % 7 === 0) w.controls.openrouter!.mode = index % 14 === 0 ? "rate-limit" : "ok";
      w.clock.now += 10 * 60_000;
      await drain(w.provider.stream(streamRequest(FREE)));
      await w.provider.generateText({ modelId: FREE, system: "s", prompt: "p" }).catch(() => undefined);
    }
    const reached = Object.values(w.controls).flatMap((control) => control.calls.map((call) => call.modelId));
    expect(reached.length).toBeGreaterThan(100);
    for (const modelId of reached) expect(allowed.has(modelId), modelId).toBe(true);
  });

  it("continues across providers when several fail, and does not hammer the ones that did", async () => {
    const w = await world(
      [
        { id: "groq", models: [freeTier("groq", "openai/gpt-oss-120b", { reasoning: true, context: 131_072 })] },
        {
          id: "omniroute",
          models: [gatewayModel("opencode-free/big-70b", { upstream: "opencode-free", reasoning: true })],
        },
        { id: "gemini", models: [freeTier("gemini", "gemini-2.5-flash", { reasoning: true })] },
        { id: "openrouter", models: [publishedFree("openrouter", "vendor/model-8b:free")] },
      ],
      {
        attest: {
          freePlanProviders: new Set(["groq", "gemini"]),
          freeModelPatterns: { omniroute: ["opencode-free/*"] },
        },
      },
    );
    w.controls.groq!.mode = "rate-limit";
    w.controls.omniroute!.mode = "offline";
    w.controls.gemini!.mode = "quota";
    const first = await drain(w.provider.stream(streamRequest(FREE)));
    expect(first.error).toBeUndefined();
    // Each failed provider was tried once, in one call, then the OpenRouter route answered.
    expect(w.callsTo("groq")).toBe(1);
    expect(w.callsTo("omniroute")).toBe(1);
    expect(w.callsTo("gemini")).toBe(1);
    expect(w.callsTo("openrouter")).toBe(1);
    expect(w.provider.lastRoute()).toBe("openrouter/vendor/model-8b:free");
    expect(
      w.events
        .filter((event) => event.type === "failover")
        .map((event) => (event as { kind: string }).kind)
        .sort(),
    ).toEqual(["quota", "rate-limit", "unavailable"]);

    // The next request goes straight to the one that works.
    await drain(w.provider.stream(streamRequest(FREE)));
    expect(w.callsTo("groq")).toBe(1);
    expect(w.callsTo("omniroute")).toBe(1);
    expect(w.callsTo("gemini")).toBe(1);
    expect(w.callsTo("openrouter")).toBe(2);
  });

  it("lets the router decide from the evidence: a different set of failures gives a different route", async () => {
    const w = await world(
      [
        { id: "groq", models: [freeTier("groq", "openai/gpt-oss-120b", { reasoning: true })] },
        { id: "gemini", models: [freeTier("gemini", "gemini-2.5-flash", { reasoning: true })] },
        { id: "openrouter", models: [publishedFree("openrouter", "vendor/model-8b:free")] },
      ],
      { attest: { freePlanProviders: new Set(["groq", "gemini"]), freeModelPatterns: {} } },
    );
    w.controls.openrouter!.mode = "server-error";
    w.controls.groq!.mode = "server-error";
    const result = await drain(w.provider.stream(streamRequest(FREE)));
    expect(result.error).toBeUndefined();
    expect(w.provider.lastRoute()).toBe("gemini/gemini-2.5-flash");
  });

  it("hands the failure to the turn when nothing reached it and every route has failed", async () => {
    const w = await world([
      {
        id: "openrouter",
        models: [publishedFree("openrouter", "a-70b:free"), publishedFree("openrouter", "b-70b:free")],
      },
    ]);
    w.controls.openrouter!.mode = "rate-limit";
    const result = await drain(w.provider.stream(streamRequest(FREE)));
    expect(result.error).toBeDefined();
    // Two routes, two attempts: bounded, not a loop.
    expect(w.callsTo("openrouter")).toBe(2);
    // With both cooling, the next request says so without contacting anyone.
    const again = await drain(w.provider.stream(streamRequest(FREE)));
    expect((again.error as Error).message).toMatch(/cooling down/);
    expect(w.callsTo("openrouter")).toBe(2);
  });

  it("tries free routes that failed in passing before their cooldown ends, instead of leaving the turn with none", async () => {
    const w = await world([
      {
        id: "openrouter",
        models: [publishedFree("openrouter", "a-70b:free"), publishedFree("openrouter", "b-70b:free")],
      },
    ]);
    w.controls.openrouter!.mode = "server-error";
    const first = await drain(w.provider.stream(streamRequest(FREE)));
    expect(first.error).toBeDefined();
    const before = w.callsTo("openrouter");
    // Every route is cooling down after a passing fault; the service has recovered in the meantime.
    w.controls.openrouter!.mode = "ok";
    const again = await drain(w.provider.stream(streamRequest(FREE)));
    expect(again.error).toBeUndefined();
    expect(w.callsTo("openrouter")).toBe(before + 1);
    expect(w.events.some((event) => event.type === "probe")).toBe(true);
  });

  it("does not probe routes that are cooling down for a rate limit or a spent quota", async () => {
    const w = await world([{ id: "openrouter", models: [publishedFree("openrouter", "a-70b:free")] }]);
    w.controls.openrouter!.mode = "quota";
    await drain(w.provider.stream(streamRequest(FREE)));
    const before = w.callsTo("openrouter");
    w.controls.openrouter!.mode = "ok";
    const again = await drain(w.provider.stream(streamRequest(FREE)));
    expect((again.error as Error).message).toMatch(/cooling down/);
    expect(w.callsTo("openrouter")).toBe(before);
    expect(w.events.some((event) => event.type === "probe")).toBe(false);
  });

  it("does not cool a route down, or move to the next one, when the person cancelled the call", async () => {
    const w = await world([
      {
        id: "openrouter",
        models: [publishedFree("openrouter", "a-70b:free"), publishedFree("openrouter", "b-70b:free")],
      },
    ]);
    w.controls.openrouter!.mode = "offline";
    const controller = new AbortController();
    controller.abort(new Error("cancelled by the person"));
    await expect(
      w.provider.generateText({ modelId: FREE, system: "s", prompt: "p", signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(w.callsTo("openrouter")).toBe(1);
    expect(w.events.some((event) => event.type === "failover")).toBe(false);
    // Nothing is cooling down: the next request reaches a route again.
    w.controls.openrouter!.mode = "ok";
    const next = await drain(w.provider.stream(streamRequest(FREE)));
    expect(next.error).toBeUndefined();
  });

  it("still penalizes a route that ran out of its time budget: only the person's cancel is nobody's fault", async () => {
    const w = await world([
      {
        id: "openrouter",
        models: [publishedFree("openrouter", "a-70b:free"), publishedFree("openrouter", "b-70b:free")],
      },
    ]);
    w.controls.openrouter!.mode = "offline";
    const controller = new AbortController();
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
    await w.provider
      .generateText({ modelId: FREE, system: "s", prompt: "p", signal: controller.signal })
      .catch(() => {});
    expect(w.events.some((event) => event.type === "failover")).toBe(true);
  });

  it("keeps what it learned about a provider when only the catalog is refreshed", async () => {
    const w = await world([{ id: "openrouter", models: [publishedFree("openrouter", "a-70b:free")] }]);
    w.controls.openrouter!.mode = "quota";
    await drain(w.provider.stream(streamRequest(FREE)));
    w.provider.resetConfigCache(false);
    w.controls.openrouter!.mode = "ok";
    const again = await drain(w.provider.stream(streamRequest(FREE)));
    expect((again.error as Error).message).toMatch(/cooling down/);
  });

  it("starts a reconfigured provider clean: a key refused earlier no longer keeps it cooling down", async () => {
    const w = await world([{ id: "openrouter", models: [publishedFree("openrouter", "a-70b:free")] }]);
    w.controls.openrouter!.mode = "unauthorized";
    await drain(w.provider.stream(streamRequest(FREE)));
    w.controls.openrouter!.mode = "ok";
    const blocked = await drain(w.provider.stream(streamRequest(FREE)));
    expect(blocked.error).toBeDefined();
    w.provider.resetConfigCache();
    const after = await drain(w.provider.stream(streamRequest(FREE)));
    expect(after.error).toBeUndefined();
  });

  it("does not switch routes after the turn has already seen output", async () => {
    const w = await world([
      {
        id: "openrouter",
        models: [
          publishedFree("openrouter", "a-70b:free", { reasoning: true }),
          publishedFree("openrouter", "b-8b:free"),
        ],
      },
    ]);
    w.controls.openrouter!.mode = "server-error";
    w.controls.openrouter!.failAfterOutput = true;
    const result = await drain(w.provider.stream(streamRequest(FREE)));
    expect(result.events[0]?.type).toBe("text-delta");
    expect(result.error).toBeDefined();
    expect(w.callsTo("openrouter")).toBe(1);
  });

  it("takes a provider back after its cooldown, and stays responsive while it is down", async () => {
    const w = await world(
      [
        {
          id: "omniroute",
          models: [gatewayModel("opencode-free/big-70b", { upstream: "opencode-free", reasoning: true })],
        },
        { id: "openrouter", models: [publishedFree("openrouter", "vendor/model-8b:free")] },
      ],
      { attest: { freePlanProviders: new Set(), freeModelPatterns: { omniroute: ["opencode-free/*"] } } },
    );
    w.controls.omniroute!.mode = "offline";
    const started = Date.now();
    await drain(w.provider.stream(streamRequest(FREE)));
    expect(Date.now() - started).toBeLessThan(500);
    expect(w.provider.lastRoute()).toBe("openrouter/vendor/model-8b:free");
    expect(w.callsTo("omniroute")).toBe(1);

    // Still down after 20 seconds: not asked again.
    w.clock.now += 20_000;
    await drain(w.provider.stream(streamRequest(FREE)));
    expect(w.callsTo("omniroute")).toBe(1);

    // It comes back; once the cooldown has passed it is the best route again.
    w.controls.omniroute!.mode = "ok";
    w.clock.now += 120_000;
    await drain(w.provider.stream(streamRequest(FREE)));
    expect(w.provider.lastRoute()).toBe("omniroute/opencode-free/big-70b");
  });

  it("cannot be used to pin a paid model: no provider is called", async () => {
    const w = await world([
      {
        id: "openrouter",
        models: [paid("openrouter", "anthropic/claude-sonnet"), publishedFree("openrouter", "x-70b:free")],
      },
      { id: "groq", models: [freeTier("groq", "openai/gpt-oss-120b")] },
      {
        id: "omniroute",
        models: [
          gatewayModel("groq/openai/gpt-oss-120b", { upstream: "groq" }),
          gatewayModel("auto", { router: true }),
        ],
      },
    ]);
    for (const modelId of [
      "openrouter/anthropic/claude-sonnet",
      "anthropic/claude-sonnet",
      "groq/openai/gpt-oss-120b", // a free plan nobody declared free
      "omniroute/auto",
      "omniroute/groq/openai/gpt-oss-120b",
      "openrouter/unlisted/model:free", // a ":free" id the catalog does not list is not trusted
    ]) {
      const result = await drain(w.provider.stream(streamRequest(modelId)));
      expect(result.error, modelId).toBeInstanceOf(FreeModeRefusalError);
      expect((result.error as Error).message, modelId).toMatch(/free mode uses free models only/i);
      await expect(w.provider.generateText({ modelId, system: "s", prompt: "p" }), modelId).rejects.toBeInstanceOf(
        FreeModeRefusalError,
      );
    }
    expect(w.totalCalls()).toBe(0);
  });

  it("runs a pinned free-plan model once the user declared the key has no billing", async () => {
    const w = await world([{ id: "groq", models: [freeTier("groq", "openai/gpt-oss-120b")] }], {
      attest: { freePlanProviders: new Set(["groq"]) },
    });
    const result = await drain(w.provider.stream(streamRequest("groq/openai/gpt-oss-120b")));
    expect(result.error).toBeUndefined();
    expect(w.callsTo("groq")).toBe(1);
  });

  it("leaves a provider out of Free mode for the session when it charges, or serves a model that is not free", async () => {
    const w = await world(
      [
        {
          id: "omniroute",
          models: [gatewayModel("opencode-free/big-70b", { upstream: "opencode-free", reasoning: true })],
        },
        { id: "openrouter", models: [publishedFree("openrouter", "vendor/model-8b:free")] },
      ],
      { attest: { freeModelPatterns: { omniroute: ["opencode-free/*"] } } },
    );
    w.controls.omniroute!.mode = "charged";
    const first = await drain(w.provider.stream(streamRequest(FREE)));
    expect(first.error).toBeUndefined();
    expect(w.events.some((event) => event.type === "violation")).toBe(true);
    expect(w.provider.routingNotes().join(" ")).toMatch(/omniroute/i);
    // From now on only the other provider is used.
    w.clock.now += 3_600_000;
    await drain(w.provider.stream(streamRequest(FREE)));
    expect(w.provider.lastRoute()).toBe("openrouter/vendor/model-8b:free");
    expect(w.callsTo("omniroute")).toBe(1);
    // A pinned request for it is refused too.
    const pinned = await drain(w.provider.stream(streamRequest("omniroute/opencode-free/big-70b")));
    expect(pinned.error).toBeInstanceOf(FreeModeRefusalError);
  });

  it("waits for a catalog that is still loading instead of failing at once", async () => {
    const w = await world([{ id: "openrouter", models: [publishedFree("openrouter", "x-70b:free")] }]);
    // A fresh catalog service that has not refreshed yet.
    const registry = new ProviderRegistry([
      fakeDefinition("openrouter", [publishedFree("openrouter", "x-70b:free")], w.controls.openrouter!),
    ]);
    const catalog = new CatalogService({ registry, resolveDeps: resolveDepsFor(["openrouter"]), cacheDir: null });
    const provider = new RoutingProvider({
      registry,
      catalog,
      health: new HealthTracker(),
      resolveDeps: resolveDepsFor(["openrouter"]),
      policy: () => "free",
      attestations: () => ({ freePlanProviders: new Set(), freeModelPatterns: {} }),
      catalogWaitMs: 2_000,
    });
    void catalog.refresh();
    const result = await drain(provider.stream(streamRequest(FREE)));
    expect(result.error).toBeUndefined();
  });

  it("says how to configure a provider when none is configured", async () => {
    const w = await world([{ id: "groq", models: [freeTier("groq", "g")], configured: false }]);
    const result = await drain(w.provider.stream(streamRequest(FREE)));
    expect((result.error as Error).message).toContain("configure groq");
  });

  it("answers the request's own needs: vision is not sent to a model that cannot see", async () => {
    const w = await world([
      {
        id: "openrouter",
        models: [
          publishedFree("openrouter", "text-405b:free", { reasoning: true }),
          publishedFree("openrouter", "seer-8b:free", { vision: true }),
        ],
      },
    ]);
    const result = await drain(
      w.provider.stream({
        ...streamRequest(FREE),
        messages: [
          {
            role: "user",
            content: [
              { type: "image", image: "x" },
              { type: "text", text: "what is this" },
            ],
          },
        ],
      }),
    );
    expect(result.error).toBeUndefined();
    expect(w.controls.openrouter!.calls[0]?.modelId).toBe("openrouter/seer-8b:free");
  });
});

describe("RoutingProvider in Mixed mode", () => {
  it("sends a pinned model to the provider it names, with the canonical id, whichever provider that is", async () => {
    const w = await world(
      [
        {
          id: "omniroute",
          models: [
            gatewayModel("auto/coding", { router: true }),
            gatewayModel("anthropic/claude-sonnet", { upstream: "anthropic" }),
          ],
        },
        { id: "openrouter", models: [paid("openrouter", "anthropic/claude-sonnet")] },
        { id: "groq", models: [freeTier("groq", "openai/gpt-oss-120b")] },
        { id: "gemini", models: [paid("gemini", "gemini-2.5-pro")] },
      ],
      { policy: "mixed" },
    );
    for (const [modelId, providerId] of [
      ["omniroute/auto/coding", "omniroute"],
      ["omniroute/anthropic/claude-sonnet", "omniroute"],
      ["openrouter/anthropic/claude-sonnet", "openrouter"],
      ["groq/openai/gpt-oss-120b", "groq"],
      ["gemini/gemini-2.5-pro", "gemini"],
    ] as const) {
      const before = w.callsTo(providerId);
      const result = await drain(w.provider.stream(streamRequest(modelId)));
      expect(result.error, modelId).toBeUndefined();
      expect(w.callsTo(providerId), modelId).toBe(before + 1);
      expect(w.controls[providerId]!.calls.at(-1)?.modelId, modelId).toBe(modelId);
    }
    // Same upstream model, two providers: each request reached exactly the provider asked.
    expect(w.callsTo("openrouter")).toBe(1);
    expect(w.callsTo("omniroute")).toBe(2);
  });

  it("reads a bare saved id as OpenRouter, as it always did", async () => {
    const w = await world(
      [
        { id: "openrouter", models: [paid("openrouter", "anthropic/claude-sonnet")] },
        { id: "groq", models: [freeTier("groq", "openai/gpt-oss-120b")] },
      ],
      { policy: "mixed" },
    );
    await drain(w.provider.stream(streamRequest("anthropic/claude-sonnet")));
    expect(w.controls.openrouter!.calls[0]?.modelId).toBe("openrouter/anthropic/claude-sonnet");
    expect(w.callsTo("groq")).toBe(0);
  });

  it("does not pretend a model is free when it asks for a model of a provider that does not exist or is not configured", async () => {
    const w = await world(
      [
        { id: "groq", models: [], configured: false },
        { id: "openrouter", models: [paid("openrouter", "x")] },
      ],
      { policy: "mixed" },
    );
    const missing = await drain(w.provider.stream(streamRequest("groq/anything")));
    expect((missing.error as Error).message).toContain("configure groq");
    expect(w.totalCalls()).toBe(0);
  });

  it("follows a switch of mode at once: a paid pick runs in Mixed and is refused in Free", async () => {
    const w = await world(
      [
        {
          id: "openrouter",
          models: [paid("openrouter", "anthropic/claude-sonnet"), publishedFree("openrouter", "x-70b:free")],
        },
      ],
      { policy: "mixed" },
    );
    expect((await drain(w.provider.stream(streamRequest("openrouter/anthropic/claude-sonnet")))).error).toBeUndefined();
    w.setPolicy("free");
    expect((await drain(w.provider.stream(streamRequest("openrouter/anthropic/claude-sonnet")))).error).toBeInstanceOf(
      FreeModeRefusalError,
    );
    w.setPolicy("mixed");
    expect((await drain(w.provider.stream(streamRequest("openrouter/anthropic/claude-sonnet")))).error).toBeUndefined();
  });

  it("runs auxiliary calls on a free route even in Mixed mode: a title never costs money", async () => {
    const w = await world(
      [
        {
          id: "openrouter",
          models: [paid("openrouter", "anthropic/claude-sonnet"), publishedFree("openrouter", "x-70b:free")],
        },
      ],
      { policy: "mixed" },
    );
    expect(w.provider.defaultModelId).toBe(FREE);
    await w.provider.generateText({ modelId: w.provider.defaultModelId, system: "s", prompt: "p" });
    expect(w.controls.openrouter!.calls[0]?.modelId).toBe("openrouter/x-70b:free");
  });
});

describe("RoutingProvider: runtime information and fallbacks", () => {
  it("describes the virtual Free model as free, with the smallest window among its best routes", async () => {
    const w = await world([
      {
        id: "openrouter",
        models: [
          publishedFree("openrouter", "a-120b:free", { context: 1_000_000, reasoning: true }),
          publishedFree("openrouter", "b-70b:free", { context: 64_000 }),
        ],
      },
    ]);
    const runtime = w.provider.resolveModelRuntime(FREE);
    expect(runtime.modelId).toBe(FREE);
    expect(runtime.modelInfo).toMatchObject({
      name: "Auto Free",
      inputPrice: 0,
      outputPrice: 0,
      pricingKnown: true,
      contextWindow: 64_000,
    });
  });

  it("never reports an unlisted model as free", async () => {
    const w = await world([{ id: "openrouter", models: [publishedFree("openrouter", "x:free")] }], { policy: "mixed" });
    const runtime = w.provider.resolveModelRuntime("openrouter/never/listed");
    expect(runtime.modelInfo?.pricingKnown).toBe(false);
    expect(runtime.modelId).toBe("openrouter/never/listed");
  });

  it("offers only eligible routes of any provider as fallbacks in Free mode", async () => {
    const w = await world(
      [
        { id: "openrouter", models: [publishedFree("openrouter", "a-120b:free"), paid("openrouter", "b")] },
        { id: "groq", models: [freeTier("groq", "g-70b")] },
        { id: "gemini", models: [freeTier("gemini", "m-70b")] },
      ],
      { attest: { freePlanProviders: new Set(["groq"]) } },
    );
    const fallbacks = w.provider.fallbackModelIds("openrouter/a-120b:free");
    expect(fallbacks).toEqual(["groq/g-70b"]);
    expect(w.provider.fallbackModelIds(FREE)).toEqual([]);
  });

  it("re-plans on a retry: the same virtual model lands on another route once the first is cooling", async () => {
    const w = await world([
      {
        id: "openrouter",
        models: [
          publishedFree("openrouter", "a-120b:free", { reasoning: true }),
          publishedFree("openrouter", "b-70b:free"),
        ],
      },
    ]);
    w.health.recordFailure("openrouter/a-120b:free", "openrouter", { kind: "rate-limit" });
    await drain(w.provider.stream(streamRequest(FREE)));
    expect(w.controls.openrouter!.calls[0]?.modelId).toBe("openrouter/b-70b:free");
  });
});
