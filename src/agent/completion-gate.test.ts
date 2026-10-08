import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ContractCheckRunner } from "../contract/contract";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import { approveDecision, proposeDecision } from "../ledger/store";
import { readEpisodes } from "../memory/episodes";
import { listMemoryRecords, projectMemoryScope, writeMemoryEntry } from "../memory/store";
import { clearCatalog, primeCatalog } from "../models/catalog";
import type {
  HostStopStep,
  ProviderAdapter,
  ProviderEvent,
  ProviderModelRuntime,
  ProviderStream,
  ProviderStreamRequest,
  ProviderTextRequest,
  ProviderTextResult,
  ProviderToolContext,
} from "../providers/types";
import { listTraces, readTrace } from "../utils/session-trace";

/** Whether Playwright's Chromium is installed, for the tests that open an app in it. */
let hasChromium = false;
try {
  const playwright = await import("playwright");
  hasChromium = existsSync(playwright.chromium.executablePath());
} catch {
  hasChromium = false;
}

/** Agents under test work in a throwaway folder: their memory and workspace scans never touch this repository. */
const testWorkspace = mkdtempSync(join(tmpdir(), "shelra-agent-test-"));

/**
 * Behavioral proof for the completion/verification gate
 * (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §9), added after reproducing the failure
 * live on 2026-09-13: a headless coding turn published a plan with acceptance criteria, wrote
 * files, re-read its own source, and reported "Done." having never made a single
 * verification-shaped tool call. `describeVerificationEvidence` in agent.ts deliberately does
 * NOT count `read_file`/`bash ls`-style inspection as evidence — only things that touch reality
 * (a real request, a test/build run, a rendered-output observation) count.
 */

const { upsertObjectiveIndex, executeEventHooksMock } = vi.hoisted(() => ({
  upsertObjectiveIndex: vi.fn(),
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
  replaceMessage: vi.fn(),
  upsertObjectiveIndex,
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
  // Tools that really execute in a test (restore_file below) run the tool hooks; there are none here.
  executePreToolHooks: vi.fn(async () => ({ blocked: false, blockingErrors: [], results: [] })),
  executePostToolHooks: vi.fn(async () => ({})),
  executePostToolFailureHooks: vi.fn(async () => ({})),
}));

import { Agent } from "./agent";

const emptyHookResult: AggregatedHookResult = {
  blocked: false,
  blockingErrors: [],
  preventContinuation: false,
  additionalContexts: [],
  results: [],
};

const PLAN_TOOL_RESULT = {
  success: true,
  output: "Plan: Digital clock",
  plan: {
    title: "Digital clock",
    summary: "Build it",
    goal: "A clock that ticks",
    requirements: ["Ticks every second"],
    acceptanceCriteria: [
      { id: "AC1", description: "Clock ticks every second", verification: "curl the page and observe" },
    ],
    steps: [{ title: "Write it", description: "Write index.html", satisfies: ["AC1"] }],
  },
};

function toolCallEvent(id: string, name: string, input: Record<string, unknown>): ProviderEvent {
  return {
    type: "tool-call",
    toolCall: { id, type: "function", function: { name, arguments: JSON.stringify(input) } },
  };
}

function toolResultEvent(
  id: string,
  name: string,
  output: unknown,
  input: Record<string, unknown> = {},
): ProviderEvent {
  return {
    type: "tool-result",
    toolCall: { id, type: "function", function: { name, arguments: JSON.stringify(input) } },
    output,
  };
}

/** A request that enumerates several behaviors — the shape the requirement audit exists for. */
const DENSE_REQUEST =
  "Implement slugify in src/slug.ts. It must trim leading and trailing whitespace, lowercase ASCII letters, replace every run of non-alphanumeric characters with one hyphen, and remove leading or trailing hyphens. Preserve digits and internal hyphens. Do not modify tests. Run bun test before completing.";

function lastUserText(request: ProviderStreamRequest | undefined): string {
  const messages = (request?.messages ?? []) as Array<{ role: string; content: unknown }>;
  const last = [...messages].reverse().find((message) => message.role === "user");
  return typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
}

/**
 * Round 1: publish a plan, write a file, never verify. Later rounds (nudges): scripted per-test
 * — either one script repeated for every nudge, or a distinct script per round (an array of
 * arrays) so a test can prove a LATER nudge, not just the first, can still succeed.
 */
class ScenarioProvider implements ProviderAdapter {
  readonly id = "gate-test";
  readonly defaultModelId = "gate-test-model";
  round = 0;
  readonly requests: ProviderStreamRequest[] = [];

  constructor(
    private readonly secondRoundEvents: ProviderEvent[] | ProviderEvent[][],
    /** The files round 1 writes. */
    private readonly firstWrites: readonly string[] = ["index.html"],
    /** The plan round 1 publishes. */
    private readonly planResult: unknown = PLAN_TOOL_RESULT,
  ) {}

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return {
      modelId,
      modelInfo: {
        id: modelId,
        name: "Gate test model",
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

  stream(request: ProviderStreamRequest): ProviderStream {
    this.requests.push(request);
    this.round += 1;
    const events: ProviderEvent[] =
      this.round === 1
        ? [
            toolCallEvent("call-plan", "generate_plan", {}),
            toolResultEvent("call-plan", "generate_plan", this.planResult),
            ...this.firstWrites.flatMap((file, index): ProviderEvent[] => {
              const id = index === 0 ? "call-write" : `call-write-${index}`;
              const content = file === "index.html" ? "<html></html>" : "Findings.";
              return [
                toolCallEvent(id, "write_file", { path: file, content }),
                toolResultEvent(id, "write_file", {
                  success: true,
                  output: `Created ${file}`,
                  diff: { filePath: file, additions: 1, removals: 0, patch: "", isNew: true },
                }),
              ];
            }),
            { type: "text-delta", text: "Done." },
          ]
        : Array.isArray(this.secondRoundEvents[0])
          ? ((this.secondRoundEvents as ProviderEvent[][])[this.round - 2] ??
            (this.secondRoundEvents as ProviderEvent[][]).at(-1) ??
            [])
          : (this.secondRoundEvents as ProviderEvent[]);
    return {
      events: (async function* () {
        yield* events;
      })(),
      response: Promise.resolve({ messages: [{ role: "assistant", content: "Done." }] }),
    };
  }

  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    return { text: "Summary.", modelId: request.modelId };
  }

  getToolContext(): ProviderToolContext {
    return {};
  }
}

describe("completion/verification gate", () => {
  /** A page that answers 200: a scripted `curl` counts only when the host's own request to the page succeeds too. */
  const page = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  let pageUrl = "";
  beforeAll(async () => {
    await new Promise<void>((resolve) => page.listen(0, "127.0.0.1", resolve));
    pageUrl = `http://127.0.0.1:${(page.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    page.close();
  });

  it("blocks completion when no acceptance criterion was ever verified, after all automatic nudges", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([{ type: "text-delta", text: "Still done, trust me." }]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // Round 1 (initial) + 3 nudge rounds (MAX_VERIFICATION_RETRIES) = 4 total streamed rounds.
    // Raised from 1 nudge to 3 (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §12): each
    // nudge re-enters the same turn's tool loop, so more nudges means more real room to reach a
    // verifiable state on a large scaffold, not just asking the same unmet question again.
    expect(provider.round).toBe(4);
    const notice = chunks.find((c) => c.type === "content" && c.content?.includes("Not verified"));
    expect(notice).toBeDefined();
    expect(notice?.content).toContain("AC1");
    expect(chunks.at(-1)).toEqual({ type: "done" });

    const blockedCall = upsertObjectiveIndex.mock.calls.find(([record]) => record.phase === "blocked");
    expect(blockedCall).toBeDefined();
    expect(blockedCall?.[0].blocker).toContain("No verification action was observed");
  });

  it("asks a turn that only wrote documents once, to check its facts, then reports it unverified", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([{ type: "text-delta", text: "Checked." }], ["docs/AUDIT.md", "notes.txt"]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Write an audit report of this project")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // Round 1 and one fact-check request; a code change gets three requests.
    expect(provider.round).toBe(2);
    const request = lastUserText(provider.requests[1]);
    expect(request).toContain("only wrote documents");
    expect(request).toContain("grep the code for each claim");
    const notice = chunks.find((c) => c.type === "content" && c.content?.includes("Not verified"));
    expect(notice?.content).toContain("2 document(s) written");
    expect(notice?.content).toContain("AC1");
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });

  it("reports a turn that only wrote documents unverified even after a code check passes", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    // Live 2026-09-23: after the fact-check request the model ran the type-check, which says
    // nothing about what an audit report states, and the turn ended as verified.
    const provider = new ScenarioProvider(
      [
        toolCallEvent("call-tsc", "bash", { command: "bun run typecheck" }),
        toolResultEvent(
          "call-tsc",
          "bash",
          { success: true, output: "$ tsc --noEmit" },
          { command: "bun run typecheck" },
        ),
        { type: "text-delta", text: "Checked the claims." },
      ],
      ["docs/AUDIT.md"],
    );
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Write an audit report of this project")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(provider.round).toBe(2);
    const notice = chunks.find((c) => c.type === "content" && c.content?.includes("Not verified"));
    expect(notice?.content).toContain("1 document(s) written");
  });

  it("does not count a check whose output was piped into another command", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    // Live 2026-09-23: the type-check failed, but `head` exited 0, so the command succeeded.
    const piped = "bun run typecheck 2>&1 | head -50";
    const provider = new ScenarioProvider([
      [
        toolCallEvent("call-piped", "bash", { command: piped }),
        toolResultEvent("call-piped", "bash", { success: true, output: "error TS2307" }, { command: piped }),
        { type: "text-delta", text: "Type-check done." },
      ],
      [
        toolCallEvent("call-tsc", "bash", { command: "bun run typecheck" }),
        toolResultEvent(
          "call-tsc",
          "bash",
          { success: true, output: "$ tsc --noEmit" },
          { command: "bun run typecheck" },
        ),
        { type: "text-delta", text: "Type-check passes." },
      ],
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // Round 2 ran the piped check and was asked again; round 3 ran it on its own.
    expect(provider.round).toBe(3);
    const request = lastUserText(provider.requests[2]);
    expect(request).toContain(piped);
    expect(request).toContain("Run the check on its own");
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
  });

  it("keeps all three requests when code changed alongside a document", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([{ type: "text-delta", text: "Still done." }], ["index.html", "README.md"]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    for await (const _chunk of agent.processMessage("Create a digital clock")) {
      // drain
    }

    expect(provider.round).toBe(4);
    expect(lastUserText(provider.requests[1])).not.toContain("only wrote documents");
  });

  it("does not block when the nudge round actually verifies (a real command is run)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([
      toolCallEvent("call-curl", "bash", { command: `curl ${pageUrl}/index.html` }),
      toolResultEvent(
        "call-curl",
        "bash",
        { success: true, output: "<html></html>" },
        { command: `curl ${pageUrl}/index.html` },
      ),
      { type: "text-delta", text: "Verified: the page serves correctly." },
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(provider.round).toBe(2);
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });

  it("does not block a large scaffold that only becomes verifiable on a later nudge (e.g. after install/build)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([
      // Nudge 1: still just installing — nothing to verify yet.
      [
        toolCallEvent("call-install", "bash", { command: "npm install" }),
        toolResultEvent(
          "call-install",
          "bash",
          { success: true, output: "added 200 packages" },
          { command: "npm install" },
        ),
        { type: "text-delta", text: "Dependencies installed. Continuing setup." },
      ],
      // Nudge 2: still setting up — nothing to verify yet.
      [
        toolCallEvent("call-migrate", "bash", { command: "npx prisma migrate dev" }),
        toolResultEvent(
          "call-migrate",
          "bash",
          { success: true, output: "Migration applied" },
          { command: "npx prisma migrate dev" },
        ),
        { type: "text-delta", text: "Database migrated. Starting the server next." },
      ],
      // Nudge 3: the server is finally up — a real verification action happens.
      [
        toolCallEvent("call-curl", "bash", { command: `curl ${pageUrl}` }),
        toolResultEvent(
          "call-curl",
          "bash",
          { success: true, output: "<html></html>" },
          { command: `curl ${pageUrl}` },
        ),
        { type: "text-delta", text: "Verified: the app serves correctly." },
      ],
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // Would have been wrongly blocked after round 2 under the old 1-nudge limit — this is the
    // exact shape of the live CITADEL failure (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §12).
    expect(provider.round).toBe(4);
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: "done" });
    // §18: this turn's unblocking evidence (the final curl) is real but UNLINKED — the model
    // never called update_plan_step. This is the concrete, empirical reason a mechanical
    // "require linked evidence" second-pass gate was NOT built in §18: applying that requirement
    // here would demand a 4th nudge this scenario doesn't have budget for (MAX_VERIFICATION_RETRIES
    // = 3), reintroducing the exact over-blocking bug §12 already fixed once.
    expect(agent.getVerificationStatus().linkedCriteriaIds).toEqual([]);
  });

  it("counts a delegation to the verify sub-agent that itself ran a check as real verification evidence", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([
      toolCallEvent("call-verify", "task", { agent: "verify", description: "Verify the clock renders and ticks" }),
      toolResultEvent(
        "call-verify",
        "task",
        {
          success: true,
          output: "Started the app, opened it in a real browser, observed the clock ticking.",
          task: {
            agent: "verify",
            description: "Verify the clock renders and ticks",
            summary: "Verified",
            evidence: ["bash: curl -s http://localhost:3000"],
          },
        },
        { agent: "verify", description: "Verify the clock renders and ticks" },
      ),
      { type: "text-delta", text: "Verified via the verify sub-agent's real browser check." },
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // Before this fix, the gate only looked at the parent turn's OWN direct tool calls, so a
    // correctly-delegated real verification (build/test/browser smoke test inside the verify
    // sub-agent) was invisible to it and still got blocked.
    expect(provider.round).toBe(2);
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });

  it("does not credit a verify delegation whose sub-agent ran no check (audit 2026-09-23)", async () => {
    // On Windows every command of the verify sub-agent failed (its sandbox needs macOS), yet the
    // finished delegation counted as "delegated verification completed".
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([
      toolCallEvent("call-verify", "task", { agent: "verify", description: "Verify the clock" }),
      toolResultEvent(
        "call-verify",
        "task",
        {
          success: true,
          output: "Shuru sandbox mode currently requires macOS on Apple Silicon. Could not run anything.",
          task: { agent: "verify", description: "Verify the clock", summary: "Could not run anything" },
        },
        { agent: "verify", description: "Verify the clock" },
      ),
      { type: "text-delta", text: "Verified." },
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(true);
  });

  it("does not credit a delegation to a non-verification sub-agent (e.g. explore) as evidence", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([
      toolCallEvent("call-explore", "task", { agent: "explore", description: "Look at the file again" }),
      toolResultEvent(
        "call-explore",
        "task",
        { success: true, output: "The file looks correct." },
        { agent: "explore", description: "Look at the file again" },
      ),
      { type: "text-delta", text: "Still done, trust me." },
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(true);
  });

  it("links a criterion to real evidence when the model marks its satisfying step complete (§18)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    // PLAN_TOOL_RESULT's one step already declares satisfies: ["AC1"] (round 1, baked into
    // ScenarioProvider). Round 2 pairs real evidence with an explicit update_plan_step(complete)
    // on that same step — the model's own structural declaration of which criterion it advanced.
    const provider = new ScenarioProvider([
      toolCallEvent("call-curl", "bash", { command: `curl ${pageUrl}/index.html` }),
      toolResultEvent(
        "call-curl",
        "bash",
        { success: true, output: "<html></html>" },
        { command: `curl ${pageUrl}/index.html` },
      ),
      toolCallEvent("call-step", "update_plan_step", { index: 1, status: "complete", evidence: "curl returned 200" }),
      toolResultEvent(
        "call-step",
        "update_plan_step",
        {
          success: true,
          output: "Plan step 1 is complete.",
          planUpdate: { index: 0, status: "complete", evidence: "curl returned 200" },
        },
        { index: 1, status: "complete", evidence: "curl returned 200" },
      ),
      { type: "text-delta", text: "Verified: the page serves correctly." },
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string });
    }

    expect(chunks.at(-1)).toEqual({ type: "done" });
    const status = agent.getVerificationStatus();
    expect(status.linkedCriteriaIds).toEqual(["AC1"]);
    expect(status.evidenceCount).toBeGreaterThan(0);
  });

  it("does not fabricate a link when update_plan_step is called with no real verification evidence", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    // Model marks the step "complete" and even names AC1 in the step's satisfies — but never
    // makes a real verification-shaped call. The raw link set may still record the id (it is
    // cheap, harmless bookkeeping), but the gate's blocking behavior must be entirely unchanged:
    // zero real evidence still nudges/blocks, exactly as before this feature existed.
    const provider = new ScenarioProvider([
      [
        toolCallEvent("call-step", "update_plan_step", {
          index: 1,
          status: "complete",
          evidence: "I looked at it and it's fine",
        }),
        toolResultEvent(
          "call-step",
          "update_plan_step",
          {
            success: true,
            output: "Plan step 1 is complete.",
            planUpdate: { index: 0, status: "complete", evidence: "I looked at it and it's fine" },
          },
          { index: 1, status: "complete", evidence: "I looked at it and it's fine" },
        ),
        { type: "text-delta", text: "Done, I checked it." },
      ],
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // The gate still blocks — a self-reported "complete" with no real evidence is exactly the
    // original §9 failure this whole mechanism exists to catch, and per-criterion linking must
    // never become a way around it.
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(true);
    expect(agent.getVerificationStatus().evidenceCount).toBe(0);
  });

  it("names a check the turn ran that fails on the final code, instead of 'no verification observed' (seen live 2026-09-25)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const failure = "src/kart.ts(114,1): error TS1128: Declaration or statement expected.";
    const provider = new ScenarioProvider([
      toolCallEvent("call-build", "bash", { command: "npm run build" }),
      toolResultEvent(
        "call-build",
        "bash",
        { success: false, output: failure, error: `> build\n> tsc\n\n${failure}` },
        { command: "npm run build" },
      ),
      { type: "text-delta", text: "Done, the game builds." },
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) chunks.push(chunk as never);

    const nudges = provider.requests.map((request) => lastUserText(request));
    expect(nudges.some((text) => text.includes("Completion blocked: `npm run build` failed on the final code"))).toBe(
      true,
    );
    expect(nudges.some((text) => text.includes("TS1128"))).toBe(true);
    const verdict = chunks.find((chunk) => chunk.content?.includes("[Not verified"))?.content ?? "";
    expect(verdict).toContain("`npm run build` fails on the final code (src/kart.ts(114,1): error TS1128");
    expect(verdict).not.toContain("No verification action was observed");
  });

  it("does not count a curl that exits 0 on a page answering 500 (seen live 2026-09-25)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const server = createServer((_request, response) => {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("Internal Server Error");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const command = `curl -s http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      const provider = new ScenarioProvider([
        toolCallEvent("call-curl", "bash", { command }),
        toolResultEvent("call-curl", "bash", { success: true, output: "Internal Server Error" }, { command }),
        { type: "text-delta", text: "The page works." },
      ]);
      const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
        provider,
        cwd: mkdtempSync(join(tmpdir(), "shelra-curl-")),
      });

      const chunks: Array<{ type: string; content?: string }> = [];
      for await (const chunk of agent.processMessage("Create a digital clock")) chunks.push(chunk as never);

      const nudges = provider.requests.map((request) => lastUserText(request));
      expect(nudges.some((text) => text.includes("The command exited 0, but Shelra requested"))).toBe(true);
      const verdict = chunks.find((chunk) => chunk.content?.includes("[Not verified"))?.content ?? "";
      expect(verdict).toContain(`\`${command}\` fails on the final code`);
      expect(verdict).toContain("HTTP 500");
    } finally {
      server.close();
    }
  });

  it("leaves a turn unverified when the page its answer names fails, though a check passed (seen live 2026-09-25)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const server = createServer((_request, response) => {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("Internal Server Error");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const workspace = mkdtempSync(join(tmpdir(), "shelra-page-"));
    try {
      const provider = new ScenarioProvider([
        toolCallEvent("call-test", "bash", { command: "npx vitest run" }),
        toolResultEvent(
          "call-test",
          "bash",
          { success: true, output: "Tests 3 passed" },
          { command: "npx vitest run" },
        ),
        { type: "text-delta", text: `Done: open ${url} to see the clock.` },
      ]);
      const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: workspace });

      const chunks: Array<{ type: string; content?: string }> = [];
      for await (const chunk of agent.processMessage("Create a digital clock")) chunks.push(chunk as never);

      const text = chunks.map((chunk) => chunk.content ?? "").join("");
      expect(text).toContain(
        `[Not verified — the local page the answer names does not work: ${url} → HTTP 500 Internal Server Error]`,
      );
      const episodes = readFileSync(join(workspace, ".shelra", "memory", "episodes.jsonl"), "utf-8");
      expect(episodes).toContain('"outcome":"unverified"');
    } finally {
      server.close();
    }
  });

  it.skipIf(!hasChromium)(
    "opens the app the turn changed and holds an error it throws against the turn (audit gap #1, seen live 2026-09-25)",
    async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const workspace = mkdtempSync(join(tmpdir(), "shelra-app-"));
      writeFileSync(
        join(workspace, "index.html"),
        '<h1>Kart</h1><script>requestAnimationFrame(() => { throw new Error("kart is not defined"); });</script>',
      );
      const provider = new ScenarioProvider([{ type: "text-delta", text: "The game works." }]);
      const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: workspace });

      const chunks: Array<{ type: string; content?: string }> = [];
      for await (const chunk of agent.processMessage("Create a kart racing game")) chunks.push(chunk as never);

      // Two requests to fix it, then the verdict: three rounds.
      expect(provider.round).toBe(3);
      expect(chunks.filter((chunk) => chunk.content?.endsWith("Asking for a fix.]\n\n"))).toHaveLength(2);
      const nudge = lastUserText(provider.requests.at(-1));
      expect(nudge).toContain("Completion blocked: after your last change Shelra opened the app");
      expect(nudge).toContain("uncaught error: Error: kart is not defined");
      const verdict = chunks.find((chunk) => chunk.content?.includes("[Not verified"))?.content ?? "";
      expect(verdict).toContain("(index.html, served as static files) does not work in a headless browser");
      expect(verdict).toContain("kart is not defined, after 2 automatic request(s).");
    },
    90_000,
  );

  it.skipIf(!hasChromium)(
    "counts an app the host opened and saw work as verified, with no nudge",
    async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const workspace = mkdtempSync(join(tmpdir(), "shelra-app-"));
      writeFileSync(
        join(workspace, "index.html"),
        '<body style="margin:0;background:#113"><h1 style="color:#fff">Digital clock</h1><p style="color:#0f8">12:00:00</p></body>',
      );
      const provider = new ScenarioProvider([{ type: "text-delta", text: "Unused." }]);
      const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: workspace });

      const chunks: Array<{ type: string; content?: string }> = [];
      for await (const chunk of agent.processMessage("Create a digital clock")) chunks.push(chunk as never);

      expect(provider.round).toBe(1);
      const text = chunks.map((chunk) => chunk.content ?? "").join("");
      expect(text).toMatch(
        /\[Checked by Shelra on the final code: the app at http:\/\/127\.0\.0\.1:\d+\/ \(index\.html, served as static files\) loaded in a headless browser with no errors\]/u,
      );
    },
    90_000,
  );

  it("does not gate a non-coding (conversational) turn even with no tool calls", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([]);
    // Override round 1 to look conversational: no plan, no tools, just text.
    provider.stream = (_req: ProviderStreamRequest) => ({
      events: (async function* () {
        yield { type: "text-delta", text: "Hi there!" } as ProviderEvent;
      })(),
      response: Promise.resolve({ messages: [{ role: "assistant", content: "Hi there!" }] }),
    });
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("hello")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });
  it("requests one requirement audit after verification on a requirement-dense request", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([
      // Nudge 1: the model finally runs the tests — real verification evidence.
      [
        toolCallEvent("call-test", "bash", { command: "bun test" }),
        toolResultEvent("call-test", "bash", { success: true, output: "3 pass" }, { command: "bun test" }),
        { type: "text-delta", text: "Tests pass." },
      ],
      // Audit round: the model accounts for every stated behavior without further changes.
      [{ type: "text-delta", text: "Audit: every behavior is exercised by src/slug.test.ts." }],
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage(DENSE_REQUEST)) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // Initial round + verification nudge + exactly one audit round.
    expect(provider.round).toBe(3);
    const auditPrompt = lastUserText(provider.requests[2]);
    expect(auditPrompt).toContain("audit the request requirement by requirement");
    expect(auditPrompt).toContain("1. Implement slugify in src/slug.ts.");
    expect(auditPrompt).toContain("Preserve digits and internal hyphens.");
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });

  it("blocks a fix made in answer to the audit until something runs again", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([
      [
        toolCallEvent("call-test", "bash", { command: "bun test" }),
        toolResultEvent("call-test", "bash", { success: true, output: "3 pass" }, { command: "bun test" }),
        { type: "text-delta", text: "Tests pass." },
      ],
      // Audit round: the model finds a gap and edits the file, but never re-runs anything.
      [
        toolCallEvent("call-edit", "edit_file", { path: "src/slug.ts", old_text: "a", new_text: "b" }),
        toolResultEvent("call-edit", "edit_file", {
          success: true,
          output: "Edited src/slug.ts",
          diff: { filePath: "src/slug.ts", additions: 1, removals: 1, patch: "", isNew: false },
        }),
        { type: "text-delta", text: "Fixed the trailing-hyphen case. Done." },
      ],
      // Re-verification nudge: the model runs the tests again.
      [
        toolCallEvent("call-test-2", "bash", { command: "bun test" }),
        toolResultEvent("call-test-2", "bash", { success: true, output: "4 pass" }, { command: "bun test" }),
        { type: "text-delta", text: "Tests pass after the fix." },
      ],
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage(DENSE_REQUEST)) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(provider.round).toBe(4);
    expect(lastUserText(provider.requests[3])).toContain("after your last passing check");
    expect(lastUserText(provider.requests[3])).toContain("src/slug.ts");
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: "done" });
  });

  it("does not audit a request that names a single behavior", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([
      toolCallEvent("call-test", "bash", { command: "bun test" }),
      toolResultEvent("call-test", "bash", { success: true, output: "1 pass" }, { command: "bun test" }),
      { type: "text-delta", text: "Tests pass." },
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    for await (const _chunk of agent.processMessage("The clock must tick every second.")) {
      // drain
    }

    expect(provider.round).toBe(2);
  });

  it("asks again when files change after the last passing check (audit 2026-09-23)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const lexer = { path: "src/lexer.ts", content: "x" };
    const provider = new ScenarioProvider([
      [
        toolCallEvent("call-test", "bash", { command: "bun test" }),
        toolResultEvent("call-test", "bash", { success: true, output: "3 pass" }, { command: "bun test" }),
        toolCallEvent("call-lexer", "write_file", lexer),
        toolResultEvent(
          "call-lexer",
          "write_file",
          {
            success: true,
            output: "Created src/lexer.ts",
            diff: { filePath: "src/lexer.ts", additions: 1, removals: 0, patch: "", isNew: true },
          },
          lexer,
        ),
        { type: "text-delta", text: "Done: tests pass." },
      ],
      [
        toolCallEvent("call-retest", "bash", { command: "bun test" }),
        toolResultEvent("call-retest", "bash", { success: true, output: "4 pass" }, { command: "bun test" }),
        { type: "text-delta", text: "Ran the tests again on the final code." },
      ],
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // Round 1 wrote without checking, round 2 checked and then edited again, round 3 re-ran the check.
    expect(provider.round).toBe(3);
    expect(lastUserText(provider.requests[2])).toContain("after your last passing check");
    expect(lastUserText(provider.requests[2])).toContain("src/lexer.ts");
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
  });

  it("keeps the unverified verdict in the conversation for the next turn (audit 2026-09-23)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([{ type: "text-delta", text: "Still done, trust me." }]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    for await (const _chunk of agent.processMessage("Create a digital clock")) {
      // drain: the turn ends [Not verified]
    }
    const turnOneRequests = provider.requests.length;
    for await (const _chunk of agent.processMessage("continue")) {
      // drain
    }

    const nextTurn = provider.requests[turnOneRequests]?.messages as Array<{ role: string; content: unknown }>;
    const assistantTexts = nextTurn.filter((message) => message.role === "assistant").map((m) => JSON.stringify(m));
    expect(assistantTexts.some((text) => text.includes("[Not verified"))).toBe(true);
  });

  it("counts a change made through the shell (audit 2026-09-23)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    // The scripted model changes code with a shell command; nothing goes through write_file.
    const workspace = mkdtempSync(join(tmpdir(), "shelra-gate-shell-"));
    const command = "node -e \"require('fs').writeFileSync('parse.ts', 'export {}')\"";
    let round = 0;
    const provider: ProviderAdapter = {
      id: "shell-writer",
      defaultModelId: "gate-test-model",
      resolveModelRuntime: (modelId) => ({
        modelId,
        modelInfo: {
          id: modelId,
          name: "Gate test model",
          contextWindow: 32_768,
          inputPrice: 0,
          outputPrice: 0,
          reasoning: false,
          description: "Test-only provider",
          supportsClientTools: true,
          supportsMaxOutputTokens: true,
          runtimeKind: "managed-llama",
        },
      }),
      stream: () => {
        round += 1;
        const first = round === 1;
        return {
          events: (async function* () {
            if (first) {
              yield toolCallEvent("call-shell", "bash", { command });
              writeFileSync(join(workspace, "parse.ts"), "export {};\n");
              yield toolResultEvent("call-shell", "bash", { success: true, output: "" }, { command });
            }
            yield { type: "text-delta", text: "Done." } as ProviderEvent;
          })(),
          response: Promise.resolve({ messages: [{ role: "assistant", content: "Done." }] }),
        };
      },
      generateText: async (request) => ({ text: "Summary.", modelId: request.modelId }),
      getToolContext: () => ({}),
    };
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: workspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Fix the parser")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(round).toBe(4);
    const notice = chunks.find((c) => c.content?.includes("Not verified"));
    expect(notice?.content).toContain("1 file(s) changed");
  });
});

