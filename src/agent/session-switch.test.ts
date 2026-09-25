import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult } from "../hooks/types";
import type {
  ProviderAdapter,
  ProviderModelRuntime,
  ProviderStream,
  ProviderStreamRequest,
  ProviderTextRequest,
  ProviderTextResult,
  ProviderToolContext,
} from "../providers/types";

/** Saved sessions by id, as the store would read them back. */
const saved: Record<string, Array<{ role: string; content: string }>> = {
  "chat-kart": [
    { role: "user", content: "Build the kart game" },
    { role: "assistant", content: "Wrote src/kart.ts and the track." },
  ],
};

/** Chats saved in another folder: one that still exists, and one that was deleted. */
const elsewhere = mkdtempSync(join(tmpdir(), "shelra-other-project-"));
const folders: Record<string, { workspaceId: string; cwd: string }> = {
  "chat-elsewhere": { workspaceId: "ws-2", cwd: elsewhere },
  "chat-gone": { workspaceId: "ws-3", cwd: join(elsewhere, "deleted-project") },
};
saved["chat-elsewhere"] = [{ role: "user", content: "Fix the API in the other project" }];
saved["chat-gone"] = [{ role: "user", content: "Tune the old prototype" }];

const session = (id: string) => ({
  id,
  workspaceId: folders[id]?.workspaceId ?? "ws-1",
  title: id === "chat-kart" ? "Kart game" : null,
  recap: null,
  model: "primary-model",
  mode: "agent" as const,
  cwdAtStart: folders[id]?.cwd ?? "/tmp/ws",
  cwdLast: folders[id]?.cwd ?? "/tmp/ws",
  status: "active" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
});

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
  loadTranscriptState: vi.fn((id: string) => ({
    messages: saved[id] ?? [],
    seqs: (saved[id] ?? []).map((_, index) => index + 1),
  })),
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
    openSession(selector: string | undefined) {
      if (selector && selector !== "latest" && !saved[selector])
        throw new Error(`Session "${selector}" was not found.`);
      return session(selector ?? "fresh");
    }
    createSession() {
      return session("fresh");
    }
    getSessionById(id: string) {
      return saved[id] ? session(id) : null;
    }
    getRequiredSession(id: string) {
      return session(id);
    }
    setModel() {}
    setMode() {}
    setTitle() {}
    setRecap() {}
    touchSession() {}
  },
}));

const emptyHookResult: AggregatedHookResult = {
  blocked: false,
  blockingErrors: [],
  preventContinuation: false,
  additionalContexts: [],
  results: [],
};
vi.mock("../hooks/index", () => ({
  executeEventHooks: vi.fn(async () => emptyHookResult),
  executePreToolHooks: vi.fn(async () => ({ blocked: false, blockingErrors: [], results: [] })),
  executePostToolHooks: vi.fn(async () => ({})),
  executePostToolFailureHooks: vi.fn(async () => ({})),
}));

import { Agent } from "./agent";

class EchoProvider implements ProviderAdapter {
  readonly id = "switch-test";
  readonly requests: ProviderStreamRequest[] = [];
  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return {
      modelId,
      modelInfo: {
        id: modelId,
        name: modelId,
        contextWindow: 32_768,
        inputPrice: 0,
        outputPrice: 0,
        reasoning: false,
        description: "Test-only provider",
        supportsClientTools: true,
      },
    };
  }
  stream(request: ProviderStreamRequest): ProviderStream {
    this.requests.push(request);
    return {
      events: (async function* () {
        yield { type: "text-delta" as const, text: "Continuing." };
      })(),
      response: Promise.resolve({ messages: [{ role: "assistant", content: "Continuing." }] }),
    };
  }
  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    return { text: "Summary.", modelId: request.modelId };
  }
  getToolContext(): ProviderToolContext {
    return {};
  }
}

describe("continuing a saved session in place (the owner, 2026-09-25)", () => {
  it("brings its transcript back, and the next turn goes on from it", async () => {
    const provider = new EchoProvider();
    const agent = new Agent(undefined, undefined, "primary-model", undefined, {
      provider,
      cwd: mkdtempSync(join(tmpdir(), "shelra-switch-")),
    });
    expect(agent.getSessionId()).toBe("fresh");

    const snapshot = agent.openSavedSession("chat-kart");

    expect(snapshot?.session.id).toBe("chat-kart");
    expect(agent.getSessionId()).toBe("chat-kart");
    for await (const _chunk of agent.processMessage("Now add a boss level")) {
      // drain
    }
    const sent = JSON.stringify(provider.requests[0]?.messages);
    expect(sent).toContain("Build the kart game");
    expect(sent).toContain("Wrote src/kart.ts and the track.");
    expect(sent).toContain("Now add a boss level");
  });

  it("leaves the current session as it was when the id names no saved session", () => {
    const agent = new Agent(undefined, undefined, "primary-model", undefined, {
      provider: new EchoProvider(),
      cwd: mkdtempSync(join(tmpdir(), "shelra-switch-")),
    });
    expect(() => agent.openSavedSession("no-such-chat")).toThrow('Session "no-such-chat" was not found.');
    expect(agent.getSessionId()).toBe("fresh");
  });

  it("sends a chat from another folder there, since its tools would change this one; a chat whose folder is gone continues here", () => {
    const agent = new Agent(undefined, undefined, "primary-model", undefined, {
      provider: new EchoProvider(),
      cwd: mkdtempSync(join(tmpdir(), "shelra-switch-")),
    });

    expect(() => agent.openSavedSession("chat-elsewhere")).toThrow(
      `That chat belongs to ${elsewhere}. Continue it there: cd "${elsewhere}"; shelra -s chat-elsewhere`,
    );
    expect(agent.getSessionId()).toBe("fresh");

    expect(agent.openSavedSession("chat-gone")?.session.id).toBe("chat-gone");
  });
});
