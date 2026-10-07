import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "../models/types";
import { classifyFreeEligibility, type FreeAttestations } from "./eligibility";
import { planFreeRoutes, routeIds, upstreamRouteKey } from "./free-router";
import { HealthTracker } from "./health";
import { entry, freeTier, gatewayModel, paid, publishedFree } from "./test-fixtures";

const NONE: FreeAttestations = { freePlanProviders: new Set(), freeModelPatterns: {} };
const PLAN = (...providers: string[]): FreeAttestations => ({
  freePlanProviders: new Set(providers),
  freeModelPatterns: {},
});

function freeRouter(): CatalogEntry {
  const router = entry({
    provider: "openrouter",
    providerModelId: "free",
    free: true,
    router: true,
    confidence: "catalog",
  });
  router.id = "openrouter/free";
  return router;
}

/** A small deterministic generator, so a failing iteration can be replayed from its seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCatalog(random: () => number): CatalogEntry[] {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const providers = ["openrouter", "groq", "gemini", "cloudflare", "omniroute", "mistral", "cerebras"];
  const entries: CatalogEntry[] = [];
  const count = 5 + Math.floor(random() * 60);
  for (let index = 0; index < count; index += 1) {
    const provider = pick(providers);
    const id = `m${index}-${Math.floor(random() * 1_000)}${random() < 0.3 ? "-70b" : ""}`;
    const kind = Math.floor(random() * 9);
    const flags = {
      tools: random() < 0.8,
      vision: random() < 0.2,
      reasoning: random() < 0.3,
      context: pick([8_000, 32_000, 128_000, 1_000_000]),
    };
    switch (kind) {
      case 0:
        entries.push(publishedFree(provider, id, flags));
        break;
      case 1:
        entries.push(paid(provider, id, flags));
        break;
      case 2:
        entries.push(freeTier(provider, id, flags));
        break;
      case 3:
        entries.push(gatewayModel(`${pick(providers)}/${id}`, { ...flags, upstream: pick(providers) }));
        break;
      case 4:
        entries.push(
          gatewayModel(pick(["auto", "auto/coding", "auto/fast:free", "combo-x"]), { ...flags, router: true }),
        );
        break;
      case 5:
        entries.push(entry({ provider, providerModelId: id, pricingKnown: false, ...flags }));
        break;
      case 6:
        // Zero-looking prices with nothing behind them.
        entries.push(entry({ provider, providerModelId: id, free: true, ...flags }));
        break;
      case 7:
        entries.push(
          entry({
            provider: "openrouter",
            providerModelId: pick(["auto", "auto-beta"]),
            free: true,
            pricingKnown: false,
          }),
        );
        break;
      default:
        entries.push(paid(provider, id, { ...flags, free: true }));
    }
  }
  if (random() < 0.5) entries.push(freeRouter());
  return entries;
}

describe("planFreeRoutes: the strict Free invariant", () => {
  it("emits only routes that classifyFreeEligibility proves eligible, across thousands of random catalogs", () => {
    const providers = ["openrouter", "groq", "gemini", "cloudflare", "omniroute", "mistral", "cerebras"];
    let produced = 0;
    for (let seed = 1; seed <= 3_000; seed += 1) {
      const random = mulberry32(seed);
      const entries = randomCatalog(random);
      const attestations: FreeAttestations = {
        freePlanProviders: new Set(providers.filter(() => random() < 0.3)),
        freeModelPatterns: random() < 0.3 ? { omniroute: ["groq/*", "opencode-free/*", "*"] } : {},
      };
      const health = new HealthTracker({ now: () => 1_000_000 });
      for (const candidate of entries)
        if (random() < 0.15) health.recordFailure(candidate.id, candidate.provider, { kind: "rate-limit" });
      const plan = planFreeRoutes(
        entries,
        { requiresTools: random() < 0.7, minimumContext: random() < 0.3 ? 100_000 : undefined, now: 1_000_000 },
        { attestations, health },
      );
      for (const route of plan.routes) {
        produced += 1;
        const verdict = classifyFreeEligibility(route.entry, attestations);
        expect(verdict.eligible, `seed ${seed}: ${route.id}`).toBe(true);
        expect(verdict.level, `seed ${seed}: ${route.id}`).not.toBe("paid");
        expect(verdict.level, `seed ${seed}: ${route.id}`).not.toBe("unknown");
        // Never a router the user could not have vouched for, except OpenRouter's own free router.
        if (route.entry.state.kind === "cloud" && route.entry.state.router) expect(route.id).toBe("openrouter/free");
        expect(route.entry.cost.prompt).toBe(0);
        expect(route.entry.cost.completion).toBe(0);
      }
      // Every entry is accounted for: planned or rejected with a reason.
      expect(plan.routes.length + plan.rejected.length).toBe(new Set(entries.map((e) => e.id)).size);
    }
    expect(produced).toBeGreaterThan(1_000);
  });

  it("returns nothing, not a paid route, when no free model exists", () => {
    const entries = [
      paid("openrouter", "a"),
      paid("groq", "b"),
      freeTier("groq", "c"),
      gatewayModel("auto", { router: true }),
    ];
    const plan = planFreeRoutes(entries, {}, { attestations: NONE });
    expect(plan.routes).toEqual([]);
    expect(plan.rejected).toHaveLength(4);
    expect(plan.rejected.find((item) => item.id === "groq/c")?.reason).toContain("allow-free");
  });

  it("does not let OmniRoute's fail-open alias in: auto/…:free is a router, never a candidate", () => {
    const entries = [
      gatewayModel("auto/coding:free", { router: true, free: true, pricingKnown: true }),
      gatewayModel("auto", { router: true }),
    ];
    const plan = planFreeRoutes(
      entries,
      {},
      { attestations: { freePlanProviders: new Set(["omniroute"]), freeModelPatterns: { omniroute: ["*"] } } },
    );
    expect(plan.routes).toEqual([]);
  });
});

describe("planFreeRoutes: agreement with an independent oracle", () => {
  /**
   * Each entry is built from a known recipe, so what Free mode may run is known without asking the classifier:
   * a model is free exactly when the provider's own price says zero, or the user declared it so.
   */
  it("plans exactly the models that are free by construction, no more and no fewer", () => {
    const providers = ["openrouter", "groq", "gemini", "omniroute", "mistral"];
    for (let seed = 1; seed <= 1_500; seed += 1) {
      const random = mulberry32(seed * 7919);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
      const attestations: FreeAttestations = {
        freePlanProviders: new Set(providers.filter(() => random() < 0.4)),
        freeModelPatterns: random() < 0.5 ? { omniroute: ["opencode-free/*"] } : {},
      };
      const vouched = (attestations.freeModelPatterns.omniroute ?? []).length > 0;
      const entries: CatalogEntry[] = [];
      const oracle = new Map<string, boolean>();
      for (let index = 0; index < 40; index += 1) {
        const provider = pick(providers);
        const id = `model-${index}`;
        switch (Math.floor(random() * 8)) {
          case 0: {
            const model = publishedFree("openrouter", `${id}:free`);
            entries.push(model);
            oracle.set(model.id, true);
            break;
          }
          case 1: {
            const model = paid(provider, id);
            entries.push(model);
            oracle.set(model.id, false);
            break;
          }
          case 2: {
            const model = freeTier(provider, id);
            entries.push(model);
            oracle.set(model.id, attestations.freePlanProviders.has(provider));
            break;
          }
          case 3: {
            const model = gatewayModel(`opencode-free/${id}`, { upstream: "opencode-free" });
            entries.push(model);
            oracle.set(model.id, vouched);
            break;
          }
          case 4: {
            const model = gatewayModel(`groq/${id}`, { upstream: "groq", free: true, pricingKnown: true });
            entries.push(model);
            oracle.set(model.id, false);
            break;
          }
          case 5: {
            const model = gatewayModel(`auto/${id}`, { router: true });
            entries.push(model);
            oracle.set(model.id, false);
            break;
          }
          case 6: {
            const model = entry({ provider, providerModelId: id, pricingKnown: false });
            entries.push(model);
            oracle.set(model.id, false);
            break;
          }
          default: {
            const model = entry({ provider: "openrouter", providerModelId: "auto", pricingKnown: false });
            entries.push(model);
            oracle.set(model.id, false);
          }
        }
      }
      const planned = new Set(routeIds(planFreeRoutes(entries, {}, { attestations })));
      for (const [id, expected] of oracle) expect(planned.has(id), `seed ${seed}: ${id}`).toBe(expected);
    }
  });
});

