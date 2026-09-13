import { describe, expect, it, vi } from "vitest";

const testMocks = vi.hoisted(() => {
  const generateRecap = vi.fn();
  const storage = {
    appendCompaction: vi.fn(),
    appendMessages: vi.fn(() => []),
    appendSystemMessage: vi.fn(() => 0),
    buildChatEntries: vi.fn(() => [
      {
        type: "user",
        content: "Summarize this session.",
        timestamp: new Date("2026-04-22T15:00:00.000Z"),
      },
    ]),
    getNextMessageSequence: vi.fn(() => 0),
    getSessionTotalTokens: vi.fn(() => 0),
    loadTranscript: vi.fn(() => []),
    loadTranscriptState: vi.fn(() => ({ messages: [], seqs: [] })),
    recordUsageEvent: vi.fn(),
    SessionStore: class {
      getWorkspace() {
        return null;
      }
      openSession() {
        return null;
      }
      createSession() {
        return null;
      }
      setModel() {}
      getRequiredSession() {
        return null;
      }
      setMode() {}
      touchSession() {}
    },
  };
  return { generateRecap, storage };
});

vi.mock("../providers/auxiliary", async () => {
  const actual = await vi.importActual<typeof import("../providers/auxiliary")>("../providers/auxiliary");
  return { ...actual, generateRecap: testMocks.generateRecap };
});

vi.mock("../storage/index", () => testMocks.storage);

import { Agent } from "./agent";

function makeSession() {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    title: null,
    recap: null,
    model: "local-test-model",
    mode: "agent",
    cwdAtStart: process.cwd(),
    cwdLast: process.cwd(),
    status: "active",
    createdAt: new Date("2026-04-22T15:00:00.000Z"),
    updatedAt: new Date("2026-04-22T15:00:00.000Z"),
  };
}

describe("Agent session recap", () => {
  it("does not throw when persisting a generated recap fails", async () => {
    testMocks.generateRecap.mockReset().mockResolvedValue({
      recap: "Recovered the latest session state.",
      modelId: "local-test-model",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    });
    const agent = new Agent(undefined, undefined, undefined, undefined, { persistSession: false });
    const session = makeSession();
    const sessionStore = {
      setRecap: vi.fn(() => {
        throw new Error("database is unavailable");
      }),
      getRequiredSession: vi.fn(() => session),
    };

    Object.assign(agent as object, { provider: {}, session, sessionStore });

    await expect(
      (agent as unknown as { refreshSessionRecap: (signal?: AbortSignal) => Promise<void> }).refreshSessionRecap(),
    ).resolves.toBeUndefined();

    expect(testMocks.generateRecap).toHaveBeenCalled();
    expect(sessionStore.setRecap).toHaveBeenCalled();
  });

  it("skips recap generation when recaps are disabled", async () => {
    testMocks.generateRecap.mockReset().mockResolvedValue({
      recap: "Should not be generated.",
      modelId: "local-test-model",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    });
    const agent = new Agent(undefined, undefined, undefined, undefined, { persistSession: false });
    const session = makeSession();
    const sessionStore = {
      setRecap: vi.fn(),
      getRequiredSession: vi.fn(() => session),
    };

    agent.setRecapsEnabled(false);
    Object.assign(agent as object, { provider: {}, session, sessionStore });

    await (agent as unknown as { refreshSessionRecap: (signal?: AbortSignal) => Promise<void> }).refreshSessionRecap();

    expect(testMocks.generateRecap).not.toHaveBeenCalled();
    expect(sessionStore.setRecap).not.toHaveBeenCalled();
  });
});
