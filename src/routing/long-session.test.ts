import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModelPolicy } from "../models/routing";
import type { CatalogEntry } from "../models/types";
import { ProviderRegistry } from "../providers/registry";
import { MAX_ROUTE_ATTEMPTS, RoutingProvider } from "../providers/routing-provider";
import { CatalogService } from "./catalog-service";
import { type FreeAttestations, isFreeEligible } from "./eligibility";
import { HealthTracker } from "./health";
import {
  drain,
  entry,
  FakeControl,
  type FakeMode,
  fakeDefinition,
  freeTier,
  gatewayModel,
  paid,
  publishedFree,
  resolveDepsFor,
} from "./test-fixtures";

/**
 * A long session in miniature: hundreds of turns on five providers, with providers failing and recovering, catalogs
 * refreshing (and sometimes failing), the mode switching, and sub-agents running next to the main stream. It looks for
 * what a long session breaks: state that grows, listeners and clients that multiply, requests that loop, and a paid
 * route reached while the session said Free.
 */

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

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
beforeAll(() => process.on("unhandledRejection", onUnhandled));
afterAll(() => process.off("unhandledRejection", onUnhandled));

const TURNS = 600;
const TTL_MS = 20 * 60_000;
const PROVIDERS = ["openrouter", "groq", "gemini", "cloudflare", "omniroute"] as const;

function modelsFor(provider: (typeof PROVIDERS)[number]): CatalogEntry[] {
  const list: CatalogEntry[] = [];
  for (let index = 0; index < 30; index += 1) {
    const id = `m${index}-${index % 3 === 0 ? "70b" : "8b"}`;
    if (provider === "openrouter") {
      list.push(
        index % 4 === 0 ? paid(provider, id) : publishedFree(provider, `${id}:free`, { reasoning: index % 5 === 0 }),
      );
    } else if (provider === "omniroute") {
      list.push(
        index % 2 === 0
          ? gatewayModel(`opencode-free/${id}`, { upstream: "opencode-free" })
          : gatewayModel(`groq/${id}`, { upstream: "groq" }),
      );
    } else {
      list.push(index % 5 === 0 ? paid(provider, id) : freeTier(provider, id, { reasoning: index % 3 === 0 }));
    }
  }
  if (provider === "omniroute") list.push(gatewayModel("auto/coding:free", { router: true, free: true }));
  if (provider === "openrouter")
    list.push(entry({ provider, providerModelId: "auto", free: true, pricingKnown: false }));
  return list;
}

