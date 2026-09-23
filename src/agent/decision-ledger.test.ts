import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import { activeDecisions, listDecisions } from "../ledger/store";
import type { ProviderAdapter, ProviderEvent, ProviderStreamRequest } from "../providers/types";

/**
 * The decision ledger in a real turn (phase 2 of the 2026-09-18 objective): the model proposes through
 * propose_decision, and only the user's answer turns a proposal into a commitment.
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
  replaceMessage: vi.fn(),
  upsertObjectiveIndex: vi.fn(),
  SessionStore: class {},
}));

vi.mock("../hooks/index", () => ({
  executeEventHooks: executeEventHooksMock,
  executePreToolHooks: vi.fn(async () => ({ blocked: false, blockingErrors: [], results: [] })),
  executePostToolHooks: vi.fn(async () => ({})),
  executePostToolFailureHooks: vi.fn(async () => ({})),
}));

import { Agent } from "./agent";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-ledger-turn-"));
  executeEventHooksMock.mockResolvedValue({
    blocked: false,
    blockingErrors: [],
    preventContinuation: false,
    additionalContexts: [],
    results: [],
  });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const proposal = {
  title: "Money is stored in integer cents",
  rule: "Amounts are integers of cents everywhere; formatting to dollars happens only at display time.",
  why: "Floating-point dollars lose cents in sums.",
  evidence: "The user, in this conversation.",
  scope: ["src/**"],
  check: "bun test src/money.test.ts",
};

/** One round that calls propose_decision for real, then ends; records what the tool answered. */
function proposingModel() {
  const outputs: Array<{ success?: boolean; output?: string }> = [];
  let round = 0;
  const provider: ProviderAdapter = {
    id: "proposing",
    defaultModelId: "ledger-model",
    resolveModelRuntime: (modelId) => ({ modelId }),
    stream: (request: ProviderStreamRequest) => {
      round += 1;
      const tools = request.tools as Record<
        string,
        { execute?: (input: unknown, options: unknown) => Promise<unknown> }
      >;
      const first = round === 1;
      return {
        events: (async function* () {
          if (first) {
            const call: ProviderEvent = {
              type: "tool-call",
              toolCall: {
                id: "p1",
                type: "function",
                function: { name: "propose_decision", arguments: JSON.stringify(proposal) },
              },
            };
            yield call;
            const output = (await tools.propose_decision?.execute?.(proposal, { toolCallId: "p1", messages: [] })) as {
              success?: boolean;
              output?: string;
            };
            outputs.push(output);
            yield { type: "tool-result", toolCall: call.toolCall, output };
          }
          yield { type: "text-delta", text: "Proposed the decision." };
        })(),
        response: Promise.resolve({ messages: [{ role: "assistant", content: "Proposed the decision." }] }),
      };
    },
    generateText: async (request) => ({ text: '{"memories":[]}', modelId: request.modelId }),
    getToolContext: () => ({}),
  };
  return { provider, outputs };
}

async function runTurn(setup?: (agent: Agent) => void) {
  const { provider, outputs } = proposingModel();
  const agent = new Agent(undefined, undefined, "ledger-model", undefined, {
    provider,
    cwd: workspace,
    persistSession: false,
  });
  setup?.(agent);
  for await (const _chunk of agent.processMessage("From now on money is integer cents. Record that decision.")) {
    // drain
  }
  return outputs;
}

describe("propose_decision in a turn", () => {
  it("leaves the proposal waiting in the ledger when nobody can approve it", async () => {
    const [output] = await runTurn();

    expect(output).toMatchObject({ success: true, output: expect.stringContaining("shelra decisions approve D-0001") });
    expect(listDecisions(workspace)).toEqual([
      expect.objectContaining({ id: "D-0001", status: "proposed", source: "agent", check: proposal.check }),
    ]);
    expect(activeDecisions(workspace)).toEqual([]);
  });

  it("records a commitment only when the user approves it", async () => {
    const asked: string[] = [];
    const [output] = await runTurn((agent) =>
      agent.setDecisionApproval(async (decision) => {
        asked.push(`${decision.id} ${decision.title}`);
        return "approve";
      }),
    );

    expect(asked).toEqual(["D-0001 Money is stored in integer cents"]);
    expect(output?.output).toContain("The user approved D-0001");
    expect(activeDecisions(workspace)).toEqual([expect.objectContaining({ id: "D-0001", status: "active" })]);
  });

  it("drops the proposal when the user declines it", async () => {
    const [output] = await runTurn((agent) => agent.setDecisionApproval(async () => "reject"));

    expect(output?.output).toContain("declined D-0001");
    expect(listDecisions(workspace)).toEqual([]);
    expect(existsSync(join(workspace, "docs", "decisions"))).toBe(true);
  });
});