describe("planFreeRoutes: ranking and failover evidence", () => {
  const catalog = [
    publishedFree("openrouter", "nvidia/nemotron-3-ultra-550b:free", { reasoning: true }),
    publishedFree("openrouter", "liquid/lfm-2.6b:free", { reasoning: false }),
    freeTier("groq", "openai/gpt-oss-120b", { reasoning: true }),
    freeTier("gemini", "gemini-2.5-flash", { reasoning: true, context: 1_000_000 }),
    freeRouter(),
  ];

  it("ranks by capability across providers, and keeps the free router last", () => {
    const plan = planFreeRoutes(catalog, {}, { attestations: PLAN("groq", "gemini") });
    const ids = routeIds(plan);
    expect(ids[0]).toBe("openrouter/nvidia/nemotron-3-ultra-550b:free");
    expect(ids.at(-1)).toBe("openrouter/free");
    expect(ids.indexOf("openrouter/liquid/lfm-2.6b:free")).toBeGreaterThan(ids.indexOf("groq/openai/gpt-oss-120b"));
    expect(plan.routes.at(-1)?.lastResort).toBe(true);
  });

  it("is deterministic and carries the evidence for each route", () => {
    const first = planFreeRoutes(catalog, {}, { attestations: PLAN("groq") });
    const second = planFreeRoutes([...catalog].reverse(), {}, { attestations: PLAN("groq") });
    expect(routeIds(first)).toEqual(routeIds(second));
    expect(first.routes[0]?.reasons.join(" ")).toContain("capability");
    expect(first.routes[0]?.eligibility.evidence).toBeTruthy();
  });

  it("skips a route that is cooling down and brings it back afterwards", () => {
    let now = 5_000_000;
    const health = new HealthTracker({ now: () => now });
    const before = routeIds(planFreeRoutes(catalog, { now }, { attestations: PLAN("groq"), health }));
    health.recordFailure("openrouter/nvidia/nemotron-3-ultra-550b:free", "openrouter", { kind: "rate-limit" });
    const during = routeIds(planFreeRoutes(catalog, { now }, { attestations: PLAN("groq"), health }));
    expect(during).not.toContain("openrouter/nvidia/nemotron-3-ultra-550b:free");
    expect(during[0]).toBe("groq/openai/gpt-oss-120b");
    now += 61_000;
    const after = routeIds(planFreeRoutes(catalog, { now }, { attestations: PLAN("groq"), health }));
    expect(after).toContain("openrouter/nvidia/nemotron-3-ultra-550b:free");
    expect(before).toContain("openrouter/nvidia/nemotron-3-ultra-550b:free");
  });

  it("skips a whole provider on cooldown, and a gateway route whose upstream is cooling", () => {
    const health = new HealthTracker({ now: () => 1 });
    health.recordFailure("groq/openai/gpt-oss-120b", "groq", { kind: "quota" });
    const viaGateway = gatewayModel("groq/openai/gpt-oss-20b", { upstream: "groq" });
    const vouched: FreeAttestations = {
      freePlanProviders: new Set(["groq", "gemini"]),
      freeModelPatterns: { omniroute: ["groq/*"] },
    };
    health.recordFailure(upstreamRouteKey("groq"), upstreamRouteKey("groq"), { kind: "quota" });
    const plan = planFreeRoutes(
      [...catalog, freeTier("groq", "other"), viaGateway],
      { now: 1 },
      { attestations: vouched, health },
    );
    const ids = routeIds(plan);
    expect(ids.some((id) => id.startsWith("groq/"))).toBe(false);
    expect(ids).not.toContain("omniroute/groq/openai/gpt-oss-20b");
    expect(plan.rejected.find((item) => item.id === "omniroute/groq/openai/gpt-oss-20b")?.reason).toContain(
      "upstream groq",
    );
  });

  it("prefers a route that answered recently and penalizes one that keeps failing", () => {
    let now = 9_000_000;
    const health = new HealthTracker({ now: () => now });
    const a = publishedFree("openrouter", "vendor/model-a-70b:free");
    const b = publishedFree("openrouter", "vendor/model-b-70b:free");
    const tie = routeIds(planFreeRoutes([a, b], { now }, { attestations: NONE, health }));
    expect(tie[0]).toBe(a.id);
    health.recordSuccess(b.id, "openrouter");
    expect(routeIds(planFreeRoutes([a, b], { now }, { attestations: NONE, health }))[0]).toBe(b.id);
    now += 31 * 60_000;
    expect(routeIds(planFreeRoutes([a, b], { now }, { attestations: NONE, health }))[0]).toBe(a.id);
  });

  it("does not prefer a local model merely because it exists", () => {
    const local = entry({ provider: "local", providerModelId: "qwen-7b", free: true });
    local.category = "local";
    local.state = { kind: "local", install: "installed" };
    const remote = publishedFree("openrouter", "vendor/model-70b:free");
    expect(routeIds(planFreeRoutes([local, remote], {}, { attestations: NONE }))[0]).toBe(remote.id);
    // …but it is still there when nothing else is.
    expect(routeIds(planFreeRoutes([local], {}, { attestations: NONE }))).toEqual([local.id]);
  });

  it("uses quota headroom when a provider reports it", () => {
    const a = freeTier("groq", "vendor/m-70b");
    const b = freeTier("gemini", "vendor/m-70b");
    const plan = planFreeRoutes(
      [a, b],
      {},
      {
        attestations: PLAN("groq", "gemini"),
        signals: { quotaHeadroom: (provider) => (provider === "gemini" ? 0.9 : 0.1) },
      },
    );
    expect(plan.routes[0]?.id).toBe(b.id);
  });

  it("leaves out the routes already tried and a provider the caller excludes", () => {
    const plan = planFreeRoutes(
      catalog,
      { excludeRoutes: new Set(["groq/openai/gpt-oss-120b"]), excludeProviders: new Set(["gemini"]) },
      { attestations: PLAN("groq", "gemini") },
    );
    const ids = routeIds(plan);
    expect(ids).not.toContain("groq/openai/gpt-oss-120b");
    expect(ids.some((id) => id.startsWith("gemini/"))).toBe(false);
  });
});