describe("benchmark ablations of the gate (audit doc 15, item 0.1)", () => {
  it("lets an unverified change finish at once when the gate is switched off", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([{ type: "text-delta", text: "Still done." }]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider,
      cwd: testWorkspace,
      ablate: ["gate"],
    });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // With the gate on, this turn takes four rounds and ends "Not verified" (first test above).
    expect(provider.round).toBe(1);
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
  });

  it("verifies but skips the requirement audit when the audit is switched off", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([
      [
        toolCallEvent("call-test", "bash", { command: "bun test" }),
        toolResultEvent("call-test", "bash", { success: true, output: "3 pass" }, { command: "bun test" }),
        { type: "text-delta", text: "Tests pass." },
      ],
      [{ type: "text-delta", text: "Audit: every behavior is exercised." }],
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider,
      cwd: testWorkspace,
      ablate: ["audit"],
    });

    for await (const _chunk of agent.processMessage(DENSE_REQUEST)) {
      // drain
    }

    // Initial round and the verification nudge; with the audit on there is a third, audit round.
    expect(provider.round).toBe(2);
    expect(provider.requests.some((request) => lastUserText(request).includes("audit the request"))).toBe(false);
  });
});

describe("task contract: the project's own checks decide (audit doc 15, Phase 1.3-1.4)", () => {
  /** A workspace whose package.json states its test command, as most projects do. */
  const projectWorkspace = () => {
    const dir = mkdtempSync(join(tmpdir(), "shelra-contract-gate-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
    return dir;
  };

  it("runs the project's tests itself on an unverified change, and finishes when they pass", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([{ type: "text-delta", text: "Still done." }]);
    const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "3 pass", durationMs: 10 }));
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider,
      cwd: projectWorkspace(),
      checkRunner,
    });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    // No nudge round: the host's own run of the project's tests is the evidence.
    expect(provider.round).toBe(1);
    expect(checkRunner.mock.calls.map(([command]) => command)).toEqual(["bun run test"]);
    expect(
      chunks.some((c) => c.content?.includes("[Checked by Shelra on the final code: `bun run test` passed]")),
    ).toBe(true);
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
  });

  it("sends a failing project check back with its output, then reports it", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([{ type: "text-delta", text: "Still done." }]);
    const checkRunner = vi.fn<ContractCheckRunner>(async () => ({
      passed: false,
      output: "1 fail: slugify trims",
      durationMs: 10,
    }));
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider,
      cwd: projectWorkspace(),
      checkRunner,
    });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(provider.round).toBe(4);
    const nudge = lastUserText(provider.requests[1]);
    expect(nudge).toContain("the project's own checks fail on your final code");
    expect(nudge).toContain("`bun run test`");
    expect(nudge).toContain("slugify trims");
    const verdict = chunks.find((c) => c.content?.includes("Not verified"));
    expect(verdict?.content).toContain("`bun run test` fails on the final code");
  });

  it("reuses the agent's own run of the check after its last change instead of running it again", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    let round = 0;
    const provider: ProviderAdapter = {
      id: "self-verifier",
      defaultModelId: "gate-test-model",
      resolveModelRuntime: (modelId) => ({
        modelId,
        modelInfo: {
          id: modelId,
          name: "Gate test model",
          contextWindow: 32_768,
          inputPrice: 0,
          outputPrice: 0,
          reasoning: false,
          description: "Test-only provider",
          supportsClientTools: true,
          supportsMaxOutputTokens: true,
          runtimeKind: "managed-llama",
        },
      }),
      stream: () => {
        round += 1;
        return {
          events: (async function* () {
            yield toolCallEvent("call-write", "write_file", { path: "src/clock.ts", content: "x" });
            yield toolResultEvent("call-write", "write_file", {
              success: true,
              output: "Created src/clock.ts",
              diff: { filePath: "src/clock.ts", additions: 1, removals: 0, patch: "", isNew: true },
            });
            // The script's own body: the same check as `bun run test`.
            yield toolCallEvent("call-test", "bash", { command: "bun test" });
            yield toolResultEvent("call-test", "bash", { success: true, output: "3 pass" }, { command: "bun test" });
            yield { type: "text-delta", text: "Done, tests pass." } as ProviderEvent;
          })(),
          response: Promise.resolve({ messages: [{ role: "assistant", content: "Done." }] }),
        };
      },
      generateText: async (request) => ({ text: "Summary.", modelId: request.modelId }),
      getToolContext: () => ({}),
    };
    const checkRunner = vi.fn<ContractCheckRunner>(async () => ({
      passed: false,
      output: "should not run",
      durationMs: 10,
    }));
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider,
      cwd: projectWorkspace(),
      checkRunner,
    });

    for await (const _chunk of agent.processMessage("Create a digital clock")) {
      // drain
    }

    expect(round).toBe(1);
    expect(checkRunner).not.toHaveBeenCalled();
  });

  /** A plan whose criterion names a command, with what that command did before the change. */
  const planWithCommand = (commandBefore: "failed" | "passed") => ({
    ...PLAN_TOOL_RESULT,
    plan: {
      ...PLAN_TOOL_RESULT.plan,
      acceptanceCriteria: [
        {
          id: "AC1",
          description: "Clock ticks every second",
          verification: "run its test",
          command: "bun test clock",
          commandBefore,
        },
      ],
    },
  });

  it("holds the final code to a plan criterion's command that failed before the change", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    // No stated project checks here: the contract is the plan's own executable criterion.
    const provider = new ScenarioProvider(
      [{ type: "text-delta", text: "Still done." }],
      ["index.html"],
      planWithCommand("failed"),
    );
    const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "1 pass", durationMs: 5 }));
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider,
      cwd: mkdtempSync(join(tmpdir(), "shelra-contract-plan-")),
      checkRunner,
    });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(provider.round).toBe(1);
    expect(checkRunner.mock.calls.map(([command]) => command)).toEqual(["bun test clock"]);
    expect(chunks.some((c) => c.content?.includes("`bun test clock` passed"))).toBe(true);
  });

  it("runs and reports a command once, however many plan criteria name it (seen live 2026-09-25)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const base = planWithCommand("failed");
    const criterion = base.plan.acceptanceCriteria[0];
    const plan = {
      ...base,
      plan: {
        ...base.plan,
        acceptanceCriteria: ["AC1", "AC2", "AC3"].map((id) => ({ ...criterion, id })),
      },
    };
    const provider = new ScenarioProvider([{ type: "text-delta", text: "Still done." }], ["index.html"], plan);
    const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "1 pass", durationMs: 5 }));
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider,
      cwd: mkdtempSync(join(tmpdir(), "shelra-contract-plan-once-")),
      checkRunner,
    });

    let text = "";
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      if (chunk.type === "content") text += chunk.content ?? "";
    }

    expect(checkRunner.mock.calls.map(([command]) => command)).toEqual(["bun test clock"]);
    expect(text).toContain("[Checked by Shelra on the final code: `bun test clock` passed]");
  });

  it("does not count a plan criterion's command that already passed before the change", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider(
      [{ type: "text-delta", text: "Still done." }],
      ["index.html"],
      planWithCommand("passed"),
    );
    const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "", durationMs: 5 }));
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider,
      cwd: mkdtempSync(join(tmpdir(), "shelra-contract-plan-")),
      checkRunner,
    });

    for await (const _chunk of agent.processMessage("Create a digital clock")) {
      // drain
    }

    // It proves nothing, so there is no contract: the gate asks for real verification as before.
    expect(checkRunner).not.toHaveBeenCalled();
    expect(provider.round).toBe(4);
  });

  it("falls back to asking for any check when the contract is switched off", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const provider = new ScenarioProvider([{ type: "text-delta", text: "Still done." }]);
    const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "", durationMs: 1 }));
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider,
      cwd: projectWorkspace(),
      checkRunner,
      ablate: ["contract"],
    });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Create a digital clock")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(checkRunner).not.toHaveBeenCalled();
    expect(provider.round).toBe(4);
    expect(chunks.find((c) => c.content?.includes("Not verified"))?.content).toContain("No verification action");
  });
});

