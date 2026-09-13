import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import { projectMemoryScope, writeMemoryEntry } from "../memory/store";
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
 * End-to-end proof for §14 Phase 2 item 4 (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md):
 * the project memory index is injected into every turn's system prompt automatically — mirroring
 * how AGENTS.md/custom instructions already are — rather than depending on the model remembering
 * to call the `memory_list` tool itself.
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
        model: "gate-test-model",
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

import { Agent } from "./agent";

const emptyHookResult: AggregatedHookResult = {
  blocked: false,
  blockingErrors: [],
  preventContinuation: false,
  additionalContexts: [],
  results: [],
};

class CapturingProvider implements ProviderAdapter {
  readonly id = "memory-context-test";
  readonly defaultModelId = "gate-test-model";
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

describe("automatic project memory consultation", () => {
  const originalCwd = process.cwd();
  const tempDirs: string[] = [];

  afterEach(async () => {
    process.chdir(originalCwd);
    executeEventHooksMock.mockReset();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("injects the saved memory index into the system prompt automatically", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const cwd = await mkdtemp(path.join(os.tmpdir(), "agent-memory-context-"));
    tempDirs.push(cwd);
    writeMemoryEntry(projectMemoryScope(cwd), {
      slug: "better-auth-org-plugin",
      title: "Better Auth organization plugin",
      hook: "Use it for multi-tenancy instead of hand-rolling memberships",
      type: "architecture",
      description: "Research notes",
      body: "Details.",
    });

    process.chdir(cwd);
    const provider = new CapturingProvider();
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider });

    for await (const _chunk of agent.processMessage("Fix any remaining issues in the code")) {
      // drain
    }

    expect(provider.lastRequest?.system).toContain("PROJECT MEMORY:");
    expect(provider.lastRequest?.system).toContain("Better Auth organization plugin");
    expect(provider.lastRequest?.system).toContain("Use it for multi-tenancy instead of hand-rolling memberships");
  });

  it("adds nothing when the project has no saved memory yet", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const cwd = await mkdtemp(path.join(os.tmpdir(), "agent-memory-context-empty-"));
    tempDirs.push(cwd);

    process.chdir(cwd);
    const provider = new CapturingProvider();
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider });

    for await (const _chunk of agent.processMessage("Fix any remaining issues in the code")) {
      // drain
    }

    expect(provider.lastRequest?.system).not.toContain("PROJECT MEMORY:");
  });
});