describe("a long session", () => {
  it("keeps its state bounded, never loops, and never reaches a paid route in Free mode", async () => {
    const random = mulberry32(20_261_006);
    const controls = Object.fromEntries(PROVIDERS.map((id) => [id, new FakeControl()])) as Record<
      (typeof PROVIDERS)[number],
      FakeControl
    >;
    let adaptersBuilt = 0;
    const registry = new ProviderRegistry(
      PROVIDERS.map((id) =>
        fakeDefinition(id, modelsFor(id), controls[id], {
          createAdapter: (config, context) => {
            adaptersBuilt += 1;
            return fakeDefinition(id, [], controls[id]).createAdapter(config, context);
          },
        }),
      ),
    );
    const startedAt = 50_000_000;
    const clock = { now: startedAt };
    const catalog = new CatalogService({
      registry,
      resolveDeps: resolveDepsFor([...PROVIDERS]),
      cacheDir: null,
      now: () => clock.now,
      ttlMs: TTL_MS,
    });
    await catalog.refresh();
    let listenerCalls = 0;
    const unsubscribe = catalog.subscribe(() => {
      listenerCalls += 1;
    });
    const attestations: FreeAttestations = {
      freePlanProviders: new Set(["groq", "gemini"]),
      freeModelPatterns: { omniroute: ["opencode-free/*"] },
    };
    let policy: ModelPolicy = "free";
    const health = new HealthTracker({ now: () => clock.now });
    const provider = new RoutingProvider({
      registry,
      catalog,
      health,
      resolveDeps: resolveDepsFor([...PROVIDERS]),
      policy: () => policy,
      attestations: () => attestations,
      now: () => clock.now,
      catalogWaitMs: 5,
    });
    const eligibleIds = new Set(
      catalog
        .snapshot()
        .entries.filter((candidate) => isFreeEligible(candidate, attestations))
        .map((candidate) => candidate.id),
    );
    // Auto routers are not eligible; openrouter/free is not in this catalog.
    expect(eligibleIds.size).toBeGreaterThan(40);

    const modes: FakeMode[] = ["rate-limit", "quota", "server-error", "offline", "unauthorized", "garbage"];
    let freeTurns = 0;
    let emptyTurns = 0;
    let maxCallsPerRequest = 0;
    let nextRefresh = 25;

    for (let turn = 0; turn < TURNS; turn += 1) {
      clock.now += 30_000 + Math.floor(random() * 120_000);
      // Providers fail and recover.
      for (const id of PROVIDERS) {
        controls[id].mode = random() < 0.22 ? (modes[Math.floor(random() * modes.length)] as FakeMode) : "ok";
        controls[id].discoveryFails = random() < 0.1;
      }
      // The catalog refreshes now and then, as the timer would; inside the TTL it asks nobody.
      if (turn === nextRefresh) {
        await catalog.refresh({ force: random() < 0.5 });
        nextRefresh += 25;
      } else {
        await catalog.refresh();
      }
      // The mode changes now and then.
      if (turn % 40 === 17) policy = "mixed";
      if (turn % 40 === 29) policy = "free";

      const before = Object.values(controls).reduce((sum, control) => sum + control.calls.length, 0);
      const marks = Object.fromEntries(PROVIDERS.map((id) => [id, controls[id].calls.length]));
      const request = (modelId: string) => ({
        modelId,
        system: "s",
        messages: [{ role: "user", content: "turn" }],
        tools: { read_file: {} },
        maxSteps: 2,
      });
      const model = policy === "mixed" && random() < 0.5 ? "openrouter/m0-70b" : "shelra/free";
      // The main stream, and sub-agents beside it.
      const results = await Promise.all([
        drain(provider.stream(request(model))),
        ...(random() < 0.4 ? [drain(provider.stream(request("shelra/free")))] : []),
        ...(random() < 0.3
          ? [provider.generateText({ modelId: "shelra/free", system: "s", prompt: "title" }).catch(() => null)]
          : []),
      ]);
      void results;
      const after = Object.values(controls).reduce((sum, control) => sum + control.calls.length, 0);
      maxCallsPerRequest = Math.max(maxCallsPerRequest, after - before);
      if (after === before) emptyTurns += 1;

      if (policy === "free") {
        freeTurns += 1;
        for (const id of PROVIDERS) {
          for (const call of controls[id].calls.slice(marks[id])) {
            expect(eligibleIds.has(call.modelId), `turn ${turn}: ${call.modelId}`).toBe(true);
          }
        }
      }
    }

    // Free turns happened, and most turns did reach a provider.
    expect(freeTurns).toBeGreaterThan(300);
    expect(emptyTurns).toBeLessThan(TURNS * 0.5);
    // A request moves across at most MAX_ROUTE_ATTEMPTS routes; three requests may run in one turn.
    expect(maxCallsPerRequest).toBeLessThanOrEqual(MAX_ROUTE_ATTEMPTS * 3);
    // One adapter per provider and mode, rebuilt only when a key or the mode changes, not per request.
    expect(adaptersBuilt).toBeLessThanOrEqual(PROVIDERS.length * 2 + 5);
    // State is bounded: the health map, the routing notes, and the subscribers.
    expect(health.size()).toBeLessThanOrEqual(512);
    expect(provider.routingNotes().length).toBeLessThanOrEqual(20 + PROVIDERS.length);
    expect((catalog as unknown as { listeners: Set<unknown> }).listeners.size).toBe(1);
    unsubscribe();
    expect((catalog as unknown as { listeners: Set<unknown> }).listeners.size).toBe(0);
    // The catalog is not polled: discovery runs when the TTL has passed in the session's own time (the simulated
    // session lasts hours), plus the forced passes, never once per turn.
    const discoveries = Object.values(controls).reduce((sum, control) => sum + control.discoveryCalls, 0);
    const ttlPasses = Math.ceil((clock.now - startedAt) / TTL_MS);
    const passes = ttlPasses + TURNS / 25 + 2;
    expect(discoveries).toBeLessThanOrEqual(PROVIDERS.length * passes);
    expect(discoveries).toBeLessThan(TURNS * PROVIDERS.length * 0.25);
    expect(listenerCalls).toBeLessThanOrEqual(passes * 2);
    // The catalog never grew.
    expect(catalog.snapshot().entries.length).toBeLessThanOrEqual(PROVIDERS.length * 32);
    expect(unhandled).toEqual([]);
  }, 60_000);
});
