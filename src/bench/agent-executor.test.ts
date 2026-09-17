import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

vi.mock("../hooks/index", () => ({
  executeEventHooks: executeEventHooksMock,
}));

vi.mock("../exec/browser", () => ({
  observePage: vi.fn(async () => {
    throw new Error("browser not available in this test");
  }),
}));

import { createAgentBenchmarkExecutor } from "./agent-executor";
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
    expect(execution.behavior).toMatchObject({ filesChanged: 0, selfVerification: false, toolCalls: 0 });
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
