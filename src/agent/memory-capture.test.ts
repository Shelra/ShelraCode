import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APICallError } from "@ai-sdk/provider";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import { pendingReflectionCount, queuePendingReflection, readEpisodes, saveLiveEpisode } from "../memory/episodes";
import {
  listMemoryRecords,
  projectMemoryScope,
  readReflectionAudit,
  userMemoryScope,
  writeMemoryEntry,
} from "../memory/store";
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
import type { BashTool } from "../tools/bash";

/**
 * Memory v2, M1 (docs/architecture/18-MEMORY-V2.md §2.1): a turn that ends any way other than a clean answer still
 * did work, and before this it left nothing in memory. Seen live 2026-09-24: a 25-minute game turn ended Limited and
 * its failures, its files and its lessons were all lost. These tests pin the capture on every outcome.
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
        model: "primary-model",
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

/** Temp folders this file made; removed when it ends, so test stores do not pile up (doc 18 §2.3). */
const made: string[] = [];
function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Round {
  events: ProviderEvent[];
  fail?: unknown;
  text?: string;
  /** Runs once the agent has taken every event of the round, before the round ends: a look at the turn mid-way. */
  during?: () => void;
}

/** Plays one scripted round per model request (the last repeats) and answers reflection calls from a queue. */
class ScriptedProvider implements ProviderAdapter {
  readonly id: string = "memory-capture-test";
  readonly defaultModelId = "primary-model";
  readonly requests: ProviderStreamRequest[] = [];
  readonly reflections: ProviderTextRequest[] = [];

  constructor(
    private readonly rounds: Round[],
    private readonly reflectionReplies: Array<string | Error> = [],
  ) {}

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
        supportsMaxOutputTokens: true,
        runtimeKind: "managed-llama",
      },
    };
  }

  fallbackModelIds(): string[] {
    return [];
  }

  stream(request: ProviderStreamRequest): ProviderStream {
    this.requests.push(request);
    const round = this.rounds[this.requests.length - 1] ?? (this.rounds.at(-1) as Round);
    return {
      events: (async function* () {
        yield* round.events;
        round.during?.();
      })(),
      response:
        round.fail !== undefined
          ? Promise.reject(round.fail)
          : Promise.resolve({ messages: [{ role: "assistant", content: round.text ?? "Done." }] }),
    };
  }

  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    // Reflection calls say so in their system prompt; everything else (titles, recaps) gets a plain answer.
    if (!/memor/iu.test(request.system)) return { text: "Summary.", modelId: request.modelId };
    this.reflections.push(request);
    const reply = this.reflectionReplies.shift() ?? '{"memories":[]}';
    if (reply instanceof Error) throw reply;
    return { text: reply, modelId: request.modelId };
  }

  getToolContext(): ProviderToolContext {
    return {};
  }
}

const emptyHookResult: AggregatedHookResult = {
  blocked: false,
  blockingErrors: [],
  preventContinuation: false,
  additionalContexts: [],
  results: [],
};

let callCounter = 0;
/** A bash call and its result, as the provider stream reports them. */
function bashStep(command: string, success: boolean, output: string): ProviderEvent[] {
  callCounter += 1;
  const toolCall = {
    id: `call-${callCounter}`,
    type: "function" as const,
    function: { name: "bash", arguments: JSON.stringify({ command }) },
  };
  return [
    { type: "tool-call", toolCall },
    {
      type: "tool-result",
      toolCall,
      output: success ? { success: true, output } : { success: false, error: output },
    },
  ];
}

function quotaSpent(): APICallError {
  return new APICallError({
    message: "Rate limit exceeded: free-models-per-day",
    url: "https://example.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 429,
    responseBody: '{"error":{"message":"Rate limit exceeded: free-models-per-day","code":429}}',
  });
}

function agentIn(workspace: string, provider: ScriptedProvider): Agent {
  executeEventHooksMock.mockResolvedValue(emptyHookResult);
  return new Agent(undefined, undefined, "primary-model", undefined, {
    cwd: workspace,
    provider,
    interruptionBackoffMs: [0],
  });
}

async function turn(agent: Agent, message: string): Promise<string> {
  let text = "";
  for await (const chunk of agent.processMessage(message)) {
    if (chunk.type === "content") text += chunk.content ?? "";
  }
  return text;
}

/** The failing install, then the one that worked, then the quota runs out mid-turn. */
const limitedRound: Round = {
  events: [
    ...bashStep("npm install", false, "npm ERR! code ENOENT: package.json not found"),
    ...bashStep("bun install", true, "installed 3 packages"),
    ...Array.from({ length: 6 }, (_, index) => bashStep(`ls src/part-${index}`, true, "a.ts")).flat(),
  ],
  fail: quotaSpent(),
};