describe("checks in a large or unfamiliar project (2026-10-03: SWE-bench Pro's task images)", () => {
  async function run(agent: Agent, request: string): Promise<string> {
    let text = "";
    for await (const chunk of agent.processMessage(request)) text += (chunk as { content?: string }).content ?? "";
    return text;
  }

  it("says once that a check whose tool is missing could not run, and never sends it back", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = mkdtempSync(join(tmpdir(), "shelra-unrunnable-check-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "bun test", lint: "golint-x ." } }));
    const provider = new ScenarioProvider([{ type: "text-delta", text: "Done." }], ["src/clock.ts"]);
    const checkRunner = vi.fn<ContractCheckRunner>(async (command) =>
      command.includes("lint")
        ? { passed: false, output: "sh: golint-x: command not found", durationMs: 5, state: "completed", exitCode: 127 }
        : { passed: true, output: "3 pass", durationMs: 5 },
    );
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: dir, checkRunner });

    const text = await run(agent, "Create a digital clock");

    expect(provider.round).toBe(1);
    expect(text).toContain("[Shelra could not run `bun run lint` (sh: golint-x: command not found) here");
    // A missing required tool never becomes a global success; the passing check keeps its own receipt.
    expect(text).toContain("[Not verified — The final local candidate has no complete fresh host verification.]");
    expect(text).not.toContain("[Checked by Shelra on the final code:");
    expect(agent.getLastTurnResult()).toMatchObject({ status: "unverified", verified: false });
    expect(agent.getLastTurnResult()?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "bun run test", passed: true, fresh: true }),
        expect.objectContaining({ command: "bun run lint", passed: false, unrunnable: expect.any(String) }),
      ]),
    );
  });

  it("sends a suite that fails only as it did before back once, never as a pass, and a new failure every round", async () => {
    // Review 2026-10-03: counted as a pass, the failure a "fix the failing test" request is about was never sent back.
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const before = "(fail) connects to the database [1.00ms]\n\n 4 pass\n 1 fail\n";
    for (const [after, onlyAsBefore] of [
      [before, true],
      [`${before.replace(" 1 fail", "")}(fail) formats the clock [1.00ms]\n 3 pass\n 2 fail\n`, false],
    ] as const) {
      const dir = mkdtempSync(join(tmpdir(), "shelra-failed-before-"));
      writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
      const provider = new ScenarioProvider([{ type: "text-delta", text: "Done." }], ["src/clock.ts"]);
      let runs = 0;
      // The first run is the host's own run before the work; the next ones run on the turn's code.
      const checkRunner = vi.fn<ContractCheckRunner>(async () => {
        runs += 1;
        return { passed: false, output: runs === 1 ? before : after, durationMs: 5, state: "completed", exitCode: 1 };
      });
      const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: dir, checkRunner });

      const text = await run(agent, "Fix the clock formatting in src/clock.ts.");

      expect(lastUserText(provider.requests[1])).toContain(
        onlyAsBefore ? "connects to the database" : "formats the clock",
      );
      expect(text).not.toContain("Checked by Shelra");
      if (onlyAsBefore) {
        // The initial round and one repair round, then the verdict.
        expect(provider.round).toBe(2);
        expect(text).toContain("[Not verified — `bun run test` fails on the final code, as before this turn");
      } else {
        expect(provider.round).toBe(4);
      }
    }
  });

  it("runs a suite that outlasts the budget again on the changed packages, and remembers it for the next turn", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = mkdtempSync(join(tmpdir(), "shelra-slow-suite-"));
    writeFileSync(join(dir, "go.mod"), "module example.com/app\n");
    // The second turn edits the same package again.
    const provider = new ScenarioProvider(
      [
        [
          toolCallEvent("w2", "write_file", { path: "lib/auth/token.go", content: "package auth\n" }),
          toolResultEvent("w2", "write_file", {
            success: true,
            output: "Updated lib/auth/token.go",
            diff: { filePath: "lib/auth/token.go", additions: 1, removals: 1, patch: "", isNew: false },
          }),
          { type: "text-delta", text: "Done again." },
        ],
      ],
      ["lib/auth/token.go"],
    );
    const checkRunner = vi.fn<ContractCheckRunner>(async (command) =>
      command === "go test ./..."
        ? { passed: false, output: "", durationMs: 1_000, state: "timed_out", exitCode: null }
        : { passed: true, output: "ok", durationMs: 5 },
    );
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider,
      cwd: dir,
      checkRunner,
      checkTimeoutMs: 240_000,
    });

    const text = await run(agent, "Add a token expiry to lib/auth/token.go");

    const commands = checkRunner.mock.calls.map(([command]) => command);
    expect(commands).toEqual(["go test ./...", "go build ./...", "go vet ./...", "go test ./lib/auth"]);
    expect(checkRunner.mock.calls[0]?.[1].timeoutMs).toBe(240_000);
    expect(text).toContain("`go test ./lib/auth` passed");
    expect(text).not.toContain("Not verified");

    checkRunner.mockClear();
    await run(agent, "Add a token expiry to lib/auth/token.go");
    expect(checkRunner.mock.calls.map(([command]) => command)).not.toContain("go test ./...");
    expect(checkRunner.mock.calls.map(([command]) => command)).toContain("go test ./lib/auth");
  });

  it("still narrows a slow suite when the run before the work was cut off with partial output (second review)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = mkdtempSync(join(tmpdir(), "shelra-cut-prework-"));
    writeFileSync(join(dir, "go.mod"), "module example.com/app\n");
    const provider = new ScenarioProvider([{ type: "text-delta", text: "Done." }], ["lib/auth/token.go"]);
    const checkRunner = vi.fn<ContractCheckRunner>(async (command) =>
      command === "go test ./..."
        ? // Cut off by the time limit, after printing what it had: partial output with no "timed out" in it.
          {
            passed: false,
            output: "ok  \texample.com/app/lib/a\t1.2s\n",
            durationMs: 1_000,
            state: "timed_out",
            exitCode: null,
          }
        : { passed: true, output: "ok", durationMs: 5 },
    );
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider,
      cwd: dir,
      checkRunner,
      checkTimeoutMs: 240_000,
    });

    // "Fix" makes the host run the checks before the work.
    const text = await run(agent, "Fix the token expiry in lib/auth/token.go");

    expect(checkRunner.mock.calls.map(([command]) => command)).toContain("go test ./lib/auth");
    expect(text).toContain("`go test ./lib/auth` passed");
    expect(text).not.toContain("Not verified");
  });

  it("counts a scoped run that found no test for the change as no run, not a pass (review 2026-10-03)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = mkdtempSync(join(tmpdir(), "shelra-scoped-none-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "jest" } }));
    // The scripted write does not reach the disk; the scoped run names only files that are there.
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "clock.ts"), "export const tick = () => 1;\n");
    const provider = new ScenarioProvider([{ type: "text-delta", text: "Done." }], ["src/clock.ts"]);
    const checkRunner = vi.fn<ContractCheckRunner>(async (command) =>
      command === "npm run test"
        ? { passed: false, output: "", durationMs: 1_000, state: "timed_out", exitCode: null }
        : {
            passed: false,
            output: "No tests found, exiting with code 1",
            durationMs: 5,
            state: "completed",
            exitCode: 1,
          },
    );
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: dir, checkRunner });

    const text = await run(agent, "Create a digital clock");

    expect(checkRunner.mock.calls.map(([command]) => command)).toContain("npx jest --findRelatedTests src/clock.ts");
    expect(text).toContain("no test covers the files this turn changed");
    expect(text).not.toContain("Checked by Shelra");
  });
});

describe("what the final answer claims (2026-10-03)", () => {
  it("says when the answer claims a command the turn never ran or a file it never wrote", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = mkdtempSync(join(tmpdir(), "shelra-claims-gate-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
    const provider: ProviderAdapter = {
      id: "claims",
      defaultModelId: "gate-test-model",
      resolveModelRuntime: (modelId) => ({ modelId }),
      stream: () => ({
        events: (async function* () {
          yield toolCallEvent("w", "write_file", { path: "src/clock.ts", content: "x" });
          yield toolResultEvent("w", "write_file", {
            success: true,
            output: "Created src/clock.ts",
            diff: { filePath: "src/clock.ts", additions: 1, removals: 0, patch: "", isNew: true },
          });
          yield {
            type: "text-delta",
            text: "Created `src/clock.ts` and `src/clock.test.ts`. I ran `npm test` and all 8 tests pass.",
          } as ProviderEvent;
        })(),
        response: Promise.resolve({ messages: [{ role: "assistant", content: "Done." }] }),
      }),
      generateText: async (request) => ({ text: "Summary.", modelId: request.modelId }),
      getToolContext: () => ({}),
    };
    const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "8 pass", durationMs: 5 }));
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: dir, checkRunner });

    let text = "";
    for await (const chunk of agent.processMessage("Create a digital clock"))
      text += (chunk as { content?: string }).content ?? "";

    expect(text).toContain(
      "[Shelra checked the answer: it says it ran `npm test`, which this turn never ran; it names `src/clock.test.ts` as written, which does not exist.]",
    );
    expect(agent.getTurnEndNotes().some((note) => note.startsWith("[Shelra checked the answer"))).toBe(true);
  });
});

