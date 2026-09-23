import { mkdtempSync as makeTestWorkspace } from "node:fs";
import { tmpdir as testTmpdir } from "node:os";
import { join as joinTestPath } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import type { NormalizedLspSettings } from "../lsp/types";
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
import type { AgentMode } from "../types/index";

/**
 * Proof that the lsp tool is opt-in where it counts: in the request a model actually receives. Every
 * registered tool costs schema tokens on every request, and a prompt that names a tool the request
 * does not carry sends the model after a tool that is not there (audit doc 15, P0 item 0.3d).
 */

const { executeEventHooksMock, lspSettingsMock } = vi.hoisted(() => ({
  executeEventHooksMock: vi.fn<(input: HookInput) => Promise<AggregatedHookResult>>(),
  lspSettingsMock: vi.fn<() => NormalizedLspSettings>(),
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
  replaceMessage: vi.fn(),
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
        model: "tool-model",
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
  return { ...actual, loadUserSettings: vi.fn(() => ({})), getCurrentLspSettings: lspSettingsMock };
});

import { normalizeLspSettings } from "../utils/settings";
import { Agent } from "./agent";

/** Agents under test work in a throwaway folder: their memory and workspace scans never touch this repository. */
const testWorkspace = makeTestWorkspace(joinTestPath(testTmpdir(), "shelra-agent-test-"));

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
  readonly defaultModelId = "tool-model";
  lastRequest: ProviderStreamRequest | null = null;

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

async function requestFor(mode: AgentMode): Promise<{ tools: string[]; system: string }> {
  const provider = new CapturingProvider();
  const agent = new Agent(undefined, undefined, "tool-model", undefined, { cwd: testWorkspace, provider });
  agent.setMode(mode);
  for await (const _chunk of agent.processMessage("hello")) {
    // drain
  }
  const request = provider.lastRequest;
  return {
    tools: Object.keys((request?.tools as Record<string, unknown> | undefined) ?? {}),
    system: request?.system ?? "",
  };
}

describe("the lsp tool in the model request", () => {
  beforeEach(() => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    lspSettingsMock.mockReturnValue(normalizeLspSettings(undefined));
    primeCatalog([
      {
        id: "tool-model",
        name: "Tool model",
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

  it("is off by default, while diagnostics after an edit stay on", () => {
    expect(normalizeLspSettings(undefined)).toMatchObject({ enabled: true, tool: false });
    expect(normalizeLspSettings({ tool: true })).toMatchObject({ enabled: true, tool: true });
  });

  for (const mode of ["agent", "plan", "ask"] as const) {
    it(`is neither sent nor named in ${mode} mode unless the settings turn it on`, async () => {
      const off = await requestFor(mode);
      expect(off.tools).toContain("read_file");
      expect(off.tools).not.toContain("lsp");
      expect(off.system).not.toMatch(/\blsp\b/);

      lspSettingsMock.mockReturnValue(normalizeLspSettings({ tool: true }));
      const on = await requestFor(mode);
      expect(on.tools).toContain("lsp");
      expect(on.system).toMatch(/\blsp\b/);
    });
  }
});