describe("memory capture on every outcome (doc 18, M1)", () => {
  it("records a turn that ended Limited: its episode, its failure lesson and a deferred reflection", async () => {
    const workspace = scratch("shelra-memory-capture-");
    const provider = new ScriptedProvider([limitedRound]);
    const text = await turn(agentIn(workspace, provider), "Set up the project and build the level loader");

    expect(text).toContain("[Limited — ");
    const scope = projectMemoryScope(workspace);
    const [episode] = readEpisodes(scope);
    expect(episode).toMatchObject({ outcome: "limited", request: "Set up the project and build the level loader" });
    expect(episode?.toolCalls).toBe(8);
    expect(episode?.failures[0]).toMatchObject({ command: "npm install", fixedBy: "bun install" });
    // The lesson that needs no model is kept now.
    const lessons = listMemoryRecords(scope).filter((record) => record.entry.frontmatter.metadata.type === "failure");
    expect(lessons).toHaveLength(1);
    expect(lessons[0]?.entry.body).toContain("bun install");
    // The reflection waits for a model that answers.
    expect(pendingReflectionCount(scope)).toBe(1);
    expect(provider.reflections).toHaveLength(0);
    expect(readReflectionAudit(scope).at(-1)?.reason).toContain("ended limited");
  });

  it("runs the deferred reflection on the next turn a model answers, and empties the queue", async () => {
    const workspace = scratch("shelra-memory-drain-");
    const lesson = JSON.stringify({
      memories: [
        {
          type: "conventions",
          slug: "bun-not-npm",
          title: "Bun, not npm",
          hook: "this project installs with bun",
          description: "npm install fails here: there is no package.json at the root",
          body: "Install with `bun install`; `npm install` fails with ENOENT because the root has no package.json.",
          confidence: 0.8,
        },
      ],
    });
    const provider = new ScriptedProvider(
      [
        limitedRound,
        {
          events: [...bashStep("bun test", false, "1 fail"), ...bashStep("bun test", true, "4 pass")],
          text: "Fixed.",
        },
      ],
      ['{"memories":[]}', lesson],
    );
    const agent = agentIn(workspace, provider);
    await turn(agent, "Set up the project and build the level loader");
    const scope = projectMemoryScope(workspace);
    expect(pendingReflectionCount(scope)).toBe(1);

    await turn(agent, "Make the loader tests pass");

    // One reflection for this turn, one for the turn the quota cut.
    expect(provider.reflections).toHaveLength(2);
    expect(provider.reflections[1]?.prompt).toContain("Set up the project and build the level loader");
    expect(pendingReflectionCount(scope)).toBe(0);
    expect(listMemoryRecords(scope).map((record) => record.slug)).toContain("bun-not-npm");
  });

  it("keeps a reflection the model could not run for a later turn instead of losing it", async () => {
    const workspace = scratch("shelra-memory-requeue-");
    const provider = new ScriptedProvider(
      [
        {
          events: [...bashStep("bun test", false, "1 fail"), ...bashStep("bun test", true, "4 pass")],
          text: "Fixed.",
        },
      ],
      [new Error("429 Too Many Requests")],
    );
    await turn(agentIn(workspace, provider), "Make the loader tests pass");

    expect(provider.reflections.length).toBeGreaterThan(0);
    expect(pendingReflectionCount(projectMemoryScope(workspace))).toBe(1);
  });

  it("keeps what the host saw of a turn a Stop hook refused, and lets no model infer anything from it", async () => {
    const workspace = scratch("shelra-memory-withheld-");
    const provider = new ScriptedProvider([{ events: limitedRound.events, text: "Done." }]);
    const agent = agentIn(workspace, provider);
    executeEventHooksMock.mockImplementation(async (input) =>
      input.hook_event_name === "Stop"
        ? {
            ...emptyHookResult,
            blocked: true,
            blockingErrors: [{ command: "check-release-notes", stderr: "Release notes missing." }],
          }
        : emptyHookResult,
    );
    try {
      const text = await turn(agent, "Set up the project and build the level loader");

      expect(text).toContain("[Not marked complete — Release notes missing.]");
      const scope = projectMemoryScope(workspace);
      expect(readEpisodes(scope)[0]?.outcome).toBe("blocked");
      expect(listMemoryRecords(scope).some((record) => record.entry.body.includes("bun install"))).toBe(true);
      expect(pendingReflectionCount(scope)).toBe(0);
      expect(provider.reflections).toHaveLength(0);
      expect(readReflectionAudit(scope).at(-1)?.reason).toContain("no reflection on this exit");
    } finally {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
    }
  });

  it("keeps memory in the session's root folder after the shell moved into a subfolder", async () => {
    const workspace = scratch("shelra-memory-root-");
    mkdirSync(join(workspace, "packages", "web"), { recursive: true });
    const agent = agentIn(workspace, new ScriptedProvider([{ events: [], text: "Noted." }]));
    await (agent as unknown as { bash: BashTool }).bash.execute("cd packages/web");

    await turn(agent, "Always run the linter before committing.");

    expect(listMemoryRecords(projectMemoryScope(workspace)).map((record) => record.index.hook)).toContain(
      "Always run the linter before committing",
    );
    expect(existsSync(join(workspace, "packages", "web", ".shelra"))).toBe(false);
    const audit = readReflectionAudit(projectMemoryScope(workspace));
    expect(audit.some((record) => record.reason === "the user's own words")).toBe(true);
  });

  it("keeps a preference about how Shelra talks to this person in the user-wide store", async () => {
    const workspace = scratch("shelra-memory-user-");
    const previous = process.env.SHELRA_USER_MEMORY_ROOT;
    process.env.SHELRA_USER_MEMORY_ROOT = scratch("shelra-memory-home-");
    try {
      await turn(
        agentIn(workspace, new ScriptedProvider([{ events: [], text: "Entendido." }])),
        "Always answer in Spanish.",
      );
      expect(listMemoryRecords(userMemoryScope()).map((record) => record.index.hook)).toEqual([
        "Always answer in Spanish",
      ]);
      expect(listMemoryRecords(projectMemoryScope(workspace))).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.SHELRA_USER_MEMORY_ROOT;
      else process.env.SHELRA_USER_MEMORY_ROOT = previous;
    }
  });

  it("gives a short follow-up the memory the request before it needed (doc 18 R2)", async () => {
    const workspace = scratch("shelra-memory-follow-up-");
    writeMemoryEntry(projectMemoryScope(workspace), {
      slug: "login-flaky-test",
      title: "The login test is flaky",
      hook: "tests/login.spec.ts fails one run in five on a race with the session cookie",
      type: "known-problems",
      description: "Why the login test fails at random",
      body: "Await `page.waitForResponse('/api/session')` before asserting; the cookie arrives after the redirect.",
      source: "observed",
      confidence: 0.9,
    });
    const agent = agentIn(workspace, new ScriptedProvider([{ events: [], text: "On it." }]));
    const recalled: string[][] = [];
    for (const message of ["fix the flaky login test", "sí, hazlo"]) {
      for await (const _chunk of agent.processMessage(message, {
        onMemoryRecall: (info) => recalled.push(info.entries.map((entry) => entry.slug)),
      })) {
        // drain
      }
    }
    expect(recalled).toEqual([["login-flaky-test"], ["login-flaky-test"]]);
    expect(agent.getLastMemoryContext()?.expanded).toEqual(["login-flaky-test"]);
  });

  it("shows the next similar request what failed last time and what worked (doc 18 M4)", async () => {
    const workspace = scratch("shelra-memory-lesson-");
    const provider = new ScriptedProvider([limitedRound, { events: [], text: "On it." }]);
    const agent = agentIn(workspace, provider);
    await turn(agent, "Set up the project and build the level loader");

    await turn(agent, "build the level loader again, it still does not load level 2");

    const system = String(provider.requests.at(-1)?.system ?? "");
    expect(system).toContain("Past attempts at similar requests in this project");
    expect(system).toContain('"Set up the project and build the level loader"');
    expect(system).toContain("worked: `bun install`");
    expect(agent.getLastMemoryContext()?.episodes).toHaveLength(1);
  });

  it("keeps a chain of follow-ups on the request they carry on (review round 2)", async () => {
    const workspace = scratch("shelra-memory-chain-");
    writeMemoryEntry(projectMemoryScope(workspace), {
      slug: "login-flaky-test",
      title: "The login test is flaky",
      hook: "tests/login.spec.ts fails one run in five on a race with the session cookie",
      type: "known-problems",
      description: "Why the login test fails at random",
      body: "Await `page.waitForResponse('/api/session')` before asserting; the cookie arrives after the redirect.",
      source: "observed",
      confidence: 0.9,
    });
    const agent = agentIn(workspace, new ScriptedProvider([{ events: [], text: "On it." }]));
    const recalled: string[][] = [];
    for (const message of ["fix the flaky login test", "sí, hazlo", "dale, sigue"]) {
      for await (const _chunk of agent.processMessage(message, {
        onMemoryRecall: (info) =>
          recalled.push(info.entries.filter((entry) => entry.tier === "knowledge").map((entry) => entry.slug)),
      })) {
        // drain
      }
    }
    expect(recalled).toEqual([["login-flaky-test"], ["login-flaky-test"], ["login-flaky-test"]]);
  });

  it("records a turn that ended in an error as one, and defers its reflection (review round 2)", async () => {
    const workspace = scratch("shelra-memory-error-");
    const rejected = new APICallError({
      message: "Invalid API Key",
      url: "https://example.test/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 401,
      responseBody: '{"error":{"message":"Invalid API Key"}}',
    });
    const provider = new ScriptedProvider([
      { events: [...bashStep("bun test", false, "1 fail"), ...bashStep("bun test", true, "4 pass")], fail: rejected },
    ]);
    await turn(agentIn(workspace, provider), "Make the loader tests pass");

    const scope = projectMemoryScope(workspace);
    expect(readEpisodes(scope)[0]?.outcome).toBe("error");
    expect(pendingReflectionCount(scope)).toBe(1);
  });

  it("never holds a turn that reflected nothing for an old reflection, and drops one that keeps failing", async () => {
    const workspace = scratch("shelra-memory-drain-bounds-");
    const scope = projectMemoryScope(workspace);
    const old = {
      userMessage: "Build the level loader",
      assistantText: "Wrote it.",
      changedFiles: ["src/loader.ts"],
      commands: [
        { command: "npm test", success: false, output: "missing script" },
        { command: "bun test", success: true, output: "4 pass" },
      ],
      verified: true,
      toolCalls: 9,
    };
    queuePendingReflection(scope, old, "limited", 2);
    const provider = new ScriptedProvider(
      [
        { events: [{ type: "text-delta", text: "Hello." }], text: "Hello." },
        { events: [...bashStep("bun test", false, "1 fail"), ...bashStep("bun test", true, "4 pass")], text: "Fixed." },
      ],
      ['{"memories":[]}', new Error("429 Too Many Requests")],
    );
    const agent = agentIn(workspace, provider);

    await turn(agent, "Hi there");
    expect(provider.reflections).toHaveLength(0);
    expect(pendingReflectionCount(scope)).toBe(1);

    await turn(agent, "Make the loader tests pass");
    expect(provider.reflections).toHaveLength(2);
    expect(pendingReflectionCount(scope)).toBe(0);
    expect(readReflectionAudit(scope).at(-1)?.reason).toContain("dropped after 3 failed attempts");
  });

  it("gives a reminder once, on the request that brings up its cue (doc 18 §4.6)", async () => {
    const workspace = scratch("shelra-memory-reminder-");
    const provider = new ScriptedProvider([{ events: [{ type: "text-delta", text: "Ok." }], text: "Ok." }]);
    const agent = agentIn(workspace, provider);
    const systemFor = async (message: string) => {
      await turn(agent, message);
      return String(provider.requests.at(-1)?.system ?? "");
    };

    await systemFor("Recuérdame actualizar el changelog la próxima vez que toquemos el release.");
    expect(await systemFor("arregla el test del login")).not.toContain("Actualizar el changelog");
    const cued = await systemFor("prepara el release de la versión 2.3");
    expect(cued).toContain("Reminders the user asked for, due now (tell the user):");
    expect(cued).toContain("- Actualizar el changelog (when toquemos el release)");
    expect(await systemFor("prepara el release otra vez")).not.toContain("Actualizar el changelog");
  });

  it("keeps a due reminder when no model answered the turn, and never logs the request (review round 3)", async () => {
    const workspace = scratch("shelra-memory-reminder-limited-");
    const answer = { events: [{ type: "text-delta" as const, text: "Ok." }], text: "Ok." };
    const provider = new ScriptedProvider([answer, { events: [], fail: quotaSpent() }, answer]);
    const agent = agentIn(workspace, provider);
    const systemFor = async (message: string) => {
      await turn(agent, message);
      return String(provider.requests.at(-1)?.system ?? "");
    };

    await systemFor("Remind me to rotate the staging key when we deploy.");
    // The deploy turn is cut Limited: nobody saw the reminder, so it stays.
    await systemFor("deploy the app to staging with sk-or-v1-0123456789abcdef0123456789abcdef");
    expect(await systemFor("deploy the app to staging again")).toContain("- Rotate the staging key (when we deploy)");
    const history = readFileSync(join(workspace, ".shelra", "memory", "history.jsonl"), "utf8");
    expect(history).toContain('"event":"delivered"');
    expect(history).not.toContain("0123456789abcdef");
    expect(history).not.toContain("deploy the app");
  });

  it("takes a reminder's cue from the conversation when it only points at it (review round 3)", async () => {
    const workspace = scratch("shelra-memory-reminder-context-");
    const provider = new ScriptedProvider([{ events: [{ type: "text-delta", text: "Ok." }], text: "Ok." }]);
    const agent = agentIn(workspace, provider);
    const systemFor = async (message: string) => {
      await turn(agent, message);
      return String(provider.requests.at(-1)?.system ?? "");
    };

    await systemFor("refactor the billing export to stream rows");
    await systemFor("Remind me to update the docs when we work on it again.");
    expect(await systemFor("rename the helper in utils.ts")).not.toContain("Update the docs");
    expect(await systemFor("the billing export times out on big months")).toContain("- Update the docs");
  });

  it("records nothing for a turn that only answered", async () => {
    const workspace = scratch("shelra-memory-chat-");
    await turn(agentIn(workspace, new ScriptedProvider([{ events: [], text: "Hello." }])), "Hi there");
    expect(readEpisodes(projectMemoryScope(workspace))).toEqual([]);
    expect(existsSync(join(workspace, ".shelra", "memory", "pending-reflections.jsonl"))).toBe(false);
  });
});