describe("honest exits and test protection (audit doc 15, Phase 1.5)", () => {
  /** A scripted model: each round's events, the last repeated for later rounds. */
  function scripted(
    rounds: Array<() => ProviderEvent[]>,
  ): ProviderAdapter & { round: number; requests: ProviderStreamRequest[] } {
    const provider = {
      id: "scripted",
      defaultModelId: "gate-test-model",
      round: 0,
      requests: [] as ProviderStreamRequest[],
      resolveModelRuntime: (modelId: string) => ({
        modelId,
        modelInfo: {
          id: modelId,
          name: "Gate test model",
          contextWindow: 32_768,
          inputPrice: 0,
          outputPrice: 0,
          reasoning: false,
          description: "Test-only provider",
          supportsClientTools: true,
          supportsMaxOutputTokens: true,
          runtimeKind: "managed-llama" as const,
        },
      }),
      stream(request: ProviderStreamRequest): ProviderStream {
        provider.requests.push(request);
        provider.round += 1;
        const events = (rounds[provider.round - 1] ?? rounds.at(-1) ?? (() => []))();
        return {
          events: (async function* () {
            yield* events;
          })(),
          response: Promise.resolve({ messages: [{ role: "assistant", content: "Done." }] }),
        };
      },
      generateText: async (request: ProviderTextRequest): Promise<ProviderTextResult> => ({
        text: "Summary.",
        modelId: request.modelId,
      }),
      getToolContext: (): ProviderToolContext => ({}),
    };
    return provider;
  }

  it("ends the turn with the agent's reason when it reports a blocker, without asking it to verify", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const reason = "The tests expect UTC but the request asks for local time; which one is right?";
    const provider = scripted([
      () => [
        toolCallEvent("w", "write_file", { path: "clock.ts", content: "x" }),
        toolResultEvent("w", "write_file", {
          success: true,
          output: "Created clock.ts",
          diff: { filePath: "clock.ts", additions: 1, removals: 0, patch: "", isNew: true },
        }),
        toolCallEvent("b", "report_blocker", { reason }),
        toolResultEvent("b", "report_blocker", { success: true, output: "Blocker reported", blocker: reason }),
        { type: "text-delta", text: "I stopped." },
      ],
    ]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Make the clock show local time")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(provider.round).toBe(1);
    expect(chunks.some((c) => c.content?.includes(`[Stopped — ${reason}]`))).toBe(true);
  });

  it("ends the generation at the step that reports a blocker: nothing the model calls after it runs", async () => {
    // Seen with a free model (doc 21 §9, 2026-10-03): it reported that a Drive backup breaks the user's offline rule,
    // then, in the same generation, installed googleapis and built the upload.
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const reason = "A Google Drive backup breaks the rule that nothing leaves the user's machine.";
    const blocker = { success: true, output: "Blocker reported", blocker: reason };
    const steps: Array<{ events: ProviderEvent[]; view: HostStopStep }> = [
      {
        events: [toolCallEvent("b", "report_blocker", { reason }), toolResultEvent("b", "report_blocker", blocker)],
        view: {
          toolCalls: [{ toolCallId: "b", toolName: "report_blocker", input: { reason } }],
          toolResults: [{ toolCallId: "b", output: blocker }],
        },
      },
      {
        events: [
          toolCallEvent("i", "bash", { command: "bun add googleapis" }),
          toolResultEvent("i", "bash", { success: true, output: "installed googleapis" }),
        ],
        view: { toolCalls: [{ toolCallId: "i", toolName: "bash", input: { command: "bun add googleapis" } }] },
      },
    ];
    const requests: ProviderStreamRequest[] = [];
    const provider: ProviderAdapter = {
      id: "stepwise",
      defaultModelId: "gate-test-model",
      resolveModelRuntime: (modelId) => ({ modelId }),
      // Plays steps as the AI SDK's loop does: after each one, the caller's stop conditions decide whether it goes on.
      stream: (request) => {
        requests.push(request);
        return {
          events: (async function* () {
            const seen: HostStopStep[] = [];
            for (const step of steps) {
              yield* step.events;
              seen.push(step.view);
              const stop = (request.hostStops ?? []).map((watch) => watch(seen)).find(Boolean);
              if (stop) {
                request.onHostStop?.(stop.reason, stop.detail);
                return;
              }
            }
          })(),
          response: Promise.resolve({ messages: [{ role: "assistant", content: "Stopped." }] }),
        };
      },
      generateText: async (request) => ({ text: "Summary.", modelId: request.modelId }),
      getToolContext: () => ({}),
    };
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: testWorkspace });

    const chunks: Array<{ type: string; content?: string; toolCalls?: Array<{ function: { name: string } }> }> = [];
    for await (const chunk of agent.processMessage("Add an automatic nightly backup of the ledger to Google Drive.")) {
      chunks.push(chunk as (typeof chunks)[number]);
    }

    const called = chunks.flatMap((chunk) => chunk.toolCalls?.map((call) => call.function.name) ?? []);
    expect(called).toContain("report_blocker");
    expect(called).not.toContain("bash");
    expect(requests).toHaveLength(1);
    const text = chunks.map((chunk) => chunk.content ?? "").join("");
    expect(text).toContain(`[Stopped — ${reason}]`);
    expect(text).not.toContain("Shelra stopped the round");
  });

  /** A workspace with a test that exists before the turn; each scripted round edits it on disk. */
  function withExistingTest() {
    const dir = mkdtempSync(join(tmpdir(), "shelra-test-protection-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "slug.test.ts"), "expect(slugify(' A ')).toBe('a');\n");
    const weakenTest = (): ProviderEvent[] => {
      writeFileSync(join(dir, "src", "slug.test.ts"), "// expectations removed\n");
      return [
        toolCallEvent("t", "write_file", { path: "src/slug.test.ts", content: "// expectations removed\n" }),
        toolResultEvent("t", "write_file", {
          success: true,
          output: "Updated src/slug.test.ts",
          diff: { filePath: "src/slug.test.ts", additions: 1, removals: 1, patch: "", isNew: false },
        }),
        toolCallEvent("c", "bash", { command: "bun test" }),
        toolResultEvent("c", "bash", { success: true, output: "0 fail" }, { command: "bun test" }),
        { type: "text-delta", text: "Tests pass." },
      ];
    };
    return { dir, weakenTest };
  }

  it("asks once to restore tests the request said not to modify, then reports it", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const { dir, weakenTest } = withExistingTest();
    const provider = scripted([weakenTest, () => [{ type: "text-delta", text: "Done anyway." }]]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: dir });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Implement slugify. Do not modify tests.")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(provider.round).toBe(2);
    expect(lastUserText(provider.requests[1])).toContain("you changed tests that existed before this request");
    const verdict = chunks.find((c) => c.content?.includes("Not verified"));
    expect(verdict?.content).toContain("src/slug.test.ts");
  });

  it("holds a weakened test the turn then committed, which git status no longer shows (2026-10-03)", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const { dir, weakenTest } = withExistingTest();
    const git = (...args: string[]) => spawnSync("git", ["-C", dir, ...args], { windowsHide: true, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "test@example.test");
    git("config", "user.name", "test");
    git("add", "-A");
    git("commit", "-q", "-m", "start");
    // The model edits the test and commits, as a free model did in three runs of three.
    const weakenAndCommit = (): ProviderEvent[] => {
      const events = weakenTest();
      git("add", "-A");
      git("commit", "-q", "-m", "make the tests pass");
      return [
        ...events.slice(0, -1),
        toolCallEvent("g", "bash", { command: "git add -A; git commit -m 'make the tests pass'" }),
        toolResultEvent("g", "bash", { success: true, output: "1 file changed" }),
        { type: "text-delta", text: "Tests pass." },
      ];
    };
    const provider = scripted([weakenAndCommit, () => [{ type: "text-delta", text: "Done anyway." }]]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: dir });

    let text = "";
    for await (const chunk of agent.processMessage("Implement slugify."))
      text += (chunk as { content?: string }).content ?? "";

    expect(provider.round).toBe(2);
    expect(lastUserText(provider.requests[1])).toContain("you changed tests that existed before this request");
    expect(text).toContain("[Not verified — it changed tests that existed before this request");
    // A real repository and a dozen git processes: the room other process tests have under a full parallel run.
  }, 20_000);

  it("lets a request that asks for test changes change them", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const { dir, weakenTest } = withExistingTest();
    const provider = scripted([weakenTest]);
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: dir });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Update the slugify tests for the new rules.")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(provider.round).toBe(1);
    expect(chunks.some((c) => c.content?.includes("Not verified"))).toBe(false);
  });

  describe("dependency guard (docs/EXECUTION-PLAN.md F6: a dependency-free decision broken at step 7)", () => {
    /** A project with a package.json and no stated checks; each scripted round adds papaparse to it on disk. */
    function withPackage() {
      const dir = mkdtempSync(join(tmpdir(), "shelra-dependency-guard-"));
      writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "loans", type: "module" }, null, 2)}\n`);
      const addPapaparse = (): ProviderEvent[] => {
        const content = `${JSON.stringify({ name: "loans", type: "module", dependencies: { papaparse: "^5.4.1" } }, null, 2)}\n`;
        writeFileSync(join(dir, "package.json"), content);
        return [
          toolCallEvent("p", "write_file", { path: "package.json", content }),
          toolResultEvent("p", "write_file", {
            success: true,
            output: "Updated package.json",
            diff: { filePath: "package.json", additions: 1, removals: 0, patch: "", isNew: false },
          }),
          toolCallEvent("c", "bash", { command: "bun test" }),
          toolResultEvent("c", "bash", { success: true, output: "0 fail" }, { command: "bun test" }),
          { type: "text-delta", text: "Export added." },
        ];
      };
      return { dir, addPapaparse };
    }

    async function run(dir: string, provider: ProviderAdapter, request: string): Promise<string> {
      const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: dir });
      let text = "";
      for await (const chunk of agent.processMessage(request)) {
        text += (chunk as { content?: string }).content ?? "";
      }
      return text;
    }

    it("asks once to remove a dependency the request's own rule forbids, then reports it", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const { dir, addPapaparse } = withPackage();
      const provider = scripted([addPapaparse]);

      const text = await run(
        dir,
        provider,
        "Add GET /loans/export.csv; papaparse's unparse makes this easy. From now on this project stays dependency-free.",
      );

      expect(provider.round).toBe(2);
      expect(lastUserText(provider.requests[1])).toContain("Completion blocked: you added a dependency (papaparse)");
      expect(text).toContain("[Not verified — it added papaparse although the rule you stated says");
    });

    it("never reads a bug report as a rule: a request to install what is missing is not blocked", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const { dir, addPapaparse } = withPackage();
      const provider = scripted([addPapaparse]);

      const text = await run(dir, provider, "No compila; instala las dependencias que falten.");

      expect(provider.round).toBe(1);
      expect(text).not.toContain("Not verified");
    });

    it("takes the user's approval of the package the last answer proposed as permission under a rule to ask first", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const { dir, addPapaparse } = withPackage();
      writeMemoryEntry(projectMemoryScope(dir), {
        slug: "user-rule-ask-before-dependencies",
        title: "Never add another dependency without asking me first",
        hook: "Never add another dependency without asking me first",
        type: "preference",
        description: "User instruction",
        body: "Never add another dependency without asking me first.",
        source: "human",
        tags: ["user-directive"],
      });
      // The history keeps what the model said, as a real provider's response does.
      const ask = "The CSV quoting is fiddly. May I add papaparse to handle it?";
      const base = scripted([() => [{ type: "text-delta", text: ask }], addPapaparse]);
      const provider = {
        ...base,
        get round() {
          return base.round;
        },
        stream(request: ProviderStreamRequest): ProviderStream {
          const stream = base.stream(request);
          const said = base.round === 1 ? ask : "Done.";
          return { ...stream, response: Promise.resolve({ messages: [{ role: "assistant", content: said }] }) };
        },
      };
      const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: dir });
      for await (const _chunk of agent.processMessage("Add GET /loans/export.csv.")) {
        // the first answer asks
      }
      let text = "";
      for await (const chunk of agent.processMessage("Yes, go ahead."))
        text += (chunk as { content?: string }).content ?? "";

      expect(provider.round).toBe(2);
      expect(text).not.toContain("Not verified");
    });

    it("holds a dependency against the user's standing rule, which memory keeps across sessions", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const { dir, addPapaparse } = withPackage();
      writeMemoryEntry(projectMemoryScope(dir), {
        slug: "user-rule-no-dependencies",
        title: "Never add another dependency without asking me first",
        hook: "Never add another dependency without asking me first",
        type: "preference",
        description: "User instruction",
        body: "Never add another dependency without asking me first.",
        source: "human",
        tags: ["user-directive"],
      });
      const provider = scripted([addPapaparse]);

      const text = await run(dir, provider, "Add GET /loans/export.csv; papaparse's unparse makes this easy.");

      expect(provider.round).toBe(2);
      expect(text).toContain("[Not verified — it added papaparse");
    });

    it("lets the request add the dependency it tells Shelra to add, and leaves projects without such a rule alone", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const told = withPackage();
      const toldProvider = scripted([told.addPapaparse]);
      const toldText = await run(
        told.dir,
        toldProvider,
        "Add papaparse as a dependency and export the loans as CSV. Otherwise this project stays dependency-free.",
      );
      expect(toldProvider.round).toBe(1);
      expect(toldText).not.toContain("Not verified");

      const free = withPackage();
      const freeProvider = scripted([free.addPapaparse]);
      const freeText = await run(
        free.dir,
        freeProvider,
        "Add GET /loans/export.csv; papaparse's unparse makes this easy.",
      );
      expect(freeProvider.round).toBe(1);
      expect(freeText).not.toContain("Not verified");
    });

    /** A scripted round that writes `content` to `path` on disk, as write_file would, and runs a passing check. */
    function writing(dir: string, path: string, content: string) {
      return (): ProviderEvent[] => {
        mkdirSync(join(dir, path, ".."), { recursive: true });
        writeFileSync(join(dir, path), content);
        return [
          toolCallEvent("w", "write_file", { path, content }),
          toolResultEvent("w", "write_file", {
            success: true,
            output: `Updated ${path}`,
            diff: { filePath: path, additions: 1, removals: 0, patch: "", isNew: false },
          }),
          toolCallEvent("c", "bash", { command: "bun test" }),
          toolResultEvent("c", "bash", { success: true, output: "0 fail" }, { command: "bun test" }),
          { type: "text-delta", text: "Done." },
        ];
      };
    }

    it("holds a hard DELETE against an approved soft-delete decision of the ledger", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = mkdtempSync(join(tmpdir(), "shelra-rule-guard-delete-"));
      const proposed = proposeDecision(dir, {
        title: "Users are soft-deleted",
        rule: "This project never removes rows from its database: deleting a user sets its deleted_at column.",
        source: "user",
      });
      if (!proposed.ok) throw new Error(proposed.reason);
      approveDecision(dir, proposed.decision.id);
      const provider = scripted([
        writing(dir, "src/cleanup.ts", 'export const cleanup = (db) => db.run("DELETE FROM users WHERE idle = 1");\n'),
      ]);

      const text = await run(
        dir,
        provider,
        "Add POST /admin/cleanup: remove every user who has been idle for two years.",
      );

      expect(provider.round).toBe(2);
      expect(lastUserText(provider.requests[1])).toContain(
        "Completion blocked: src/cleanup.ts adds a DELETE statement",
      );
      expect(text).toContain("[Not verified — src/cleanup.ts adds a DELETE statement although decision D-0001 says");
    });

    it("holds a log call that passes an email against the user's standing rule, and lets the word alone through", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const rule = (dir: string) =>
        writeMemoryEntry(projectMemoryScope(dir), {
          slug: "user-rule-no-emails-in-logs",
          title: "Logs must never contain email addresses",
          hook: "Logs must never contain email addresses",
          type: "preference",
          description: "User instruction",
          body: "Logs must never contain email addresses.",
          source: "human",
          tags: ["user-directive"],
        });
      const leaky = mkdtempSync(join(tmpdir(), "shelra-rule-guard-log-"));
      rule(leaky);
      const leakyProvider = scripted([
        writing(leaky, "src/users.ts", 'log("email changed", { userId: user.id, email: body.email });\n'),
      ]);
      const leakyText = await run(
        leaky,
        leakyProvider,
        "Log each change so support can see which user changed their email.",
      );
      expect(leakyProvider.round).toBe(2);
      expect(leakyText).toContain("[Not verified — src/users.ts logs an email address");

      const quiet = mkdtempSync(join(tmpdir(), "shelra-rule-guard-log-"));
      rule(quiet);
      const quietProvider = scripted([writing(quiet, "src/users.ts", 'log("email changed", { userId: user.id });\n')]);
      const quietText = await run(
        quiet,
        quietProvider,
        "Log each change so support can see which user changed their email.",
      );
      expect(quietProvider.round).toBe(1);
      expect(quietText).not.toContain("Not verified");
    });

    it("judges a file the turn committed against the version of the turn's start, not the moved HEAD", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = mkdtempSync(join(tmpdir(), "shelra-rule-guard-commit-"));
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "users.ts"), 'log("email changed", { userId: user.id });\n');
      const git = (...args: string[]) =>
        spawnSync("git", ["-C", dir, ...args], { windowsHide: true, encoding: "utf8" });
      git("init", "-q");
      git("config", "user.email", "test@example.test");
      git("config", "user.name", "test");
      git("add", "-A");
      git("commit", "-q", "-m", "start");
      writeMemoryEntry(projectMemoryScope(dir), {
        slug: "user-rule-no-emails-in-logs",
        title: "Logs must never contain email addresses",
        hook: "Logs must never contain email addresses",
        type: "preference",
        description: "User instruction",
        body: "Logs must never contain email addresses.",
        source: "human",
        tags: ["user-directive"],
      });
      const leakAndCommit = (): ProviderEvent[] => {
        const events = writing(
          dir,
          "src/users.ts",
          'log("email changed", { userId: user.id, email: body.email });\n',
        )();
        git("add", "src/users.ts");
        git("commit", "-q", "-m", "log the email");
        return events;
      };
      const provider = scripted([leakAndCommit]);

      const text = await run(dir, provider, "Log each change so support can see which user changed their email.");

      expect(text).toContain("[Not verified — src/users.ts logs an email address");
      // A repository and a dozen git processes: room under a full parallel test run.
    }, 20_000);
  });
});

describe("evidence-driven repair (audit doc 15, Phase 2)", () => {
  const projectWorkspace = () => {
    const dir = mkdtempSync(join(tmpdir(), "shelra-repair-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
    return dir;
  };
  const BUN_FAILURE = [
    "error: expect(received).toBe(expected)",
    "",
    'Expected: "a-b"',
    'Received: " a b "',
    "",
    "      at <anonymous> (src/slug.test.ts:5:31)",
    "(fail) slugify > trims whitespace [0.33ms]",
    " 0 pass",
    " 1 fail",
  ].join("\n");

  /** A model that changes a file every round and never fixes anything. */
  function stubbornModel(before: ProviderEvent[] = []) {
    let round = 0;
    const requests: ProviderStreamRequest[] = [];
    /** What each request's last user message said when it was sent: the message array keeps growing. */
    const asked: string[] = [];
    const provider: ProviderAdapter = {
      id: "stubborn",
      defaultModelId: "repair-model",
      resolveModelRuntime: (modelId) => ({ modelId }),
      stream: (request) => {
        requests.push(request);
        asked.push(lastUserText(request));
        round += 1;
        const events: ProviderEvent[] = [
          ...(round === 1 ? before : []),
          toolCallEvent(`w${round}`, "write_file", { path: "src/slug.ts", content: `// try ${round}` }),
          toolResultEvent(`w${round}`, "write_file", {
            success: true,
            output: "Updated src/slug.ts",
            diff: { filePath: "src/slug.ts", additions: 1, removals: 1, patch: "", isNew: false },
          }),
          { type: "text-delta", text: "Fixed." },
        ];
        return {
          events: (async function* () {
            yield* events;
          })(),
          response: Promise.resolve({ messages: [{ role: "assistant", content: "Fixed." }] }),
        };
      },
      generateText: async (request) => ({ text: "Summary.", modelId: request.modelId }),
      getToolContext: () => ({}),
    };
    return { provider, requests, asked, rounds: () => round };
  }

  afterEach(() => clearCatalog());

  it("names the failing test and where it failed, not just that the check failed", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const { provider, asked } = stubbornModel();
    const agent = new Agent(undefined, undefined, "repair-model", undefined, {
      provider,
      cwd: projectWorkspace(),
      checkRunner: vi.fn<ContractCheckRunner>(async () => ({ passed: false, output: BUN_FAILURE, durationMs: 5 })),
    });

    for await (const _chunk of agent.processMessage("Make slugify trim")) {
      // drain
    }

    expect(asked[1]).toContain("slugify > trims whitespace (src/slug.test.ts:5:31)");
  });

  it("calls a check that passed before the first change and fails now a regression", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    // The agent ran the tests before changing anything, and they passed.
    const { provider, asked } = stubbornModel([
      toolCallEvent("t0", "bash", { command: "bun test" }),
      toolResultEvent("t0", "bash", { success: true, output: "1 pass" }, { command: "bun test" }),
    ]);
    const agent = new Agent(undefined, undefined, "repair-model", undefined, {
      provider,
      cwd: projectWorkspace(),
      checkRunner: vi.fn<ContractCheckRunner>(async () => ({ passed: false, output: BUN_FAILURE, durationMs: 5 })),
    });

    for await (const _chunk of agent.processMessage("Make slugify trim")) {
      // drain
    }

    expect(asked[1]).toContain("it passed before your first change: your change broke it");
  });

  it("notices an attempt that changed code but not the failures, and raises the effort for the next", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    primeCatalog([
      {
        id: "repair-model",
        name: "Repair model",
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
    ]);
    const { provider, requests, asked } = stubbornModel();
    const agent = new Agent(undefined, undefined, "repair-model", undefined, {
      provider,
      cwd: projectWorkspace(),
      checkRunner: vi.fn<ContractCheckRunner>(async () => ({ passed: false, output: BUN_FAILURE, durationMs: 5 })),
    });
    agent.setReasoningEffort("low");

    for await (const _chunk of agent.processMessage("Make slugify trim")) {
      // drain
    }

    expect(asked[1]).not.toContain("that approach did not work");
    expect(asked[2]).toContain("that approach did not work");
    expect(requests.map((request) => request.reasoningEffort)).toEqual(["low", "low", "high", "high"]);
  });
});