describe("planFreeRoutes: capability routing", () => {
  const entries = [
    publishedFree("openrouter", "a-70b:free", { tools: false, context: 1_000_000 }),
    publishedFree("openrouter", "b-70b:free", { vision: true, context: 32_000 }),
    publishedFree("openrouter", "c-70b:free", { reasoning: true, context: 200_000, structured: false }),
    publishedFree("openrouter", "d-70b:free", { structured: true, context: 500_000, reasoning: true, vision: true }),
  ];
  const ids = (request: Parameters<typeof planFreeRoutes>[1]) =>
    routeIds(planFreeRoutes(entries, request, { attestations: NONE })).map((id) => id.split("/")[1]);

  it("selects no model that lacks a capability the task needs, merely because it is free", () => {
    expect(ids({ requiresTools: true })).not.toContain("a-70b:free");
    expect(ids({ requiresVision: true }).sort()).toEqual(["b-70b:free", "d-70b:free"]);
    expect(ids({ requiresReasoning: true }).sort()).toEqual(["c-70b:free", "d-70b:free"]);
    expect(ids({ requiresStructuredOutput: true })).not.toContain("c-70b:free");
    expect(ids({ minimumContext: 400_000 }).sort()).toEqual(["a-70b:free", "d-70b:free"]);
    expect(
      ids({
        requiresTools: true,
        requiresVision: true,
        requiresReasoning: true,
        requiresStructuredOutput: true,
        minimumContext: 100_000,
      }),
    ).toEqual(["d-70b:free"]);
  });

  it("says why each model was left out", () => {
    const plan = planFreeRoutes(entries, { requiresVision: true }, { attestations: NONE });
    expect(plan.rejected.find((item) => item.id === "openrouter/a-70b:free")?.reason).toBe("no vision");
  });
});

