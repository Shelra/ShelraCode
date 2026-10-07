import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import { guardForFreePolicy } from "../providers/free-guard";
import { ProviderRegistry } from "../providers/registry";
import { RoutingProvider } from "../providers/routing-provider";
import { CatalogService } from "../routing/catalog-service";
import type { FreeAttestations } from "../routing/eligibility";
import { HealthTracker } from "../routing/health";
import {
  entry,
  FakeControl,
  fakeDefinition,
  freeTier,
  gatewayModel,
  paid,
  publishedFree,
  resolveDepsFor,
} from "../routing/test-fixtures";

/**
 * Free mode never runs a paid model, and that includes every call a turn makes that the user does not see: the title,
 * the recap, the side question, the sub-agents. They all go through the one provider the agent holds, so these tests run
 * a real Agent on the routing provider and look at every request any provider received.
 */

const { executeEventHooksMock } = vi.hoisted(() => ({
  executeEventHooksMock: vi.fn<(input: HookInput) => Promise<AggregatedHookResult>>(),
}));

vi.mock("../storage/index", () => ({
  appendCompaction: vi.fn(),
  appendMessages: vi.fn(() => []),
  appendSystemMessage: vi.fn(() => 0),
  buildChatEntries: vi.fn(() => []),
  getLatestObjectiveForSession: vi.fn(() => null),
  getNextMessageSequence: vi.fn(() => 0),
  getSessionTotalCostMicros: vi.fn(() => 0),
  getSessionTotalTokens: vi.fn(() => 0),
  getUsageCostSinceMicros: vi.fn(() => 0),
  listSessionUsage: vi.fn(() => []),
  loadTranscript: vi.fn(() => []),
  loadTranscriptState: vi.fn(() => ({ messages: [], seqs: [] })),
  recordCheckpoint: vi.fn(),
  recordUsageEvent: vi.fn(),
  upsertObjectiveIndex: vi.fn(),
  SessionStore: class {
    getWorkspace() {
      return {
        id: "ws-1",
        scopeKey: "/tmp/ws",
        canonicalPath: "/tmp/ws",
        gitRoot: null,
        displayName: "ws",
        lastSeenAt: new Date(),
      };
    }
    private fakeSession() {
      return {
        id: "session-1",
        workspaceId: "ws-1",
        title: null,
        recap: null,
        model: "shelra/free",
        mode: "agent" as const,
        cwdAtStart: "/tmp/ws",
        cwdLast: "/tmp/ws",
        status: "active" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    openSession() {
      return this.fakeSession();
    }
    createSession() {
      return this.fakeSession();
    }
    getRequiredSession() {
      return this.fakeSession();
    }
    setModel() {}
    setMode() {}
    setTitle() {}
    setRecap() {}
    touchSession() {}
  },
}));

vi.mock("../hooks/index", () => ({ executeEventHooks: executeEventHooksMock }));

import { Agent } from "./agent";

const workspace = mkdtempSync(join(tmpdir(), "shelra-free-routing-"));
const emptyHooks: AggregatedHookResult = {
  blocked: false,
  blockingErrors: [],
  preventContinuation: false,
  additionalContexts: [],
  results: [],
};

let previousPolicy: string | undefined;
beforeEach(() => {
  previousPolicy = process.env.SHELRA_MODEL_POLICY;
  process.env.SHELRA_MODEL_POLICY = "free";
  executeEventHooksMock.mockResolvedValue(emptyHooks);
});
afterEach(() => {
  if (previousPolicy === undefined) delete process.env.SHELRA_MODEL_POLICY;
  else process.env.SHELRA_MODEL_POLICY = previousPolicy;
});

async function routedAgent() {
  const controls = {
    paidco: new FakeControl(),
    openrouter: new FakeControl(),
    groq: new FakeControl(),
    omniroute: new FakeControl(),
  };
  const registry = new ProviderRegistry([
    fakeDefinition(
      "paidco",
      [paid("paidco", "big-405b", { reasoning: true }), paid("paidco", "other")],
      controls.paidco,
    ),
    fakeDefinition(
      "openrouter",
      [
        publishedFree("openrouter", "x-70b:free", { reasoning: true }),
        paid("openrouter", "anthropic/claude-sonnet"),
        entry({ provider: "openrouter", providerModelId: "auto", free: true, pricingKnown: false, router: true }),
      ],
      controls.openrouter,
    ),
    fakeDefinition("groq", [freeTier("groq", "openai/gpt-oss-120b", { reasoning: true })], controls.groq),
    fakeDefinition(
      "omniroute",
      [
        gatewayModel("auto/coding:free", { router: true, free: true }),
        gatewayModel("openai/gpt-5", { upstream: "openai" }),
      ],
      controls.omniroute,
    ),
  ]);
  const configured = ["paidco", "openrouter", "groq", "omniroute"];
  const catalog = new CatalogService({ registry, resolveDeps: resolveDepsFor(configured), cacheDir: null });
  await catalog.refresh();
  const attestations: FreeAttestations = { freePlanProviders: new Set(), freeModelPatterns: {} };
  const provider = new RoutingProvider({
    registry,
    catalog,
    health: new HealthTracker(),
    resolveDeps: resolveDepsFor(configured),
    policy: () => "free",
    attestations: () => attestations,
  });
  const agent = new Agent(undefined, undefined, "shelra/free", undefined, {
    cwd: workspace,
    provider,
    interruptionBackoffMs: [0],
  });
  const reached = () =>
    Object.entries(controls).flatMap(([providerId, control]) =>
      control.calls.map((call) => ({ providerId, kind: call.kind, modelId: call.modelId })),
    );
  return { agent, controls, provider, reached };
}

describe("Free mode across every call a turn makes", () => {
  it("runs the turn, the title, the side question, the recap and a sub-agent only on a route proven free", async () => {
    const { agent, reached } = await routedAgent();

    for await (const _chunk of agent.processMessage("Explain the project")) {
      // drain
    }
    await agent.generateTitle("Explain the project");
    await agent.askSideQuestion("What did you just do?");
    await (agent as unknown as { refreshSessionRecap(): Promise<void> }).refreshSessionRecap();
    await agent.runTaskRequest({ agent: "explore", description: "look around", prompt: "List the top-level files." });

    const calls = reached();
    // Every kind of call reached a provider, so the check below covers all of them.
    expect(new Set(calls.map((call) => call.kind))).toEqual(new Set(["stream", "text"]));
    expect(calls.length).toBeGreaterThanOrEqual(4);
    // …and every one of them went to the single route that is proven free.
    for (const call of calls) {
      expect(call.modelId, JSON.stringify(call)).toBe("openrouter/x-70b:free");
      expect(call.providerId).toBe("openrouter");
    }
  });

  it("answers in Free mode with nothing at all rather than a paid model when only paid routes exist", async () => {
    const control = new FakeControl();
    const registry = new ProviderRegistry([
      fakeDefinition("paidco", [paid("paidco", "big-405b"), paid("paidco", "other", { free: true })], control),
    ]);
    const catalog = new CatalogService({ registry, resolveDeps: resolveDepsFor(["paidco"]), cacheDir: null });
    await catalog.refresh();
    const provider = new RoutingProvider({
      registry,
      catalog,
      health: new HealthTracker(),
      resolveDeps: resolveDepsFor(["paidco"]),
      policy: () => "free",
      attestations: () => ({ freePlanProviders: new Set(), freeModelPatterns: {} }),
    });
    const agent = new Agent(undefined, undefined, "shelra/free", undefined, {
      cwd: workspace,
      provider,
      interruptionBackoffMs: [0],
    });
    let text = "";
    for await (const chunk of agent.processMessage("Explain the project")) {
      if (chunk.type === "content") text += chunk.content ?? "";
    }
    await agent.generateTitle("Explain the project");
    await agent.askSideQuestion("anything").catch(() => undefined);
    await agent.runTaskRequest({ agent: "explore", description: "d", prompt: "p" });
    expect(control.calls).toEqual([]);
    expect(text).toMatch(/Paused|Limited|free/i);
  });

  it("checks a provider installed by a path that never went through routing, at every call", async () => {
    const control = new FakeControl();
    // A free-plan provider installed directly, as a fallback or a benchmark would.
    const direct = fakeDefinition("groq", [freeTier("groq", "g")], control).createAdapter(
      { providerId: "groq", baseURL: "https://x.invalid", source: "test" },
      { policy: () => "free", entries: () => [] },
    );
    const agent = new Agent(undefined, undefined, "g", undefined, { cwd: workspace, interruptionBackoffMs: [0] });
    agent.setProvider(direct, "g");
    for await (const _chunk of agent.processMessage("hello")) {
      // drain
    }
    await agent.generateTitle("hello");
    expect(control.calls).toEqual([]);

    // The user declared that key free: the same adapter now runs.
    const declared = guardForFreePolicy(direct, {
      policy: () => "free",
      declaredFree: () => new Set(["groq"]),
      billableProviderIds: new Set(["groq"]),
    });
    await declared.generateText({ modelId: "g", system: "s", prompt: "p" });
    expect(control.calls).toHaveLength(1);
  });
});