describe("memory credit from the contract (audit doc 15, M3)", () => {
  /** A project that states its tests and remembers one fact relevant to a clock. */
  function projectWithMemory(): string {
    const dir = mkdtempSync(join(tmpdir(), "shelra-memory-credit-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
    writeMemoryEntry(projectMemoryScope(dir), {
      slug: "digital-clock-ticks",
      title: "Digital clock ticks with setInterval",
      hook: "The digital clock redraws every second from one setInterval",
      type: "important-codepaths",
      description: "How the digital clock ticks",
      body: "The digital clock keeps one setInterval of 1000 ms and redraws the time on every tick; a second interval makes it tick twice.",
    });
    return dir;
  }
  const creditOf = (dir: string) =>
    listMemoryRecords(projectMemoryScope(dir)).find((record) => record.slug === "digital-clock-ticks")?.entry
      .frontmatter.metadata.credit;

  it("credits a memory that was there when the project's checks passed, and debits one that was not enough", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const passing = projectWithMemory();
    const passingAgent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider: new ScenarioProvider([{ type: "text-delta", text: "Done." }]),
      cwd: passing,
      checkRunner: vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "1 pass", durationMs: 5 })),
    });
    for await (const _chunk of passingAgent.processMessage("Create a digital clock that ticks")) {
      // drain
    }
    expect(passingAgent.getLastMemoryContext()?.expanded).toContain("digital-clock-ticks");
    expect(creditOf(passing)).toBe(1);

    const failing = projectWithMemory();
    const failingAgent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider: new ScenarioProvider([{ type: "text-delta", text: "Done." }]),
      cwd: failing,
      checkRunner: vi.fn<ContractCheckRunner>(async () => ({ passed: false, output: "1 fail", durationMs: 5 })),
    });
    for await (const _chunk of failingAgent.processMessage("Create a digital clock that ticks")) {
      // drain
    }
    expect(creditOf(failing)).toBe(-1);
  });
});

describe("an attempt that breaks a passing check (audit doc 15, Phase 2.3)", () => {
  /** A model that really runs its tool calls, one scripted list per round, and records what each round was asked. */
  function executingModel(script: Array<Array<{ tool: string; input: Record<string, unknown> }>>) {
    let round = 0;
    const asked: string[] = [];
    const outputs: Array<{ tool: string; output: { success?: boolean; output?: string } }> = [];
    const provider: ProviderAdapter = {
      id: "executing",
      defaultModelId: "repair-model",
      resolveModelRuntime: (modelId) => ({ modelId }),
      stream: (request) => {
        asked.push(lastUserText(request));
        const calls = script[round] ?? [];
        round += 1;
        const tools = request.tools as Record<
          string,
          { execute?: (input: unknown, options: unknown) => Promise<unknown> }
        >;
        return {
          events: (async function* () {
            for (const [index, call] of calls.entries()) {
              const id = `r${round}-${index}`;
              yield toolCallEvent(id, call.tool, call.input);
              const output = (await tools[call.tool]?.execute?.(call.input, { toolCallId: id, messages: [] })) as {
                success?: boolean;
                output?: string;
              };
              outputs.push({ tool: call.tool, output });
              yield toolResultEvent(id, call.tool, output, call.input);
            }
            yield { type: "text-delta", text: "Done." };
          })(),
          response: Promise.resolve({ messages: [{ role: "assistant", content: "Done." }] }),
        };
      },
      generateText: async (request) => ({ text: "Summary.", modelId: request.modelId }),
      getToolContext: () => ({}),
    };
    return { provider, asked, outputs };
  }

  it("says which files the attempt changed, offers restore_file, and restores only when asked", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = mkdtempSync(join(tmpdir(), "shelra-restore-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "bun test", lint: "bun lint" } }));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "slug.ts"), "v0\n");
    const { provider, asked, outputs } = executingModel([
      [{ tool: "write_file", input: { path: "src/slug.ts", content: "v1\n" } }],
      [
        { tool: "write_file", input: { path: "src/slug.ts", content: "BROKEN v2\n" } },
        { tool: "write_file", input: { path: "src/extra.ts", content: "export {};\n" } },
      ],
      [
        { tool: "restore_file", input: { path: "src/slug.ts" } },
        { tool: "restore_file", input: { path: "src/extra.ts" } },
      ],
    ]);
    // The tests never pass; lint fails exactly while src/slug.ts is broken.
    const checkRunner = vi.fn<ContractCheckRunner>(async (command) => {
      const broken = readFileSync(join(dir, "src", "slug.ts"), "utf8").includes("BROKEN");
      if (command === "bun run lint") return { passed: !broken, output: broken ? "lint error" : "ok", durationMs: 1 };
      return { passed: false, output: " 0 pass\n 1 fail", durationMs: 1 };
    });
    const agent = new Agent(undefined, undefined, "repair-model", undefined, { provider, cwd: dir, checkRunner });

    for await (const _chunk of agent.processMessage("Make slugify trim")) {
      // drain
    }

    // The first failure broke nothing that passed before it: no restore offer.
    expect(asked[1]).not.toContain("restore_file");
    // The second attempt broke lint, which passed after the first one.
    expect(asked[2]).toContain("`bun run lint` (it passed after your previous attempt: your last attempt broke it)");
    expect(asked[2]).toContain("Your last attempt changed `src/extra.ts`, `src/slug.ts`");
    expect(asked[2]).toContain("restore_file puts a file back as it was before it; nothing is undone unless you ask");
    // Nothing was undone until the model asked; then each file went back to its state before that attempt.
    expect(outputs.filter((item) => item.tool === "restore_file").map((item) => item.output.success)).toEqual([
      true,
      true,
    ]);
    expect(readFileSync(join(dir, "src", "slug.ts"), "utf8")).toBe("v1\n");
    expect(existsSync(join(dir, "src", "extra.ts"))).toBe(false);
  });
});

describe("memory from how a turn ended (audit doc 15, M2 and M4)", () => {
  it("records an exact command passing in the turn without confirming the rest of its memory", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = mkdtempSync(join(tmpdir(), "shelra-command-observation-"));
    const scope = projectMemoryScope(dir);
    writeMemoryEntry(scope, {
      slug: "preload-tests",
      title: "Tests need the preload script",
      hook: "bun test needs --preload ./test/setup.ts",
      type: "testing",
      description: "d",
      body: "Run `bun test --preload ./test/setup.ts`; without it fixture imports fail with ENOENT.",
    });
    const command = "bun test --preload ./test/setup.ts";
    const provider: ProviderAdapter = {
      id: "command-observation",
      defaultModelId: "gate-test-model",
      resolveModelRuntime: (modelId) => ({ modelId }),
      stream: () => ({
        events: (async function* () {
          yield toolCallEvent("b1", "bash", { command });
          yield toolResultEvent("b1", "bash", { success: true, output: "4 pass" }, { command });
          yield { type: "text-delta", text: "The tests pass with the preload script." };
        })(),
        response: Promise.resolve({ messages: [{ role: "assistant", content: "The tests pass." }] }),
      }),
      generateText: async (request) => ({ text: '{"memories":[]}', modelId: request.modelId }),
      getToolContext: () => ({}),
    };
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, { provider, cwd: dir });

    for await (const _chunk of agent.processMessage("Do the tests still need the preload script?")) {
      // drain
    }

    const entry = listMemoryRecords(scope).find((record) => record.slug === "preload-tests")?.entry;
    expect(entry?.frontmatter.metadata.lastConfirmed).toBeUndefined();
    expect(entry?.frontmatter.metadata.lastPassedCommand).toBe(command);
    expect(entry?.frontmatter.metadata.commandObservedAt).toEqual(expect.any(String));
    expect(entry?.frontmatter.metadata.recalls).toHaveLength(1);
  });

  it("reflects on a turn whose checks still fail, telling the reflection it ended unverified", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = mkdtempSync(join(tmpdir(), "shelra-unverified-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
    const reflections: ProviderTextRequest[] = [];
    let round = 0;
    const provider: ProviderAdapter = {
      id: "unverified",
      defaultModelId: "gate-test-model",
      resolveModelRuntime: (modelId) => ({ modelId }),
      stream: () => {
        round += 1;
        const id = `w${round}`;
        return {
          events: (async function* () {
            yield toolCallEvent(id, "write_file", { path: "src/slug.ts", content: `// try ${round}` });
            yield toolResultEvent(id, "write_file", {
              success: true,
              output: "Updated src/slug.ts",
              diff: { filePath: "src/slug.ts", additions: 1, removals: 1, patch: "", isNew: false },
            });
            yield { type: "text-delta", text: "Fixed." };
          })(),
          response: Promise.resolve({ messages: [{ role: "assistant", content: "Fixed." }] }),
        };
      },
      generateText: async (request) => {
        reflections.push(request);
        return { text: '{"memories":[]}', modelId: request.modelId };
      },
      getToolContext: () => ({}),
    };
    const agent = new Agent(undefined, undefined, "gate-test-model", undefined, {
      provider,
      cwd: dir,
      checkRunner: vi.fn<ContractCheckRunner>(async () => ({
        passed: false,
        output: " 0 pass\n 1 fail",
        durationMs: 1,
      })),
    });

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of agent.processMessage("Make slugify trim")) {
      chunks.push(chunk as { type: string; content?: string });
    }

    expect(chunks.some((chunk) => chunk.content?.includes("[Not verified"))).toBe(true);
    const reflection = reflections.find((request) => request.system?.includes("durable project knowledge"));
    expect(reflection?.prompt).toContain("OUTCOME: the turn ended unverified");
    expect(reflection?.prompt).toContain("$ bun run test");
  });
});