describe("memory kept while a turn works (doc 18 §4.2a)", () => {
  const liveDir = (workspace: string) => join(workspace, ".shelra", "memory", "live");

  it("saves the turn in progress and the lesson of a failure it got past before the turn ends", async () => {
    // Seen live 2026-09-25: a 48-minute turn of 292 tool calls wrote nothing to memory until the user cancelled it.
    const workspace = scratch("shelra-memory-live-");
    const scope = projectMemoryScope(workspace);
    const midway: { saved: string[]; lessons: string[] } = { saved: [], lessons: [] };
    const provider = new ScriptedProvider([
      {
        events: [
          ...bashStep("bun test", false, "error: Cannot find module 'zod'"),
          ...bashStep("bun install", true, "3 packages installed"),
          ...bashStep("bun test", true, "4 pass"),
          { type: "text-delta", text: "Installed the missing dependency; the tests pass." },
        ],
        during: () => {
          midway.saved = existsSync(liveDir(workspace)) ? readdirSync(liveDir(workspace)) : [];
          midway.lessons = listMemoryRecords(scope)
            .filter((record) => record.entry.frontmatter.metadata.type === "failure")
            .map((record) => record.index.title);
        },
        text: "Installed the missing dependency; the tests pass.",
      },
    ]);
    const kept: string[] = [];
    const agent = agentIn(workspace, provider);
    for await (const _chunk of agent.processMessage("Make the tests pass", {
      onMemory: (info) => kept.push(info.reason),
    })) {
      // drain
    }

    expect(midway.saved).toHaveLength(1);
    expect(midway.lessons).toEqual(["bun test failed until bun install"]);
    expect(kept).toContain("a failure the turn got past, kept as it happened");
    // Once the turn wrote its episode, its save is gone.
    expect(existsSync(liveDir(workspace)) ? readdirSync(liveDir(workspace)) : []).toEqual([]);
    expect(readEpisodes(scope)).toHaveLength(1);
  });

  it("records a turn whose process ended mid-way as interrupted, from its last save, when the next turn starts", async () => {
    const workspace = scratch("shelra-memory-interrupted-");
    const scope = projectMemoryScope(workspace);
    saveLiveEpisode(scope, "crashed-session", {
      userMessage: "Build the level loader",
      assistantText: "Writing the loader.",
      changedFiles: ["src/loader.ts"],
      commands: [],
      verified: false,
      toolCalls: 14,
    });
    // The save of a process that no longer runs.
    const [file] = readdirSync(liveDir(workspace));
    const path = join(liveDir(workspace), file ?? "");
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), pid: 2_147_483_000 }));

    await turn(agentIn(workspace, new ScriptedProvider([{ events: [], text: "Hello." }])), "Hi there");

    const [episode] = readEpisodes(scope);
    expect(episode).toMatchObject({
      outcome: "interrupted",
      request: "Build the level loader",
      files: ["src/loader.ts"],
      toolCalls: 14,
    });
    expect(existsSync(path)).toBe(false);
  });
});
