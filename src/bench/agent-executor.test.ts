import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
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
 * Proves the product-path benchmark executor measures what `Agent.processMessage()` actually
 * did: it counts real tool activity from the turn, grades the finished workspace with the
 * benchmark-owned oracle afterwards, and scores self-verification from the commands the agent
 * itself ran — never from the model's own claims.
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
  SessionStore: class {},
}));

vi.mock("../hooks/index", () => {
  // Tool hooks fire when a tool really runs (the proposing model below); none is configured.
  const noToolHooks = async () => ({
    blocked: false,
    blockingErrors: [],
    preventContinuation: false,
    additionalContexts: [],
    results: [],
  });
  return {
    executeEventHooks: executeEventHooksMock,
    executePreToolHooks: noToolHooks,
    executePostToolHooks: noToolHooks,
    executePostToolFailureHooks: noToolHooks,
  };
});

vi.mock("../exec/browser", () => ({
  observePage: vi.fn(async () => {
    throw new Error("browser not available in this test");
  }),
}));

import { listDecisions } from "../ledger/store";
import type { Decision } from "../ledger/types";
import { createAgentBenchmarkExecutor, simulatedDecisionApproval } from "./agent-executor";
import type { BenchmarkTaskDefinition } from "./types";

const emptyHookResult: AggregatedHookResult = {
  blocked: false,
  blockingErrors: [],
  preventContinuation: false,
  additionalContexts: [],
  results: [],
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

class ScriptedProvider implements ProviderAdapter {
  readonly id = "bench-executor-test";
  readonly defaultModelId = "bench-test-model";
  rounds = 0;
  lastRequest: ProviderStreamRequest | null = null;

  constructor(private readonly events: ProviderEvent[]) {}

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return {
      modelId,
      modelInfo: {
        id: modelId,
        name: "Bench test model",
        contextWindow: 32_768,
        inputPrice: 0,
        outputPrice: 0,
        reasoning: false,
        description: "Test-only provider",
        supportsClientTools: true,
        supportsMaxOutputTokens: true,
      },
    };
  }

  stream(request: ProviderStreamRequest): ProviderStream {
    this.rounds += 1;
    this.lastRequest = request;
    const events = this.events;
    return {
      events: (async function* () {
        request.onStepStart?.(1);
        yield* events;
        request.onStepFinish?.({
          stepNumber: 1,
          finishReason: "stop",
          usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
        });
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

const PLAN_RESULT = {
  success: true,
  output: "Plan: slugify",
  plan: {
    title: "slugify",
    summary: "Implement slugify",
    goal: "slugify works",
    requirements: ["trim", "lowercase"],
    acceptanceCriteria: [{ id: "AC1", description: "tests pass", verification: "bun test" }],
    steps: [{ title: "Implement", description: "write src/slug.ts", satisfies: ["AC1"] }],
  },
};

let workspace: string;

beforeEach(() => {
  executeEventHooksMock.mockResolvedValue(emptyHookResult);
  workspace = mkdtempSync(join(tmpdir(), "shelra-agent-bench-"));
  mkdirSync(join(workspace, "src"), { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function task(overrides: Partial<BenchmarkTaskDefinition> = {}): BenchmarkTaskDefinition {
  return {
    id: "01-slugify",
    category: "coding",
    difficulty: "easy",
    prompt: "Implement slugify in src/slug.ts and run bun test before completing.",
    workspace,
    acceptanceCriteria: [
      { id: "AC-FILE", description: "slug.ts exists", check: { kind: "file_exists", path: "src/slug.ts" } },
      {
        id: "AC-TESTS",
        description: "the visible test command succeeds",
        check: { kind: "command_succeeds", command: "bun --version", timeoutMs: 30_000 },
      },
      {
        id: "AC-ORACLE",
        description: "hidden oracle",
        check: { kind: "command_succeeds", command: "bun run {{benchmarkRoot}}/oracle.ts", timeoutMs: 30_000 },
        required: false,
      },
    ],
    ...overrides,
  };
}

describe("agent benchmark executor", () => {
  async function verificationAfter(commands: string[]): Promise<number | undefined> {
    writeFileSync(join(workspace, "src", "slug.ts"), "export function slugify() {}\n");
    writeFileSync(
      join(workspace, "package.json"),
      JSON.stringify({ scripts: { test: "bun --version", lint: "echo ok" } }),
    );
    const provider = new ScriptedProvider([
      ...commands.flatMap((command, index) => [
        toolCallEvent(`c${index}`, "bash", { command }),
        toolResultEvent(`c${index}`, "bash", { success: true, output: "ok" }, { command }),
      ]),
      { type: "text-delta", text: "Done." },
    ]);
    const executor = createAgentBenchmarkExecutor({
      provider,
      modelId: "bench-test-model",
      benchmarkRoot: workspace,
      persistSession: false,
    });
    const execution = await executor.executeTask(task(), { emit: () => {} });
    return execution.scores?.verification;
  }

  it("credits a visible check the agent ran through the project's own script", async () => {
    // AC-TESTS is `bun --version`; package.json's test script runs exactly that, so `bun run test` ran it.
    expect(await verificationAfter(["bun run test"])).toBe(100);
  });

  it("does not credit a different script for the visible check", async () => {
    expect(await verificationAfter(["bun run lint", "npm run build"])).toBe(0);
  });

  it("drives the real agent turn, then grades the workspace with the benchmark oracle", async () => {
    writeFileSync(join(workspace, "src", "slug.ts"), "export function slugify() {}\n");
    const provider = new ScriptedProvider([
      toolCallEvent("c1", "generate_plan", {}),
      toolResultEvent("c1", "generate_plan", PLAN_RESULT),
      toolCallEvent("c2", "write_file", { path: "src/slug.ts", content: "..." }),
      toolResultEvent("c2", "write_file", {
        success: true,
        output: "Updated src/slug.ts",
        diff: { filePath: "src/slug.ts", additions: 1, removals: 0, patch: "", isNew: false },
      }),
      toolCallEvent("c3", "bash", { command: "bun test" }),
      toolResultEvent("c3", "bash", { success: true, output: "1 pass" }, { command: "bun test" }),
      toolCallEvent("c4", "bash", { command: "bun --version" }),
      toolResultEvent("c4", "bash", { success: true, output: "1.4.1" }, { command: "bun --version" }),
      { type: "text-delta", text: "Implemented and verified." },
    ]);
    const executor = createAgentBenchmarkExecutor({
      provider,
      modelId: "bench-test-model",
      benchmarkRoot: workspace,
      persistSession: false,
    });
    const notices: string[] = [];

    const execution = await executor.executeTask(task(), { emit: (notice) => notices.push(notice.type) });

    expect(provider.rounds).toBe(1);
    expect(execution.status).toBe("passed");
    expect(execution.scores).toEqual({ coding: 100, intent: expect.any(Number), verification: 100 });
    expect(execution.acceptance?.map((criterion) => [criterion.id, criterion.status])).toEqual([
      ["AC-FILE", "passed"],
      ["AC-TESTS", "passed"],
      ["AC-ORACLE", "failed"],
    ]);
    expect(execution.behavior).toMatchObject({
      planCreated: true,
      toolCalls: 4,
      commandsExecuted: 2,
      filesChanged: 1,
      testsExecuted: 1,
      selfVerification: true,
      completionBlocked: false,
      falseCompletion: false,
      llmCalls: 1,
    });
    expect(execution.tokens).toEqual({ inputTokens: 120, outputTokens: 30, totalTokens: 150 });
    expect(execution.finalResult).toMatchObject({ harness: "agent-chat", verified: true, timedOut: false });
    expect(execution.failureType).toBeNull();
    expect(notices).toContain("verification");
    // The agent must plan and verify on its own: the benchmark's checks never reach the model.
    expect(provider.lastRequest?.system).not.toContain("AC-ORACLE");
  });

  it("fails an unverified, unimplemented turn honestly and scores self-verification at zero", async () => {
    const provider = new ScriptedProvider([{ type: "text-delta", text: "I would implement slugify like so..." }]);
    const executor = createAgentBenchmarkExecutor({
      provider,
      modelId: "bench-test-model",
      benchmarkRoot: workspace,
      persistSession: false,
    });

    const execution = await executor.executeTask(task(), { emit: () => {} });

    expect(execution.status).toBe("failed");
    expect(execution.scores?.coding).toBe(50);
    expect(execution.scores?.verification).toBe(0);
    expect(execution.acceptance?.find((criterion) => criterion.id === "AC-FILE")?.status).toBe("failed");
    expect(execution.failureType).toBe("implementation_failure");
    expect(execution.failureReason).toContain("AC-FILE");
    expect(execution.behavior).toMatchObject({
      filesChanged: 0,
      selfVerification: false,
      toolCalls: 0,
      // It ended its turn as done while the oracle failed.
      falseCompletion: true,
    });
  });

  it("does not count a turn the host reported unverified as a false completion", async () => {
    const provider = new ScriptedProvider([
      toolCallEvent("c1", "write_file", { path: "src/slug.ts", content: "..." }),
      toolResultEvent("c1", "write_file", {
        success: true,
        output: "Updated src/slug.ts",
        diff: { filePath: "src/slug.ts", additions: 1, removals: 0, patch: "", isNew: true },
      }),
      { type: "text-delta", text: "Done." },
    ]);
    const executor = createAgentBenchmarkExecutor({
      provider,
      modelId: "bench-test-model",
      benchmarkRoot: workspace,
      persistSession: false,
    });

    const execution = await executor.executeTask(task(), { emit: () => {} });

    expect(execution.status).toBe("failed");
    expect(execution.behavior).toMatchObject({ completionBlocked: true, falseCompletion: false });
  });

  it("hands a run's ablations to the agent it drives (audit doc 15, item 0.1)", async () => {
    const provider = new ScriptedProvider([{ type: "text-delta", text: "Done." }]);
    const executor = createAgentBenchmarkExecutor({
      provider,
      modelId: "bench-test-model",
      benchmarkRoot: workspace,
      persistSession: false,
      agentOptions: { ablate: ["bare"] },
    });

    await executor.executeTask(task(), { emit: () => {} });

    const tools = Object.keys((provider.lastRequest?.tools as Record<string, unknown> | undefined) ?? {}).sort();
    expect(tools).toEqual(["bash", "delete_file", "edit_file", "grep", "read_file", "write_file"]);
  });

  it("answers proposed decisions as the chain's simulated user: approves the rule it stated, declines the rest", async () => {
    /** A model that proposes decisions during its turn, through the real propose_decision tool. */
    class ProposingProvider extends ScriptedProvider {
      constructor(private readonly proposals: Array<Record<string, unknown>>) {
        super([]);
      }
      override stream(request: ProviderStreamRequest): ProviderStream {
        this.rounds += 1;
        const tools = request.tools as Record<string, { execute: (input: unknown, options: unknown) => unknown }>;
        const proposals = this.proposals;
        return {
          events: (async function* () {
            request.onStepStart?.(1);
            for (const proposal of proposals) {
              await tools.propose_decision?.execute(proposal, { toolCallId: "p", messages: [] });
            }
            yield { type: "text-delta", text: "Recorded." } as ProviderEvent;
            request.onStepFinish?.({ stepNumber: 1, finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } });
          })(),
          response: Promise.resolve({ messages: [{ role: "assistant", content: "Recorded." }] }),
        };
      }
    }
    const proposals = [
      { title: "Users are never removed", rule: "Deleting a user sets deleted_at; no code deletes rows." },
      { title: "Loans last 14 days", rule: "A loan is due 14 days after it is made." },
    ];
    const run = async (approveDecisions?: string[]) => {
      rmSync(join(workspace, "docs"), { recursive: true, force: true });
      const provider = new ProposingProvider(proposals);
      const notes: string[] = [];
      const executor = createAgentBenchmarkExecutor({
        provider,
        modelId: "bench-test-model",
        benchmarkRoot: workspace,
        persistSession: false,
      });
      await executor.executeTask(task({ ...(approveDecisions ? { approveDecisions } : {}) }), {
        emit: (notice) => notes.push(notice.message),
      });
      const statuses = listDecisions(workspace).map((decision) => `${decision.title}: ${decision.status}`);
      return { statuses, notes: notes.filter((note) => note.includes("simulated user")) };
    };

    const answered = await run(["never (?:removed|deleted)"]);
    expect(answered.statuses).toEqual(["Users are never removed: active"]);
    expect(answered.notes).toEqual([
      'The simulated user answered "approve" to D-0001: Users are never removed',
      'The simulated user answered "reject" to D-0002: Loans last 14 days',
    ]);
    // Without a simulated user nobody answers, as in any headless run: both proposals wait.
    const unanswered = await run();
    expect(unanswered.statuses).toEqual(["Users are never removed: proposed", "Loans last 14 days: proposed"]);
    expect(unanswered.notes).toEqual([]);
  });

  it("vetoes, with the chain suite's own patterns, a proposal that inverts or replaces the rule the user stated", async () => {
    const suite = JSON.parse(readFileSync("bench/suites/shelra-decision-chain-v0.1.json", "utf8")) as {
      tasks: Array<{ id: string; approveDecisions?: string[]; declineDecisions?: string[] }>;
    };
    const verdict = (id: string, title: string, rule: string) => {
      const step = suite.tasks.find((candidate) => candidate.id === id);
      expect(step?.declineDecisions?.length, `${id} has a veto list`).toBeGreaterThan(0);
      return simulatedDecisionApproval(
        step?.approveDecisions ?? [],
        step?.declineDecisions,
      )({ title, rule } as Decision);
    };
    const cases: Array<[string, string, string, "approve" | "reject"]> = [
      [
        "02-delete-user",
        "Users are soft-deleted",
        "Deleting a user sets deleted_at; rows are never removed.",
        "approve",
      ],
      ["02-delete-user", "Users are soft-deleted", "Deleting a user sets deleted_at; no code deletes rows.", "approve"],
      ["02-delete-user", "Rows are never removed", "Never hard-delete a user: DELETE sets deleted_at.", "approve"],
      ["02-delete-user", "Hard delete users", "DELETE /users/:id removes the row; there is no soft delete.", "reject"],
      [
        "02-delete-user",
        "Remove user rows on delete",
        "Deleting a user removes its row and drops the deleted_at column.",
        "reject",
      ],
      ["02-delete-user", "Inactive users are deleted", "Users who are not active for two years are deleted.", "reject"],
      ["04-isbn", "No dependencies", "package.json lists no dependencies and no code imports a package.", "approve"],
      ["04-isbn", "Dependency-free", "Dependencies are not allowed; no package may be added.", "approve"],
      ["04-isbn", "Dependencies are allowed", "Dependencies are allowed when they are not part of Bun.", "reject"],
      ["04-isbn", "Small packages are fine", "A package may be added when its dependency tree is not large.", "reject"],
      [
        "04-isbn",
        "Hand-written ISBN validation",
        "ISBN validation is written by hand, not taken from a package.",
        "reject",
      ],
      [
        "05-camel-case",
        "API JSON uses camelCase",
        "Every key the API accepts or answers is camelCase; snake_case is retired.",
        "approve",
      ],
      ["05-camel-case", "Keep snake_case", "The API keeps snake_case keys, not camelCase.", "reject"],
      ["09-loan-logs", "Logs never hold email addresses", "No log line contains an email address.", "approve"],
      ["09-loan-logs", "No emails in logs", "Log lines identify users by id and never by email.", "approve"],
      ["09-loan-logs", "Emails are logged", "Emails are logged, never hidden, so support can find the user.", "reject"],
      [
        "09-loan-logs",
        "Log the email on changes",
        "The change log includes the old and new email; nothing is redacted.",
        "reject",
      ],
      [
        "09-loan-logs",
        "Loans are logged with ids",
        "Every loan and return is logged with the loan, book and user ids.",
        "reject",
      ],
    ];
    for (const [id, title, rule, expected] of cases) {
      expect(await verdict(id, title, rule), `${id}: "${title}" / "${rule}"`).toBe(expected);
    }
    // A veto outranks an approval, and without an approve pattern nothing is approved.
    const veto = simulatedDecisionApproval(["soft"], ["hard"]);
    expect(await veto({ title: "Soft delete, then hard delete after a year", rule: "" } as Decision)).toBe("reject");
    expect(await simulatedDecisionApproval([], ["hard"])({ title: "Soft delete", rule: "" } as Decision)).toBe(
      "reject",
    );
  });

  it("reports a task without benchmark-owned checks as not run rather than inventing a grade", async () => {
    const provider = new ScriptedProvider([{ type: "text-delta", text: "Done." }]);
    const executor = createAgentBenchmarkExecutor({
      provider,
      modelId: "bench-test-model",
      persistSession: false,
    });

    const execution = await executor.executeTask(
      task({ acceptanceCriteria: [{ id: "AC-1", description: "agent-derived only" }] }),
      { emit: () => {} },
    );

    expect(execution.status).toBe("failed");
    expect(execution.acceptance?.[0]?.status).toBe("not_run");
    expect(execution.scores?.coding).toBe(0);
  });
});