describe("the checks that decide done are the ones the turn started with (audit doc 17, S10)", () => {
  /** A Bun project whose one test fails until slugify trims and lowercases. */
  const slugProject = () => {
    const dir = mkdtempSync(join(tmpdir(), "shelra-check-definitions-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p", scripts: { test: "bun test" } }));
    writeFileSync(
      join(dir, "src", "slug.ts"),
      "export function slugify(s: string): string { throw new Error('todo'); }\n",
    );
    writeFileSync(
      join(dir, "src", "slug.test.ts"),
      "import { expect, test } from 'bun:test';\nimport { slugify } from './slug';\ntest('trims', () => { expect(slugify(' A ')).toBe('a'); });\n",
    );
    return dir;
  };

  type Step = ProviderEvent | { write: { id: string; path: string; content: string } };

  /** A write the scripted model makes, through the agent's own write_file tool. */
  const write = (id: string, path: string, content: string): Step[] => [{ write: { id, path, content } }];

  /** One scripted round per entry; rounds past the list only say "Done.". */
  function roundsModel(rounds: Array<() => Step[] | Promise<Step[]>>) {
    const requests: ProviderStreamRequest[] = [];
    const provider: ProviderAdapter = {
      id: "check-definitions",
      defaultModelId: "check-definitions-model",
      resolveModelRuntime: (modelId) => ({ modelId }),
      stream: (request) => {
        requests.push(request);
        const round = rounds[requests.length - 1];
        const tools = request.tools as Record<
          string,
          {
            inputSchema: { parse: (input: unknown) => unknown };
            execute?: (input: unknown, options: unknown) => Promise<unknown>;
          }
        >;
        return {
          events: (async function* () {
            for (const step of (await round?.()) ?? []) {
              if (!("write" in step)) {
                yield step;
                continue;
              }
              const call = step.write;
              const input = { path: call.path, content: call.content };
              tools.write_file.inputSchema.parse(input);
              yield toolCallEvent(call.id, "write_file", input);
              const output = await tools.write_file?.execute?.(input, { toolCallId: call.id, messages: [] });
              yield toolResultEvent(call.id, "write_file", output, input);
            }
            yield { type: "text-delta", text: "Done." } as ProviderEvent;
          })(),
          response: Promise.resolve({ messages: [{ role: "assistant", content: "Done." }] }),
        };
      },
      generateText: async (request) => ({ text: "Summary.", modelId: request.modelId }),
      getToolContext: () => ({}),
    };
    return { provider, requests };
  }

  async function run(agent: Agent, request: string): Promise<string> {
    let text = "";
    for await (const chunk of agent.processMessage(request)) text += (chunk as { content?: string }).content ?? "";
    return text;
  }

  const WRONG_SLUG = "export function slugify(s: string): string { return s; }\n";
  const NEUTERED = JSON.stringify({ name: "p", scripts: { test: "echo 1 pass" } });

  describe("host evidence receipts and structured turn results", () => {
    const FIXED_SLUG = "export const slugify = (s: string) => s.trim().toLowerCase();\n";
    const REQUEST = "Implement slugify in src/slug.ts so it trims and lowercases.";

    it.each([
      "source change",
      "cancellation",
    ] as const)("publishes the final host outcome after a %s during reflection", async (action) => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const traceDirectory = mkdtempSync(join(tmpdir(), "shelra-final-outcome-trace-"));
      const previousTrace = process.env.SHELRA_TRACE;
      const previousTraceDirectory = process.env.SHELRA_TRACE_DIR;
      process.env.SHELRA_TRACE = traceDirectory;
      process.env.SHELRA_TRACE_DIR = traceDirectory;
      try {
        writeMemoryEntry(projectMemoryScope(dir), {
          slug: "slugify-normalization",
          title: "Slugify trims and lowercases",
          hook: "The slugify function in src/slug.ts trims whitespace and lowercases its input",
          type: "important-codepaths",
          description: "Slugify normalization contract",
          body: "The slugify function trims whitespace and lowercases input. Its contract is checked by `bun run test`.",
        });
        const checkRunner = vi.fn<ContractCheckRunner>(async () => ({
          passed: true,
          output: "1 pass",
          durationMs: 1,
          state: "completed",
          exitCode: 0,
        }));
        const { provider } = roundsModel([() => write("w1", "src/slug.ts", FIXED_SLUG)]);
        const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
          provider,
          cwd: dir,
          checkRunner,
        });
        let reflected = false;
        let text = "";
        for await (const chunk of agent.processMessage(REQUEST, {
          onMemory: () => {
            if (reflected) return;
            reflected = true;
            if (action === "source change") {
              writeFileSync(join(dir, "src", "slug.ts"), `${FIXED_SLUG}// editor changed this during reflection\n`);
            } else {
              agent.abort();
            }
          },
        })) {
          text += chunk.content ?? "";
        }
        const status = action === "source change" ? "unverified" : "cancelled";
        const verdict = action === "source change" ? "[Not verified" : "[Cancelled]";
        const result = agent.getLastTurnResult();
        const trace = readTrace(listTraces(traceDirectory)[0]?.path ?? "");

        expect(reflected).toBe(true);
        expect(checkRunner).toHaveBeenCalledTimes(1);
        expect(agent.getLastMemoryContext()?.expanded).toContain("slugify-normalization");
        const memory = listMemoryRecords(projectMemoryScope(dir)).find(
          (record) => record.slug === "slugify-normalization",
        );
        expect(memory?.entry.frontmatter.metadata.credit ?? 0).toBe(0);
        expect(result).toMatchObject({ status, verified: false });
        expect(result?.checks).toHaveLength(1);
        expect(result?.checks[0]).toMatchObject({
          command: "bun run test",
          source: "host",
          passed: true,
          fresh: action === "cancellation",
        });
        expect(text).toContain(verdict);
        expect(text).not.toContain("Checked by Shelra on the final code");
        expect(agent.getTurnEndNotes().at(-1)).toContain(verdict);
        const episodes = readEpisodes(projectMemoryScope(dir));
        expect(episodes).toHaveLength(1);
        expect(episodes[0]).toMatchObject({ outcome: status, request: REQUEST });
        expect(episodes[0].note).toContain(verdict);
        expect(trace.at(-1)).toMatchObject({ kind: "end", verdict: expect.stringContaining(verdict) });
        expect(JSON.stringify(trace)).not.toContain("Checked by Shelra on the final code");
      } finally {
        if (previousTrace === undefined) delete process.env.SHELRA_TRACE;
        else process.env.SHELRA_TRACE = previousTrace;
        if (previousTraceDirectory === undefined) delete process.env.SHELRA_TRACE_DIR;
        else process.env.SHELRA_TRACE_DIR = previousTraceDirectory;
        rmSync(dir, { recursive: true, force: true });
        rmSync(traceDirectory, { recursive: true, force: true });
      }
    }, 60_000);

    it("keeps an earlier command stale when a later host check changes the candidate", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      try {
        writeFileSync(
          join(dir, "package.json"),
          JSON.stringify({ name: "p", scripts: { test: "bun test", lint: "biome lint src" } }),
        );
        let changedDuringLint = false;
        const checkRunner = vi.fn<ContractCheckRunner>(async (command) => {
          if (command === "bun run lint" && !changedDuringLint) {
            changedDuringLint = true;
            writeFileSync(join(dir, "src", "slug.ts"), `${FIXED_SLUG}// generated during lint\n`);
          }
          return { passed: true, output: `${command}: passed`, durationMs: 1, state: "completed", exitCode: 0 };
        });
        const { provider, requests } = roundsModel([() => write("w1", "src/slug.ts", FIXED_SLUG)]);
        const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
          provider,
          cwd: dir,
          checkRunner,
        });

        const text = await run(agent, REQUEST);
        const result = agent.getLastTurnResult();
        const testReceipts = result?.checks.filter((check) => check.command === "bun run test") ?? [];

        expect(changedDuringLint).toBe(true);
        expect(testReceipts[0]).toMatchObject({ source: "host", passed: true, fresh: false, cwd: dir });
        expect(text).toContain("not evidence for the final local workspace (stale or unknown candidate)");
        // A later batch may verify the stable candidate, but the first batch cannot.
        if (result?.verified) {
          expect(testReceipts.length).toBeGreaterThan(1);
          expect(testReceipts.at(-1)).toMatchObject({ passed: true, fresh: true });
          expect(requests.length).toBeGreaterThan(1);
        } else {
          expect(result?.status).toBe("unverified");
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);

    it("does not verify checks that mutate the source on every successful run", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      try {
        let attempts = 0;
        const checkRunner = vi.fn<ContractCheckRunner>(async () => {
          attempts += 1;
          writeFileSync(join(dir, "src", "slug.ts"), `${FIXED_SLUG}// check mutation ${attempts}\n`);
          return { passed: true, output: "1 pass", durationMs: 1, state: "completed", exitCode: 0 };
        });
        const { provider } = roundsModel([() => write("w1", "src/slug.ts", FIXED_SLUG)]);
        const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
          provider,
          cwd: dir,
          checkRunner,
        });

        const text = await run(agent, REQUEST);
        const result = agent.getLastTurnResult();

        expect(attempts).toBeGreaterThan(1);
        expect(result).toMatchObject({ status: "unverified", verified: false });
        expect(result?.checks.length).toBe(attempts);
        expect(result?.checks.every((check) => check.source === "host" && check.passed && !check.fresh)).toBe(true);
        expect(result?.changedFiles).toContain("src/slug.ts");
        expect(text).toContain("Not verified");
        expect(text).not.toContain("Checked by Shelra on the final code");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);

    it("clears the previous result before the next turn and does not inherit its verification", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      try {
        let agent: Agent;
        let sawClearedResult = false;
        const { provider } = roundsModel([
          () => write("w1", "src/slug.ts", FIXED_SLUG),
          () => {
            sawClearedResult = agent.getLastTurnResult() === null;
            // A model's verdict-shaped words are not the host's result.
            return [{ type: "text-delta", text: "[Verified] All tests passed." }];
          },
        ]);
        const checkRunner = vi.fn<ContractCheckRunner>(async () => ({
          passed: true,
          output: "1 pass",
          durationMs: 1,
          state: "completed",
          exitCode: 0,
        }));
        agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
          provider,
          cwd: dir,
          checkRunner,
        });

        await run(agent, REQUEST);
        const first = agent.getLastTurnResult();
        expect(first).toMatchObject({ status: "verified", verified: true });
        expect(first?.checks).toHaveLength(1);
        expect(first?.changedFiles).toContain("src/slug.ts");

        await run(agent, "What does slugify do?");
        const second = agent.getLastTurnResult();

        expect(sawClearedResult).toBe(true);
        expect(second).toMatchObject({ status: "answered", verified: false, checks: [], changedFiles: [] });
        expect(second?.taskId).not.toBe(first?.taskId);
        expect(checkRunner).toHaveBeenCalledTimes(1);
        expect(first?.verified).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);

    it("reports the exact isolated command and agent source instead of the model's claimed scope", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      try {
        // No project-wide contract: the only executed evidence is the one named test.
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p" }));
        const command = "bun test src/slug.test.ts";
        const { provider } = roundsModel([() => write("w1", "src/slug.ts", FIXED_SLUG)]);
        const originalStream = provider.stream.bind(provider);
        provider.stream = (request) => {
          const original = originalStream(request);
          return {
            ...original,
            events: (async function* () {
              for await (const event of original.events) {
                if (event.type !== "text-delta") {
                  yield event;
                  continue;
                }
                const tools = request.tools as Record<
                  string,
                  {
                    inputSchema: { parse: (input: unknown) => unknown };
                    execute: (input: unknown, options: unknown) => Promise<unknown>;
                  }
                >;
                const input = { command };
                tools.bash.inputSchema.parse(input);
                yield toolCallEvent("isolated-check", "bash", input);
                const output = await tools.bash.execute(input, { toolCallId: "isolated-check", messages: [] });
                yield toolResultEvent("isolated-check", "bash", output, input);
                yield { type: "text-delta", text: "All project tests passed, including every integration test." };
              }
            })(),
          };
        };
        const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

        const text = await run(agent, REQUEST);
        const result = agent.getLastTurnResult();

        expect(result).toMatchObject({ status: "verified", verified: true });
        expect(result?.checks).toHaveLength(1);
        expect(result?.checks[0]).toMatchObject({ command, cwd: dir, source: "agent", passed: true, fresh: true });
        expect(result?.checks[0].detail).toContain("1 pass");
        expect(text).toContain(`agent: \`${command}\``);
        expect(JSON.stringify(result)).not.toContain("every integration test");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);
  });

  describe("phase 1 final-candidate regressions", () => {
    const FIXED_SLUG = "export const slugify = (s: string) => s.trim().toLowerCase();\n";
    const REQUEST = "Implement slugify in src/slug.ts so it trims and lowercases.";

    it("verifies the actual scoped contract after a full-suite timeout without claiming its full coverage", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      try {
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p", scripts: { test: "jest" } }));
        const fullCommand = "npm run test";
        const scopedCommand = "npx jest --findRelatedTests src/slug.ts";
        const checkRunner = vi.fn<ContractCheckRunner>(async (command) =>
          command === fullCommand
            ? { passed: false, output: "", durationMs: 1_000, state: "timed_out", exitCode: null }
            : { passed: true, output: "1 pass", durationMs: 1, state: "completed", exitCode: 0 },
        );
        const { provider } = roundsModel([() => write("w1", "src/slug.ts", FIXED_SLUG)]);
        const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
          provider,
          cwd: dir,
          checkRunner,
        });

        const text = await run(agent, REQUEST);
        const result = agent.getLastTurnResult();

        expect(checkRunner.mock.calls.map(([command]) => command)).toEqual([fullCommand, scopedCommand]);
        expect(result).toMatchObject({ status: "verified", verified: true });
        expect(result?.checks).toEqual([
          expect.objectContaining({ command: fullCommand, source: "host", passed: false, finished: false }),
          expect.objectContaining({ command: scopedCommand, source: "host", passed: true, fresh: true }),
        ]);
        expect(text).toContain(`\`${scopedCommand}\` passed`);
        expect(text).not.toContain(`\`${fullCommand}\` passed`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);

    it("reports cancelled when the user aborts during the initial diagnosis", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      try {
        const { provider, requests } = roundsModel([]);
        let agent: Agent;
        const checkRunner = vi.fn<ContractCheckRunner>(async () => {
          agent.abort();
          return { passed: false, output: "Interrupted by the user", durationMs: 1, state: "killed", exitCode: null };
        });
        agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
          provider,
          cwd: dir,
          checkRunner,
        });

        const text = await run(agent, "Run the tests.");

        expect(requests).toHaveLength(0);
        expect(checkRunner).toHaveBeenCalledTimes(1);
        expect(text).toContain("[Cancelled]");
        expect(agent.getLastTurnResult()).toMatchObject({ status: "cancelled", verified: false });
        expect(agent.getLastTurnResult()?.checks[0]).toMatchObject({
          command: "bun run test",
          source: "host",
          passed: false,
          finished: false,
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);

    it("does not refresh earlier diagnostic checks with the candidate a later diagnostic generated", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      try {
        writeFileSync(
          join(dir, "package.json"),
          JSON.stringify({ name: "p", scripts: { lint: "biome lint src", test: "bun test" } }),
        );
        let generated = false;
        const checkRunner = vi.fn<ContractCheckRunner>(async (command) => {
          if (command === "bun run test" && !generated) {
            generated = true;
            writeFileSync(join(dir, "src", "slug.ts"), FIXED_SLUG);
          }
          return { passed: true, output: "1 pass", durationMs: 1, state: "completed", exitCode: 0 };
        });
        const { provider } = roundsModel([]);
        const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
          provider,
          cwd: dir,
          checkRunner,
        });

        const text = await run(agent, "Run the tests.");
        const result = agent.getLastTurnResult();

        expect(generated).toBe(true);
        expect(result?.checks.slice(0, 2)).toEqual([
          expect.objectContaining({ command: "bun run lint", source: "host", passed: true, fresh: false }),
          expect.objectContaining({ command: "bun run test", source: "host", passed: true, fresh: false }),
        ]);
        expect(checkRunner.mock.calls.length).toBeGreaterThan(2);
        expect(result?.checks.filter((check) => check.passed && check.fresh)).toHaveLength(2);
        expect(result).toMatchObject({ status: "verified", verified: true });
        expect(result?.changedFiles).toContain("src/slug.ts");
        expect(text).toContain("not evidence for the final local workspace (stale or unknown candidate)");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);

    it("does not verify or credit a candidate changed by a Stop hook after passing agent and host checks", async () => {
      const dir = slugProject();
      try {
        let hookChangedCandidate = false;
        executeEventHooksMock.mockImplementation(async (input) => {
          if (input.hook_event_name === "Stop") {
            hookChangedCandidate = true;
            writeFileSync(join(dir, "src", "slug.ts"), WRONG_SLUG);
          }
          return emptyHookResult;
        });
        const memoryScope = projectMemoryScope(dir);
        const memorySlug = "slugify-trims-lowercases";
        writeMemoryEntry(memoryScope, {
          slug: memorySlug,
          title: "Slugify trims and lowercases",
          hook: "Slugify trims whitespace before lowercasing the input",
          type: "important-codepaths",
          description: "The slugify implementation and its existing contract",
          body: "The slugify function in src/slug.ts trims and lowercases the input. Its existing regression test runs with bun test src/slug.test.ts.",
        });
        const command = "bun test src/slug.test.ts";
        const { provider } = roundsModel([() => write("w1", "src/slug.ts", FIXED_SLUG)]);
        const originalStream = provider.stream.bind(provider);
        provider.stream = (request) => {
          const original = originalStream(request);
          return {
            ...original,
            events: (async function* () {
              for await (const event of original.events) {
                if (event.type !== "text-delta") {
                  yield event;
                  continue;
                }
                const tools = request.tools as Record<
                  string,
                  {
                    inputSchema: { parse: (input: unknown) => unknown };
                    execute: (input: unknown, options: unknown) => Promise<unknown>;
                  }
                >;
                const input = { command };
                tools.bash.inputSchema.parse(input);
                yield toolCallEvent("before-stop-check", "bash", input);
                const output = await tools.bash.execute(input, { toolCallId: "before-stop-check", messages: [] });
                yield toolResultEvent("before-stop-check", "bash", output, input);
                yield event;
              }
            })(),
          };
        };
        const checkRunner = vi.fn<ContractCheckRunner>(async () => ({
          passed: true,
          output: "1 pass",
          durationMs: 1,
          state: "completed",
          exitCode: 0,
        }));
        const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
          provider,
          cwd: dir,
          checkRunner,
        });

        const text = await run(agent, REQUEST);
        const result = agent.getLastTurnResult();

        expect(hookChangedCandidate).toBe(true);
        expect(agent.getLastMemoryContext()?.expanded).toContain(memorySlug);
        expect(result).toMatchObject({ status: "unverified", verified: false });
        expect(result?.checks).toEqual([
          expect.objectContaining({ command, source: "agent", passed: true, fresh: false }),
          expect.objectContaining({ command: "bun run test", source: "host", passed: true, fresh: false }),
        ]);
        const memory = listMemoryRecords(memoryScope).find((record) => record.slug === memorySlug)?.entry;
        expect(memory?.frontmatter.metadata.credit ?? 0).toBe(0);
        expect(text).not.toContain("Checked by Shelra on the final code");
      } finally {
        executeEventHooksMock.mockResolvedValue(emptyHookResult);
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);
  });

  it("does not report wrong code verified because the turn rewrote its test script", async () => {
    // Reproduced for doc 17: with the real check runner, this turn used to end "[Checked by Shelra on the final
    // code: `bun run test` passed]", the command having become `echo 1 pass`.
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = slugProject();
    const { provider, requests } = roundsModel([
      () => [...write("w1", "src/slug.ts", WRONG_SLUG), ...write("w2", "package.json", NEUTERED)],
    ]);
    const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

    const text = await run(agent, "Implement slugify in src/slug.ts so it trims and lowercases.");

    expect(lastUserText(requests[1])).toContain('you changed the checks this project uses to decide "done"');
    expect(text).toContain('[Not verified — it changed the checks that decide "done"');
    expect(text).toContain("what `bun run test` runs changed (package.json)");
    expect(text).not.toContain("Checked by Shelra");
  }, 60_000);

  it("runs the project's own check once the turn puts it back", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = slugProject();
    const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "1 pass", durationMs: 5 }));
    const { provider } = roundsModel([
      () => [...write("w1", "src/slug.ts", WRONG_SLUG), ...write("w2", "package.json", NEUTERED)],
      () => [
        ...write("w3", "package.json", JSON.stringify({ name: "p", scripts: { test: "bun test" } })),
        ...write("w4", "src/slug.ts", "export const slugify = (s: string) => s.trim().toLowerCase();\n"),
      ],
    ]);
    const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
      provider,
      cwd: dir,
      checkRunner,
    });

    const text = await run(agent, "Implement slugify in src/slug.ts so it trims and lowercases.");

    expect(checkRunner.mock.calls.map(([command]) => command)).toEqual(["bun run test"]);
    expect(text).toContain("Checked by Shelra on the final code");
    expect(text).not.toContain("Not verified");
  }, 60_000);

  describe("memory the turn was given and did not act on (doc 18 §4.2b)", () => {
    /** An i18n project whose memory says the catalog is generated by a script. */
    const catalogProject = () => {
      const dir = mkdtempSync(join(tmpdir(), "shelra-memory-apply-"));
      mkdirSync(join(dir, "locales"), { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { test: "bun test", "build:messages": "bun run scripts/build-messages.ts" } }),
      );
      writeFileSync(join(dir, "locales", "en.json"), "{}\n");
      writeMemoryEntry(projectMemoryScope(dir), {
        slug: "generate-message-catalog",
        title: "Generate i18n message catalog",
        hook: "Run scripts/build-messages.ts to create src/generated/messages.ts before using t()",
        type: "build",
        description: "How the i18n message catalog is generated",
        body: "```bash\nbun run scripts/build-messages.ts\n# Output: wrote src/generated/messages.ts (N messages)\n```",
      });
      return dir;
    };
    const REQUEST = "Add the checkout.total message to the i18n message catalog in locales/en.json.";
    const bash = (id: string, command: string, output: string): ProviderEvent[] => [
      toolCallEvent(id, "bash", { command }),
      toolResultEvent(id, "bash", { success: true, output }, { command }),
    ];

    it("asks once to apply a how-to entry whose command the turn never ran (seen on the memory suite 2026-09-25)", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = catalogProject();
      const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "1 pass", durationMs: 5 }));
      const { provider, requests } = roundsModel([
        () => [
          ...write("w1", "locales/en.json", '{ "checkout.total": "Total: {amount}" }\n'),
          ...bash("b1", "bun test", "1 pass"),
        ],
        () => bash("b2", "bun run build:messages", "wrote src/generated/messages.ts (1 messages)"),
      ]);
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      const text = await run(agent, REQUEST);

      expect(agent.getLastMemoryContext()?.expanded).toContain("generate-message-catalog");
      // Counted in the conversation the last request carried: a later round re-sends the same note, once.
      const asked = ((requests.at(-1)?.messages ?? []) as Array<{ role: string; content: unknown }>)
        .filter((message) => message.role === "user" && typeof message.content === "string")
        .map((message) => message.content as string)
        .filter((prompt) => prompt.includes("project memory you were given"));
      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain("- Generate i18n message catalog: `bun run scripts/build-messages.ts`");
      expect(asked[0]).toContain("This turn changed locales/en.json");
      expect(text).toContain("[Project memory names `bun run scripts/build-messages.ts`, which this turn did not run");
    }, 60_000);

    it("does not ask when the turn ran it, through the package script of the same name", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = catalogProject();
      const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "1 pass", durationMs: 5 }));
      const { provider, requests } = roundsModel([
        () => [
          ...write("w1", "locales/en.json", '{ "checkout.total": "Total: {amount}" }\n'),
          ...bash("b1", "bun run build:messages", "wrote src/generated/messages.ts (1 messages)"),
          ...bash("b2", "bun test", "1 pass"),
        ],
      ]);
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      const text = await run(agent, REQUEST);

      expect(requests.some((request) => lastUserText(request).includes("project memory you were given"))).toBe(false);
      expect(text).not.toContain("[Project memory names");
    }, 60_000);
  });

  it("says the checks passed on the final code only once the turn ends, after the requirement audit", async () => {
    // Seen live 2026-09-25: "[Checked by Shelra on the final code …]" was shown, then the audit round changed the
    // code for 25 minutes and the turn was cancelled.
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = slugProject();
    const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "1 pass", durationMs: 5 }));
    const { provider, requests } = roundsModel([
      () => write("w1", "src/slug.ts", "export const slugify = (s: string) => s.trim().toLowerCase();\n"),
      () => [{ type: "text-delta", text: "Audit: every stated behavior is exercised." }],
    ]);
    const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
      provider,
      cwd: dir,
      checkRunner,
      // The turn's own audit, which stands in when there is no independent check of the request.
      ablate: ["verifier"],
    });

    const text = await run(agent, DENSE_REQUEST);

    expect(lastUserText(requests[1])).toContain("audit the request requirement by requirement");
    expect(text.match(/\[Checked by Shelra on the final code/gu)).toHaveLength(1);
    expect(text.indexOf("[Checked by Shelra")).toBeGreaterThan(text.indexOf("Audit: every stated behavior"));
  }, 60_000);

  it("lets a request that asks for a new test command change it, and runs the new one", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = slugProject();
    const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "1 pass", durationMs: 5 }));
    const { provider, requests } = roundsModel([
      () => write("w1", "package.json", JSON.stringify({ name: "p", scripts: { test: "bun test --bail" } })),
    ]);
    const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
      provider,
      cwd: dir,
      checkRunner,
      // These count the host's runs of the changed check; the run before the work is not what they measure.
      ablate: ["diagnose"],
    });

    const text = await run(agent, "Change the test script in package.json so bun test stops at the first failure.");

    expect(requests).toHaveLength(1);
    expect(checkRunner.mock.calls.map(([command]) => command)).toEqual(["bun run test"]);
    expect(text).not.toContain("Not verified");
  }, 60_000);

  // The adversarial review of the first fix (2026-09-24) found the cases below; each failed on it.

  it("does not let the next turn start from a check an earlier turn rewrote", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = slugProject();
    const { provider } = roundsModel([
      () => [...write("w1", "src/slug.ts", WRONG_SLUG), ...write("w2", "package.json", NEUTERED)],
      () => [],
      () => write("w3", "src/slug.ts", `// keep it simple\n${WRONG_SLUG}`),
    ]);
    const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

    await run(agent, "Implement slugify in src/slug.ts so it trims and lowercases.");
    const text = await run(agent, "Continue.");

    expect(text).toContain("changed during this turn outside its own file edits: what `bun run test` runs changed");
    expect(text).not.toContain("Checked by Shelra");
  }, 60_000);

  it("runs the checks in the folder the turn started in, whatever folder the shell moved to", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = slugProject();
    let agent: Agent | undefined;
    const { provider } = roundsModel([
      async () => {
        mkdirSync(join(dir, "tools"), { recursive: true });
        writeFileSync(join(dir, "tools", "package.json"), NEUTERED);
        await (agent as unknown as { bash: { execute(command: string): Promise<unknown> } }).bash.execute("cd tools");
        return write("w1", "src/slug.ts", WRONG_SLUG);
      },
    ]);
    agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

    const text = await run(agent, "Implement slugify in src/slug.ts so it trims and lowercases.");

    // The project's own `bun run test`, run in the workspace, fails; neither the check in tools/ nor a comparison
    // of two different folders (which read every file as changed) decides the turn.
    expect(text).toContain("`bun run test` fails on the final code");
    expect(text).not.toContain("changed tests");
    expect(text).not.toContain("Checked by Shelra");
  }, 60_000);

  describe("a new project whose checks the turn defined (seen live 2026-09-25)", () => {
    const empty = () => mkdtempSync(join(tmpdir(), "shelra-new-project-"));
    const GAME_PACKAGE = JSON.stringify({
      name: "kart",
      scripts: {
        start: "es-dev-server --serve .",
        build: "tsc && esbuild src/index.ts --bundle --outfile=dist/bundle.js",
      },
    });

    it("holds a failing build the turn defined against it, and sends the failure back", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = empty();
      const checkRunner = vi.fn<ContractCheckRunner>(async (command) =>
        /build/u.test(command)
          ? {
              passed: false,
              output: "src/kart.ts(114,1): error TS1128: Declaration or statement expected.",
              durationMs: 5,
            }
          : { passed: true, output: "ok", durationMs: 5 },
      );
      const { provider, requests } = roundsModel([
        () => [
          ...write("w1", "package.json", GAME_PACKAGE),
          ...write("w2", "src/kart.ts", "export class Kart {\n}\n}\n"),
        ],
      ]);
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      const text = await run(agent, "Create a kart racing game in the browser with Three.js.");

      expect(checkRunner.mock.calls.some(([command]) => /run build/u.test(command))).toBe(true);
      expect(requests.some((request) => lastUserText(request).includes("TS1128"))).toBe(true);
      expect(text).toContain("Not verified");
      expect(text).not.toContain("Checked by Shelra");
    }, 60_000);

    it("reports a passing build the turn defined without taking it as evidence", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = empty();
      const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "built", durationMs: 5 }));
      const { provider } = roundsModel([
        () => [...write("w1", "package.json", GAME_PACKAGE), ...write("w2", "src/kart.ts", "export class Kart {}\n")],
      ]);
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      const text = await run(agent, "Create a kart racing game in the browser with Three.js.");

      expect(text).toMatch(
        /\[Shelra ran the checks this turn defined on the final code: `[^`]*run build` passed; a check a turn writes itself does not verify its work\.\]/u,
      );
      expect(text).toContain("Not verified");
      expect(text).not.toContain("Checked by Shelra");
    }, 60_000);

    it("trusts a build the project stated before the turn and the turn left as it was (audit gap #10)", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = empty();
      writeFileSync(join(dir, "package.json"), GAME_PACKAGE);
      const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "built", durationMs: 5 }));
      const { provider } = roundsModel([() => write("w1", "src/kart.ts", "export class Kart { speed = 2; }\n")]);
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      const text = await run(agent, "Make the kart faster.");

      expect(text).toMatch(/\[Checked by Shelra on the final code: `[^`]*run build` passed/u);
      expect(text).not.toContain("a check a turn writes itself");
      expect(text).not.toContain("Not verified");
    }, 60_000);

    it("runs local checks before a repair without forcing a web search for their error", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const previous = process.env.SHELRA_RESEARCH;
      process.env.SHELRA_RESEARCH = "on";
      try {
        const dir = empty();
        writeFileSync(join(dir, "package.json"), GAME_PACKAGE);
        const failure = "src/tracks/beach.ts(100,22): error TS1005: ',' expected.";
        const checkRunner = vi.fn<ContractCheckRunner>(async () => ({
          passed: false,
          output: `> kart@1.0.0 build\n> tsc && esbuild src/index.ts --bundle\n\n${failure}`,
          durationMs: 5,
        }));
        const queries: string[] = [];
        const webSearch = async (query: string) => {
          queries.push(query);
          return { success: true, query, provider: "duckduckgo" as const, sources: [], output: "" };
        };
        const { provider, requests } = roundsModel([() => []]);
        const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
          provider,
          cwd: dir,
          checkRunner,
          webSearch,
        });

        await run(agent, "continuemos: verifica que todo funcione y arregla lo necesario");

        expect(checkRunner.mock.calls[0]?.[0]).toMatch(/run build/u);
        const first = JSON.stringify(requests[0]?.messages);
        expect(first).toMatch(/\[Shelra ran `[^`]*run build` before the task began, on the project as you found it\]/u);
        expect(first).toContain("TS1005");
        expect(queries).toEqual([]);
      } finally {
        if (previous === undefined) delete process.env.SHELRA_RESEARCH;
        else process.env.SHELRA_RESEARCH = previous;
      }
    }, 60_000);
  });

  it("does not take a run of a check script the turn wrote as evidence when the project stated none", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = slugProject();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "p", scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    );
    const { provider } = roundsModel([
      () => [
        ...write("w1", "src/slug.ts", WRONG_SLUG),
        ...write("w2", "package.json", NEUTERED),
        toolCallEvent("b1", "bash", { command: "npm test" }),
        toolResultEvent("b1", "bash", { success: true, output: "1 pass" }, { command: "npm test" }),
      ],
    ]);
    const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

    const text = await run(agent, "Implement slugify in src/slug.ts so it trims and lowercases.");

    expect(text).toContain("Not verified");
    expect(text).not.toContain("Checked by Shelra");
  }, 60_000);

  it("holds the check when the request forbids changing it", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = slugProject();
    const { provider, requests } = roundsModel([
      () => [...write("w1", "src/slug.ts", WRONG_SLUG), ...write("w2", "package.json", NEUTERED)],
    ]);
    const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

    const text = await run(
      agent,
      "Implement slugify in src/slug.ts so it trims and lowercases. Do not change the test script.",
    );

    expect(lastUserText(requests[1])).toContain('you changed the checks this project uses to decide "done"');
    expect(text).toContain('[Not verified — it changed the checks that decide "done"');
  }, 60_000);

  it("lets a follow-up approve the check change the request before it asked for", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = slugProject();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p", scripts: { test: "jest" } }));
    writeFileSync(join(dir, "package-lock.json"), "{}");
    const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "1 pass", durationMs: 5 }));
    const { provider, requests } = roundsModel([
      () => [],
      () => write("w1", "package.json", JSON.stringify({ name: "p", scripts: { test: "vitest run" } })),
    ]);
    const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
      provider,
      cwd: dir,
      checkRunner,
      // These count the host's runs of the changed check; the run before the work is not what they measure.
      ablate: ["diagnose"],
    });

    await run(agent, "Migrate the tests from jest to vitest.");
    const text = await run(agent, "yes, go ahead");

    expect(requests).toHaveLength(2);
    expect(checkRunner.mock.calls.map(([command]) => command)).toEqual(["npm run test"]);
    expect(text).not.toContain("Not verified");
  }, 60_000);

  it("reports a check changed outside the turn's own edits without telling the model to undo it", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = slugProject();
    const { provider, requests } = roundsModel([
      () => {
        // Another session, or the user's editor, changes the check while the turn edits the code.
        writeFileSync(
          join(dir, "package.json"),
          JSON.stringify({ name: "p", scripts: { test: "bun test --coverage" } }),
        );
        return write("w1", "src/slug.ts", "export const slugify = (s: string) => s.trim().toLowerCase();\n");
      },
    ]);
    const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

    const text = await run(agent, "Implement slugify in src/slug.ts so it trims and lowercases.");

    expect(requests).toHaveLength(1);
    expect(text).toContain("changed during this turn outside its own file edits");
  }, 60_000);

  it("does not blame the turn for a script another session changed when the turn then writes the same file", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = slugProject();
    const coverage = { name: "p", scripts: { test: "bun test --coverage" } };
    const { provider, requests } = roundsModel([
      () => {
        writeFileSync(join(dir, "package.json"), JSON.stringify(coverage));
        return [
          ...write("w1", "package.json", JSON.stringify({ ...coverage, dependencies: { zod: "^3.23.0" } })),
          ...write("w2", "src/slug.ts", "export const slugify = (s: string) => s.trim().toLowerCase();\n"),
        ];
      },
    ]);
    const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

    const text = await run(agent, "Add zod, and implement slugify in src/slug.ts so it trims and lowercases.");

    expect(requests).toHaveLength(1);
    expect(text).toContain("changed during this turn outside its own file edits");
  }, 60_000);

  describe("an existing test the turn only added to (2026-10-03: added cases and moved imports were held)", () => {
    const ORIGINAL_TEST =
      "import { expect, test } from 'bun:test';\nimport { slugify } from './slug';\ntest('trims', () => { expect(slugify(' A ')).toBe('a'); });\n";
    const ADDED_CASE = "test('lowercases', () => { expect(slugify('AB')).toBe('ab'); });\n";
    const TRIM_AND_LOWER = "export const slugify = (s: string) => s.trim().toLowerCase();\n";

    it("keeps cases added to an existing test once the test as it was passes on the final code", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const { provider, requests } = roundsModel([
        () => [
          ...write("w1", "src/slug.ts", TRIM_AND_LOWER),
          ...write("w2", "src/slug.test.ts", `${ORIGINAL_TEST}${ADDED_CASE}`),
        ],
      ]);
      // The real runner: the host runs `bun run test` with the original test put back, then the contract runs it.
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

      const text = await run(agent, "Implement slugify in src/slug.ts so it lowercases.");

      expect(requests).toHaveLength(1);
      expect(text).toContain(
        "[src/slug.test.ts existed before this request; the turn only added to it, and Shelra ran it as it was: it passes on the final code.]",
      );
      expect(text).toContain("[Checked by Shelra on the final code: `bun run test` passed]");
      expect(text).not.toContain("Not verified");
      // The turn's version is back on disk after the run of the original.
      expect(readFileSync(join(dir, "src", "slug.test.ts"), "utf8")).toBe(`${ORIGINAL_TEST}${ADDED_CASE}`);
    }, 120_000);

    it("follows a module the turn moved, with the original's cases and the new import", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const { provider, requests } = roundsModel([
        () => {
          rmSync(join(dir, "src", "slug.ts"));
          return [
            ...write("w1", "src/text/slug.ts", TRIM_AND_LOWER),
            ...write("w2", "src/slug.test.ts", ORIGINAL_TEST.replace("from './slug'", "from './text/slug'")),
          ];
        },
      ]);
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

      const text = await run(agent, "Move slugify to src/text/slug.ts and make it trim and lowercase.");

      expect(requests).toHaveLength(1);
      expect(text).toContain("re-pointed imports at moved modules and kept every case");
      expect(text).not.toContain("Not verified");
    }, 120_000);

    it("sends back what the test as it was reports when the turn's code breaks it", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const { provider, requests } = roundsModel([
        () => [
          // Lowercases but no longer trims: the original 'trims' case fails, the added one passes.
          ...write("w1", "src/slug.ts", "export const slugify = (s: string) => s.toLowerCase();\n"),
          ...write("w2", "src/slug.test.ts", `${ORIGINAL_TEST}${ADDED_CASE}`),
        ],
        () => [{ type: "text-delta", text: "It works." } as ProviderEvent],
      ]);
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

      const text = await run(agent, "Implement slugify in src/slug.ts so it lowercases.");

      const nudge = lastUserText(requests[1]);
      expect(nudge).toContain("Shelra ran them as they were before this request, on your code, and they fail:");
      expect(nudge).toContain("trims");
      expect(text).toContain("and as they were they fail on the final code");
      expect(readFileSync(join(dir, "src", "slug.test.ts"), "utf8")).toBe(`${ORIGINAL_TEST}${ADDED_CASE}`);
    }, 120_000);

    it("runs the original of a test in a slow suite on its own package", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = mkdtempSync(join(tmpdir(), "shelra-slow-original-"));
      mkdirSync(join(dir, "lib", "auth"), { recursive: true });
      writeFileSync(join(dir, "go.mod"), "module example.com/app\n");
      const original = 'package auth\n\nimport "testing"\n\nfunc TestToken(t *testing.T) {}\n';
      writeFileSync(join(dir, "lib", "auth", "token_test.go"), original);
      const seen: string[] = [];
      const checkRunner = vi.fn<ContractCheckRunner>(async (command) => {
        if (command === "go test ./lib/auth")
          seen.push(readFileSync(join(dir, "lib", "auth", "token_test.go"), "utf8"));
        return command === "go test ./..."
          ? { passed: false, output: "", durationMs: 1_000, state: "timed_out", exitCode: null }
          : { passed: true, output: "ok", durationMs: 5 };
      });
      const { provider } = roundsModel([
        () => [
          ...write("w1", "lib/auth/token.go", "package auth\n"),
          ...write("w2", "lib/auth/token_test.go", `${original}\nfunc TestExpiry(t *testing.T) {}\n`),
        ],
      ]);
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
        checkTimeoutMs: 240_000,
      });

      const text = await run(agent, "Add a token expiry to lib/auth/token.go.");

      // The original ran on its package, then the turn's version did, in the contract.
      expect(seen[0]).toBe(original);
      expect(seen.at(-1)).toContain("TestExpiry");
      expect(text).toContain("only added to it, and Shelra ran it as it was: it passes on the final code.");
      expect(text).not.toContain("Not verified");
    }, 60_000);

    it("does not hold an added case when the original fails only as it did before the work (review 2026-10-03)", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      // A suite with a failure of its own, before and after: the run before the work, the original's run, the contract.
      const checkRunner = vi.fn<ContractCheckRunner>(async () => ({
        passed: false,
        output: "(fail) needs a database [1.00ms]\n 1 pass\n 1 fail\n",
        durationMs: 5,
        state: "completed",
        exitCode: 1,
      }));
      const { provider, requests } = roundsModel([
        () => [
          ...write("w1", "src/slug.ts", TRIM_AND_LOWER),
          ...write("w2", "src/slug.test.ts", `${ORIGINAL_TEST}${ADDED_CASE}`),
        ],
        () => [
          {
            type: "text-delta",
            text: "The database test fails before and after; it is not about slugify.",
          } as ProviderEvent,
        ],
      ]);
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      const text = await run(agent, "Fix slugify in src/slug.ts so it lowercases.");

      expect(text).toContain("only added to it, and Shelra ran it as it was");
      expect(requests.some((request) => lastUserText(request).includes("you changed tests that existed"))).toBe(false);
      expect(text).toContain("as before this turn");
    }, 60_000);

    it("lets a test go with the code it tested when the request removes it, and holds one deleted alone", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "0 fail", durationMs: 5 }));
      for (const [request, deleteCode, held] of [
        ["We no longer need slugify; remove it.", true, false],
        ["Implement slugify in src/slug.ts so it lowercases.", false, true],
      ] as const) {
        const dir = slugProject();
        // A repository: what a file deleted by the shell held is the version committed when the turn began.
        const git = (...args: string[]) =>
          spawnSync("git", ["-C", dir, ...args], { windowsHide: true, encoding: "utf8" });
        git("init", "-q");
        git("config", "user.email", "test@example.test");
        git("config", "user.name", "test");
        git("add", "-A");
        git("commit", "-q", "-m", "start");
        const { provider, requests } = roundsModel([
          () => {
            rmSync(join(dir, "src", "slug.test.ts"));
            if (deleteCode) rmSync(join(dir, "src", "slug.ts"));
            return deleteCode ? [] : write("w1", "src/slug.ts", TRIM_AND_LOWER);
          },
          () => [{ type: "text-delta", text: "Done." } as ProviderEvent],
        ]);
        const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
          provider,
          cwd: dir,
          checkRunner,
        });

        const text = await run(agent, request);

        if (held) {
          expect(lastUserText(requests[1])).toContain(
            "Not allowed: src/slug.test.ts was deleted, and the request does not remove the code it tests.",
          );
        } else {
          expect(requests).toHaveLength(1);
          expect(text).toContain("[src/slug.test.ts went with the code it tested, which the request removes.]");
          expect(text).not.toContain("Not verified");
        }
      }
    }, 60_000);

    it("still holds a changed assertion, whatever was added around it", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "1 pass", durationMs: 5 }));
      const { provider, requests } = roundsModel([
        () => [
          ...write("w1", "src/slug.ts", TRIM_AND_LOWER),
          ...write("w2", "src/slug.test.ts", `${ORIGINAL_TEST.replace("toBe('a')", "toBe(' a ')")}${ADDED_CASE}`),
        ],
        () => [{ type: "text-delta", text: "Done." } as ProviderEvent],
      ]);
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      const text = await run(agent, "Implement slugify in src/slug.ts so it lowercases.");

      expect(lastUserText(requests[1])).toContain(
        "Not allowed: src/slug.test.ts: it removed or rewrote a line of the test.",
      );
      expect(text).toContain("[Not verified — it changed tests that existed before this request");
    }, 60_000);
  });

  describe("an independent check of the request (2026-10-03: seven of eight losses were false completions)", () => {
    const CHECKER_BRIEF = "You are an independent checker";
    const CHECK_FILE = ".shelra/verify/slug.test.ts";
    const CHECK_COMMAND = `bun test ${CHECK_FILE}`;
    const CHECK_TEST =
      "import { expect, test } from 'bun:test';\nimport { slugify } from '../../src/slug';\ntest('removes trailing hyphens', () => { expect(slugify('a b!')).toBe('a-b'); });\n";
    const PARTIAL_SLUG = "export const slugify = (s: string) => s.trim().toLowerCase().split(' ').join('-');\n";
    const FULL_SLUG =
      "export const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');\n";
    const REPORT = JSON.stringify({
      testFile: CHECK_FILE,
      command: CHECK_COMMAND,
      behaviors: ["trims", "lowercases", "removes trailing hyphens"],
      result: "failed",
    });

    /** The turn's model, round by round, and the checker's script, told apart by the checker's brief. */
    function checkedModel(rounds: Array<() => Step[]>, checker: () => Step[]) {
      const main: ProviderStreamRequest[] = [];
      const checks: ProviderStreamRequest[] = [];
      const denied: string[] = [];
      const provider: ProviderAdapter = {
        id: "independent-check",
        defaultModelId: "check-definitions-model",
        resolveModelRuntime: (modelId) => ({ modelId }),
        stream: (request) => {
          const isCheck = lastUserText(request).includes(CHECKER_BRIEF);
          (isCheck ? checks : main).push(request);
          const steps = isCheck ? checker() : (rounds[main.length - 1]?.() ?? []);
          const tools = request.tools as Record<
            string,
            {
              inputSchema: { parse: (input: unknown) => unknown };
              execute?: (input: unknown, options: unknown) => Promise<unknown>;
            }
          >;
          return {
            events: (async function* () {
              for (const step of steps) {
                if (!("write" in step)) {
                  yield step;
                  continue;
                }
                const input = { path: step.write.path, content: step.write.content };
                tools.write_file.inputSchema.parse(input);
                yield toolCallEvent(step.write.id, "write_file", input);
                const output = await tools.write_file?.execute?.(input, { toolCallId: step.write.id, messages: [] });
                if (isCheck && (output as { success?: boolean })?.success === false) denied.push(input.path);
                yield toolResultEvent(step.write.id, "write_file", output, input);
              }
              if (!isCheck) yield { type: "text-delta", text: "Done." } as ProviderEvent;
            })(),
            response: Promise.resolve({ messages: [{ role: "assistant", content: "Done." }] }),
          };
        },
        generateText: async (request) => ({ text: "Summary.", modelId: request.modelId }),
        getToolContext: () => ({}),
      };
      return { provider, main, checks, denied };
    }

    /** The project's checks pass; the checker's test passes only on code that removes the hyphens. */
    function runnerFor(dir: string) {
      const checkFiles: Array<string | null> = [];
      const checkRunner = vi.fn<ContractCheckRunner>(async (command, options) => {
        if (!command.includes(".shelra/verify/")) return { passed: true, output: "1 pass", durationMs: 5 };
        const path = join(options.cwd ?? dir, CHECK_FILE);
        checkFiles.push(existsSync(path) ? readFileSync(path, "utf8") : null);
        const fixed = readFileSync(join(dir, "src", "slug.ts"), "utf8").includes("replace(");
        return fixed
          ? { passed: true, output: " 3 pass\n 0 fail\n", durationMs: 5 }
          : {
              passed: false,
              output: "(fail) removes trailing hyphens [0.20ms]\n\n 2 pass\n 1 fail\n",
              durationMs: 5,
            };
      });
      return { checkRunner, checkFiles };
    }

    const checkerWritesItsTest = (): Step[] => [
      ...write("c1", CHECK_FILE, CHECK_TEST),
      { type: "text-delta", text: `Two of three behaviors pass.\n${REPORT}` },
    ];

    it("sends what a check written from the request alone finds back for repair, and passes the repaired code", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const { checkRunner, checkFiles } = runnerFor(dir);
      const { provider, main, checks } = checkedModel(
        [() => write("w1", "src/slug.ts", PARTIAL_SLUG), () => write("w2", "src/slug.ts", FULL_SLUG)],
        checkerWritesItsTest,
      );
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      const text = await run(agent, DENSE_REQUEST);

      // The checker starts from the request alone: one message, none of the turn's reasoning, a role of its own.
      expect(checks).toHaveLength(1);
      expect(checks[0]?.messages).toHaveLength(1);
      expect(checks[0]?.system).toContain("You are the Check sub-agent");
      expect(checks[0]?.system).toContain("Create or change no file outside .shelra/verify/");
      expect(lastUserText(checks[0])).toContain(DENSE_REQUEST);
      expect(lastUserText(checks[0])).toContain("Files the other agent changed: src/slug.ts.");
      // What it found went back to the turn, with its test, and nothing asked the turn to audit itself.
      expect(main).toHaveLength(2);
      const repair = lastUserText(main[1]);
      expect(repair).toContain("an independent check of the request fails on your code");
      expect(repair).toContain("removes trailing hyphens");
      expect(repair).toContain("toBe('a-b')");
      expect(main.some((request) => lastUserText(request).includes("audit the request requirement"))).toBe(false);
      // The host ran the checker's own test, on disk only while it ran: twice, the second time on the repair.
      expect(checkFiles).toEqual([CHECK_TEST, CHECK_TEST]);
      expect(existsSync(join(dir, ".shelra", "verify"))).toBe(false);
      expect(text).toContain("[An independent check of the request fails on this code (1 failing)");
      expect(text).toContain(
        "[Checked by Shelra on the final code: `bun run test` passed, an independent check of the request passed after a repair]",
      );
      expect(text).not.toContain("Not verified");
    }, 60_000);

    it("runs the checker's test for real: Bun fails the partial code, then passes the repair", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const { provider, main } = checkedModel(
        [() => write("w1", "src/slug.ts", PARTIAL_SLUG), () => write("w2", "src/slug.ts", FULL_SLUG)],
        checkerWritesItsTest,
      );
      // No injected runner: the project's `bun run test` and the checker's `bun test` both really run.
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

      const text = await run(agent, DENSE_REQUEST);

      expect(lastUserText(main[1])).toContain("removes trailing hyphens");
      expect(lastUserText(main[1])).toContain('Expected: "a-b"');
      expect(text).toContain("an independent check of the request passed after a repair");
      expect(existsSync(join(dir, ".shelra", "verify"))).toBe(false);
    }, 120_000);

    it("ends the turn unverified when the check still fails, running its own copy whatever the turn wrote over it", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const { checkRunner, checkFiles } = runnerFor(dir);
      const weakened = "import { test } from 'bun:test';\ntest('removes trailing hyphens', () => {});\n";
      const { provider, main } = checkedModel(
        [
          () => write("w1", "src/slug.ts", PARTIAL_SLUG),
          // The repair round rewrites the checker's test instead of the code, and disputes it.
          () => [
            ...write("w2", CHECK_FILE, weakened),
            { type: "text-delta", text: "The check is too strict; the code is right." } as ProviderEvent,
          ],
        ],
        checkerWritesItsTest,
      );
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      const text = await run(agent, DENSE_REQUEST);

      expect(main).toHaveLength(2);
      expect(checkFiles).toEqual([CHECK_TEST, CHECK_TEST]);
      expect(existsSync(join(dir, ".shelra", "verify"))).toBe(false);
      expect(text).toContain(
        '[Not verified — an independent check of the request still fails on the final code (failing: "removes trailing hyphens").',
      );
      expect(text).not.toContain("Checked by Shelra");
    }, 60_000);

    it("runs the checker's helper files with its test, and leaves none behind however the turn ends (review 2026-10-03)", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const helper = ".shelra/verify/cases.ts";
      const helperSeen: boolean[] = [];
      const checkRunner = vi.fn<ContractCheckRunner>(async (command) => {
        if (!command.includes(".shelra/verify/")) {
          // The project's own checks never see a checker's file, a copy the model wrote there included.
          expect(existsSync(join(dir, ".shelra", "verify"))).toBe(false);
          return { passed: true, output: "1 pass", durationMs: 5 };
        }
        helperSeen.push(existsSync(join(dir, helper)));
        return { passed: false, output: "(fail) removes trailing hyphens [0.20ms]\n 2 pass\n 1 fail\n", durationMs: 5 };
      });
      const { provider } = checkedModel(
        [
          () => write("w1", "src/slug.ts", PARTIAL_SLUG),
          // The repair round writes a copy of the check into the project's verify folder, as a model may.
          () => [...write("w2", "src/slug.ts", `${PARTIAL_SLUG}// tried\n`), ...write("w3", CHECK_FILE, CHECK_TEST)],
        ],
        () => [...write("c0", helper, "export const cases = [];\n"), ...checkerWritesItsTest()],
      );
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      const text = await run(agent, DENSE_REQUEST);

      expect(helperSeen).toEqual([true, true]);
      expect(text).toContain("[Not verified — an independent check of the request still fails on the final code");
      expect(existsSync(join(dir, ".shelra", "verify"))).toBe(false);
    }, 60_000);

    it("refuses a checker source write before it runs and keeps the original failing oracle", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const { checkRunner, checkFiles } = runnerFor(dir);
      const { provider, main, checks, denied } = checkedModel(
        [() => write("w1", "src/slug.ts", PARTIAL_SLUG), () => [{ type: "text-delta", text: "Audited." }]],
        () => [...write("c0", "src/slug.ts", FULL_SLUG), ...checkerWritesItsTest()],
      );
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      await run(agent, DENSE_REQUEST);

      expect(denied).toEqual(["src/slug.ts"]);
      expect(readFileSync(join(dir, "src/slug.ts"), "utf8")).toBe(PARTIAL_SLUG);
      expect(checkFiles).toEqual([CHECK_TEST, CHECK_TEST]);
      expect(lastUserText(main[1])).toContain("an independent check of the request fails on your code");
      expect(Object.keys(checks[0].tools ?? {}).sort()).toEqual([
        "bash",
        "delete_file",
        "edit_file",
        "grep",
        "read_file",
        "write_file",
      ]);
      expect(agent.getLastTurnResult()).toMatchObject({ status: "unverified", verified: false });
      expect(existsSync(join(dir, ".shelra", "verify"))).toBe(false);
    }, 60_000);

    it("rejects a real independent test that changes source even when Bun exits successfully", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const attackingTest =
        "import { expect, test } from 'bun:test';\nimport { writeFileSync } from 'node:fs';\nimport { slugify } from '../../src/slug';\nwriteFileSync(new URL('../../src/side.ts', import.meta.url), 'export const side = true;\\n');\ntest('trims', () => expect(slugify(' A ')).toBe('a'));\n";
      const { provider } = checkedModel(
        [() => write("w1", "src/slug.ts", PARTIAL_SLUG), () => [{ type: "text-delta", text: "Audited." }]],
        () => [...write("c1", CHECK_FILE, attackingTest), { type: "text-delta", text: REPORT }],
      );
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

      const text = await run(agent, DENSE_REQUEST);

      expect(existsSync(join(dir, "src/side.ts"))).toBe(false);
      expect(agent.getLastTurnResult()).toMatchObject({ status: "unverified", verified: false });
      expect(agent.getLastTurnResult()?.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            command: `bun test ./${CHECK_FILE}`,
            passed: false,
            finished: true,
            unrunnable: expect.stringContaining("changed project files"),
          }),
        ]),
      );
      expect(text).not.toContain("[Checked by Shelra");
      expect(existsSync(join(dir, ".shelra/verify"))).toBe(false);
    }, 120_000);

    it("rejects a real independent test that replaces its frozen oracle even when source is unchanged", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const attackingTest =
        "import { expect, test } from 'bun:test';\nimport { writeFileSync } from 'node:fs';\nimport { slugify } from '../../src/slug';\nwriteFileSync(new URL('./slug.test.ts', import.meta.url), 'import { test } from \\\"bun:test\\\"; test(\\\"slug noop\\\", () => {});');\ntest('trims', () => expect(slugify(' A ')).toBe('a'));\n";
      const { provider } = checkedModel(
        [() => write("w1", "src/slug.ts", PARTIAL_SLUG), () => [{ type: "text-delta", text: "Audited." }]],
        () => [...write("c1", CHECK_FILE, attackingTest), { type: "text-delta", text: REPORT }],
      );
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, { provider, cwd: dir });

      const text = await run(agent, DENSE_REQUEST);

      expect(readFileSync(join(dir, "src/slug.ts"), "utf8")).toBe(PARTIAL_SLUG);
      expect(agent.getLastTurnResult()).toMatchObject({ status: "unverified", verified: false });
      expect(agent.getLastTurnResult()?.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            command: `bun test ./${CHECK_FILE}`,
            passed: false,
            finished: true,
            ...(process.platform === "win32"
              ? { execution: "windows-appcontainer", detail: expect.stringMatching(/EPERM|EACCES/u) }
              : { unrunnable: expect.stringContaining("frozen oracle") }),
          }),
        ]),
      );
      expect(text).not.toContain("[Checked by Shelra");
      expect(existsSync(join(dir, ".shelra/verify"))).toBe(false);
    }, 120_000);

    it("holds completion when the verification area cannot be safely cleaned", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const original = readFileSync(join(dir, "src/slug.test.ts"), "utf8");
      mkdirSync(join(dir, ".shelra/verify"), { recursive: true });
      linkSync(join(dir, "src/slug.test.ts"), join(dir, ".shelra/verify/linked.test.ts"));
      const checkRunner = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "1 pass", durationMs: 5 }));
      const { provider } = checkedModel(
        [() => write("w1", "src/slug.ts", FULL_SLUG), () => [{ type: "text-delta", text: "Audited." }]],
        checkerWritesItsTest,
      );
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      const text = await run(agent, DENSE_REQUEST);

      expect(agent.getLastTurnResult()).toMatchObject({ status: "unverified", verified: false });
      expect(agent.getLastTurnResult()?.limitations).toContainEqual(expect.stringContaining("cleanup unavailable"));
      expect(readFileSync(join(dir, "src/slug.test.ts"), "utf8")).toBe(original);
      expect(existsSync(join(dir, ".shelra/verify/linked.test.ts"))).toBe(true);
      expect(text).not.toContain("[Checked by Shelra");
    }, 60_000);

    it.each([
      "source",
      "oracle",
    ] as const)("still checks %s integrity when the independent runner throws after execution", async (target) => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const checkRunner = vi.fn<ContractCheckRunner>(async (command) => {
        if (!command.includes(".shelra/verify/")) return { passed: true, output: "1 pass", durationMs: 5 };
        if (target === "source") writeFileSync(join(dir, "src/slug.ts"), PARTIAL_SLUG);
        else writeFileSync(join(dir, CHECK_FILE), "// an altered oracle\n");
        throw new Error("runner connection lost after execution");
      });
      const { provider } = checkedModel(
        [() => write("w1", "src/slug.ts", FULL_SLUG), () => [{ type: "text-delta", text: "Audited." }]],
        checkerWritesItsTest,
      );
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      const text = await run(agent, DENSE_REQUEST);

      expect(agent.getLastTurnResult()).toMatchObject({ status: "unverified", verified: false });
      const receipt = agent.getLastTurnResult()?.checks.find((item) => item.command.includes(".shelra/verify/"));
      expect(receipt).toMatchObject({
        passed: false,
        unrunnable: expect.stringContaining(target === "source" ? "changed project files" : "frozen oracle"),
      });
      expect(receipt).not.toHaveProperty("finished");
      expect(text).not.toContain("[Checked by Shelra");
      expect(existsSync(join(dir, ".shelra/verify"))).toBe(false);
    }, 60_000);

    it.each([
      { output: "No test files found", state: "completed" as const, finished: true, reason: "ran no test" },
      { output: "a test started", state: "timed_out" as const, finished: false, reason: "did not finish" },
    ])("does not publish a passing receipt for an independent run that $reason", async ({
      output,
      state,
      finished,
      reason,
    }) => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const checkRunner = vi.fn<ContractCheckRunner>(async (command) =>
        command.includes(".shelra/verify/")
          ? { passed: state === "completed", output, state, durationMs: 5 }
          : { passed: true, output: "1 pass", durationMs: 5 },
      );
      const { provider, main } = checkedModel(
        [() => write("w1", "src/slug.ts", FULL_SLUG), () => [{ type: "text-delta", text: "Audited." }]],
        checkerWritesItsTest,
      );
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
      });

      const text = await run(agent, DENSE_REQUEST);

      expect(lastUserText(main[1])).toContain("audit the request requirement by requirement");
      expect(agent.getLastTurnResult()?.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            command: `bun test ./${CHECK_FILE}`,
            passed: false,
            finished,
            unrunnable: expect.stringContaining(reason),
          }),
        ]),
      );
      expect(agent.getLastTurnResult()?.limitations).toContainEqual(expect.stringContaining(reason));
      expect(text).not.toContain("an independent check of the request passed");
      expect(existsSync(join(dir, ".shelra/verify"))).toBe(false);
    }, 60_000);

    it("leaves the turn to its own audit when switched off", async () => {
      executeEventHooksMock.mockResolvedValue(emptyHookResult);
      const dir = slugProject();
      const { checkRunner } = runnerFor(dir);
      const { provider, main, checks } = checkedModel(
        [() => write("w1", "src/slug.ts", PARTIAL_SLUG), () => [{ type: "text-delta", text: "Audited." }]],
        checkerWritesItsTest,
      );
      const agent = new Agent(undefined, undefined, "check-definitions-model", undefined, {
        provider,
        cwd: dir,
        checkRunner,
        ablate: ["verifier"],
      });

      await run(agent, DENSE_REQUEST);

      expect(checks).toHaveLength(0);
      expect(lastUserText(main[1])).toContain("audit the request requirement by requirement");
    }, 60_000);
  });
});