describe("probing routes that are cooling down", () => {
  const catalog = () => [publishedFree("groq", "a"), publishedFree("openrouter", "b")];

  it("offers a route that failed in passing, soonest back first, and marks it as probing", () => {
    const time = { now: 1_000_000 };
    const health = new HealthTracker({ now: () => time.now });
    health.recordFailure("groq/a", "groq", { kind: "unavailable" });
    time.now += 5_000;
    health.recordFailure("openrouter/b", "openrouter", { kind: "unavailable" });
    expect(planFreeRoutes(catalog(), {}, { attestations: PLAN("groq"), health }).routes).toEqual([]);
    const plan = planFreeRoutes(catalog(), {}, { attestations: PLAN("groq"), health, probeCooling: true });
    expect(plan.routes.map((route) => route.id)).toEqual(["groq/a", "openrouter/b"]);
    expect(plan.routes.every((route) => route.probing)).toBe(true);
  });

  it("never probes a spent quota, a rate limit or a refused key", () => {
    const health = new HealthTracker({ now: () => 1_000_000 });
    health.recordFailure("groq/a", "groq", { kind: "quota" });
    health.recordFailure("openrouter/b", "openrouter", { kind: "rate-limit" });
    const plan = planFreeRoutes(catalog(), {}, { attestations: PLAN("groq"), health, probeCooling: true });
    expect(plan.routes).toEqual([]);
  });

  it("never relaxes eligibility: a model not proven free is refused even when probing", () => {
    const health = new HealthTracker({ now: () => 1_000_000 });
    const entries = [paid("groq", "pricey"), publishedFree("openrouter", "b")];
    health.recordFailure("openrouter/b", "openrouter", { kind: "unavailable" });
    const plan = planFreeRoutes(entries, {}, { attestations: PLAN("groq"), health, probeCooling: true });
    expect(plan.routes.map((route) => route.id)).toEqual(["openrouter/b"]);
  });

  it("puts available routes before probing ones", () => {
    const health = new HealthTracker({ now: () => 1_000_000 });
    health.recordFailure("groq/a", "groq", { kind: "unavailable" });
    const plan = planFreeRoutes(catalog(), {}, { attestations: PLAN("groq"), health, probeCooling: true });
    expect(plan.routes.map((route) => [route.id, route.probing === true])).toEqual([
      ["openrouter/b", false],
      ["groq/a", true],
    ]);
  });
});
