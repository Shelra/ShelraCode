import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import { clearCatalog, primeCatalog } from "../models/catalog";
import type {
  ProviderAdapter,
  ProviderEvent,
  ProviderModelRuntime,
  ProviderStream,
  ProviderStreamRequest,
  ProviderTextRequest,
  ProviderTextResult,
  ProviderToolContext,
} from "../providers/types";

/**
 * Proof that `/effort` and the "high in agent mode" default (docs/architecture/
 * 14-AGENT-HARNESS-RECONSTRUCTION.md §11) actually reach the request the model sees — not just
 * the `resolveReasoningEffort` method in isolation. Before this, `reasoningEffort` was declared
 * on `ProviderModelRuntime`/`ProviderToolContext` but nothing ever read it for OpenRouter: the
 * `/models` picker's arrow-key control saved a value nobody sent to the API.
 */

const { executeEventHooksMock, loadUserSettingsMock } = vi.hoisted(() => ({
  executeEventHooksMock: vi.fn<(input: HookInput) => Promise<AggregatedHookResult>>(),
  loadUserSettingsMock: vi.fn<() => Record<string, unknown>>(() => ({})),
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
        model: "reasoning-model",
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

vi.mock("../hooks/index", () => ({
  executeEventHooks: executeEventHooksMock,
}));

vi.mock("../utils/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/settings")>();
  return { ...actual, loadUserSettings: loadUserSettingsMock };
});

import { Agent } from "./agent";

const emptyHookResult: AggregatedHookResult = {
  blocked: false,
  blockingErrors: [],
  preventContinuation: false,
  additionalContexts: [],
  results: [],
};

/** Captures the request handed to `stream()` and replies with a trivial, non-coding turn. */
class CapturingProvider implements ProviderAdapter {
  readonly id = "capture-test";
  readonly defaultModelId: string;
  lastRequest: ProviderStreamRequest | null = null;

  constructor(defaultModelId: string) {
    this.defaultModelId = defaultModelId;
  }

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return { modelId };
  }

  stream(request: ProviderStreamRequest): ProviderStream {
    this.lastRequest = request;
    const events: ProviderEvent[] = [{ type: "text-delta", text: "Hi there." }];
    return {
      events: (async function* () {
        yield* events;
      })(),
      response: Promise.resolve({ messages: [{ role: "assistant", content: "Hi there." }] }),
    };
  }

  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    return { text: "Summary.", modelId: request.modelId };
  }

  getToolContext(): ProviderToolContext {
    return {};
  }
}

describe("reasoning effort", () => {
  beforeEach(() => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    loadUserSettingsMock.mockReturnValue({});
    primeCatalog([
      {
        id: "reasoning-model",
        name: "Reasoning model",
        contextWindow: 128_000,
        inputPrice: 0,
        outputPrice: 0,
        reasoning: true,
        supportsReasoningEffort: true,
        description: "test",
        supportsClientTools: true,
        supportsMaxOutputTokens: true,
        category: "cloud",
        provider: "openrouter",
      },
      {
        id: "plain-model",
        name: "Plain model",
        contextWindow: 128_000,
        inputPrice: 0,
        outputPrice: 0,
        reasoning: false,
        description: "test",
        supportsClientTools: true,
        supportsMaxOutputTokens: true,
        category: "cloud",
        provider: "openrouter",
      },
    ]);
  });

  afterEach(() => clearCatalog());

  it("defaults to high in agent mode when the model supports reasoning effort", () => {
    const agent = new Agent(undefined, undefined, "reasoning-model", undefined, {
      provider: new CapturingProvider("reasoning-model"),
    });
    expect(agent.resolveReasoningEffort()).toBe("high");
  });

  it("sends no explicit effort for a model that doesn't support it", () => {
    const agent = new Agent(undefined, undefined, "plain-model", undefined, {
      provider: new CapturingProvider("plain-model"),
    });
    expect(agent.resolveReasoningEffort()).toBeUndefined();
  });

  it("leaves reasoning effort to the provider's own default outside agent mode", () => {
    const agent = new Agent(undefined, undefined, "reasoning-model", undefined, {
      provider: new CapturingProvider("reasoning-model"),
    });
    agent.setMode("plan");
    expect(agent.resolveReasoningEffort()).toBeUndefined();
  });

  it("honors an explicit /effort override over the agent-mode default", () => {
    const agent = new Agent(undefined, undefined, "reasoning-model", undefined, {
      provider: new CapturingProvider("reasoning-model"),
    });
    agent.setReasoningEffort("low");
    expect(agent.getReasoningEffort()).toBe("low");
    expect(agent.resolveReasoningEffort()).toBe("low");
  });

  it("ignores an override the current model does not actually support", () => {
    const agent = new Agent(undefined, undefined, "plain-model", undefined, {
      provider: new CapturingProvider("plain-model"),
    });
    agent.setReasoningEffort("high");
    expect(agent.resolveReasoningEffort()).toBeUndefined();
  });

  it("restores the automatic default when the override is cleared", () => {
    const agent = new Agent(undefined, undefined, "reasoning-model", undefined, {
      provider: new CapturingProvider("reasoning-model"),
    });
    agent.setReasoningEffort("low");
    agent.setReasoningEffort(null);
    expect(agent.getReasoningEffort()).toBeNull();
    expect(agent.resolveReasoningEffort()).toBe("high");
  });

  it("honors the /models picker's per-model setting when there is no session-wide /effort override (§14 Phase 2 item 2)", () => {
    loadUserSettingsMock.mockReturnValue({ reasoningEffortByModel: { "reasoning-model": "low" } });
    const agent = new Agent(undefined, undefined, "reasoning-model", undefined, {
      provider: new CapturingProvider("reasoning-model"),
    });
    expect(agent.resolveReasoningEffort()).toBe("low");
  });

  it("prefers an explicit /effort override over the /models per-model setting", () => {
    loadUserSettingsMock.mockReturnValue({ reasoningEffortByModel: { "reasoning-model": "low" } });
    const agent = new Agent(undefined, undefined, "reasoning-model", undefined, {
      provider: new CapturingProvider("reasoning-model"),
    });
    agent.setReasoningEffort("medium");
    expect(agent.resolveReasoningEffort()).toBe("medium");
  });

  it("ignores a /models per-model setting for a different model", () => {
    loadUserSettingsMock.mockReturnValue({ reasoningEffortByModel: { "some-other-model": "low" } });
    const agent = new Agent(undefined, undefined, "reasoning-model", undefined, {
      provider: new CapturingProvider("reasoning-model"),
    });
    expect(agent.resolveReasoningEffort()).toBe("high");
  });

  it("actually reaches the provider's stream request for a real turn — not just the resolver", async () => {
    const provider = new CapturingProvider("reasoning-model");
    const agent = new Agent(undefined, undefined, "reasoning-model", undefined, { provider });

    for await (const _chunk of agent.processMessage("hello")) {
      // drain
    }

    expect(provider.lastRequest?.reasoningEffort).toBe("high");
  });

  it("sends nothing for a model the catalog says does not support reasoning effort", async () => {
    const provider = new CapturingProvider("plain-model");
    const agent = new Agent(undefined, undefined, "plain-model", undefined, { provider });

    for await (const _chunk of agent.processMessage("hello")) {
      // drain
    }

    expect(provider.lastRequest?.reasoningEffort).toBeUndefined();
  });
});
