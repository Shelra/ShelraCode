import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult } from "../hooks/types";
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
import type { PlanStepUpdate, ToolResult } from "../types/index";

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
      return { id: "ws-1", scopeKey: "/tmp/ws", canonicalPath: "/tmp/ws", gitRoot: null, displayName: "ws" };
    }
    private session() {
      return {
        id: "session-1",
        workspaceId: "ws-1",
        title: null,
        recap: null,
        model: "plan-model",
        mode: "agent" as const,
        cwdAtStart: "/tmp/ws",
        cwdLast: "/tmp/ws",
        status: "active" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    openSession() {
      return this.session();
    }
    createSession() {
      return this.session();
    }
    getRequiredSession() {
      return this.session();
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

type ToolSet = Record<string, { execute: (input: unknown, context: unknown) => Promise<unknown> }>;

/** A model whose calls run on the agent's real tools, one after another, as a provider's would. */
class ExecutingProvider implements ProviderAdapter {
  readonly id = "executing-test";
  constructor(private readonly calls: Array<{ name: string; input: Record<string, unknown> }>) {}
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
    const calls = this.calls;
    const tools = request.tools as ToolSet;
    return {
      events: (async function* (): AsyncGenerator<ProviderEvent> {
        for (const [index, call] of calls.entries()) {
          const toolCall = {
            id: `call-${index}`,
            type: "function" as const,
            function: { name: call.name, arguments: JSON.stringify(call.input) },
          };
          yield { type: "tool-call", toolCall };
          const output = await tools[call.name]?.execute(call.input, { toolCallId: toolCall.id, messages: [] });
          yield { type: "tool-result", toolCall, output };
        }
        yield { type: "text-delta", text: "Done." };
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

describe("a plan step marked complete (audit gap #8, seen live 2026-09-25)", () => {
  it("is claimed on the model's word alone, and complete once Shelra saw a check pass since the step started", async () => {
    const provider = new ExecutingProvider([
      {
        name: "generate_plan",
        input: {
          title: "Clock",
          goal: "a clock",
          acceptanceCriteria: ["It ticks"],
          steps: ["Write the clock", "Check the clock", "Polish the clock"],
        },
      },
      { name: "update_plan_step", input: { index: 1, status: "working" } },
      { name: "update_plan_step", input: { index: 1, status: "complete", evidence: "verified by running it" } },
      { name: "update_plan_step", input: { index: 2, status: "working" } },
      { name: "bash", input: { command: "node --test" } },
      { name: "update_plan_step", input: { index: 2, status: "complete", evidence: "tests pass" } },
      { name: "update_plan_step", input: { index: 3, status: "working" } },
      { name: "update_plan_step", input: { index: 3, status: "complete" } },
    ]);
    const agent = new Agent(undefined, undefined, "plan-model", undefined, {
      provider,
      cwd: mkdtempSync(join(tmpdir(), "shelra-plan-claims-")),
    });

    const updates: Array<{ update: PlanStepUpdate; output: string }> = [];
    for await (const chunk of agent.processMessage("Build a clock")) {
      const result = (chunk as { type: string; toolResult?: ToolResult }).toolResult;
      if (chunk.type === "tool_result" && result?.planUpdate) {
        updates.push({ update: result.planUpdate, output: result.output ?? "" });
      }
    }

    const completions = updates.filter(({ update }) => update.status !== "working");
    expect(completions.map(({ update }) => [update.index, update.status])).toEqual([
      [0, "claimed"],
      [1, "complete"],
      [2, "claimed"],
    ]);
    expect(completions[0]?.output).toContain("recorded as claimed, not complete: Shelra has seen no check pass");
    expect(completions[1]?.update.checkedBy).toContain("node --test");
  }, 60_000);
});
