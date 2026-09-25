import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ContractCheckRunner } from "../contract/contract";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import { listMemoryRecords, projectMemoryScope, writeMemoryEntry } from "../memory/store";
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
  it("re-confirms an entry whose exact command passed in the turn", async () => {
    executeEventHooksMock.mockResolvedValue(emptyHookResult);
    const dir = mkdtempSync(join(tmpdir(), "shelra-reconfirm-"));
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
      id: "reconfirm",
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
    expect(entry?.frontmatter.metadata.lastConfirmed).toEqual(expect.any(String));
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
          { execute?: (input: unknown, options: unknown) => Promise<unknown> }
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
});
