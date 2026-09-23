import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractCheckRunner } from "../contract/contract";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import { activeDecisions, approveDecision, listDecisions, proposeDecision } from "../ledger/store";
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

import type { Ablation } from "./ablation";
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
  let text = "";
  for await (const chunk of agent.processMessage("From now on money is integer cents. Record that decision.")) {
    if (chunk.type === "content") text += chunk.content ?? "";
  }
  return Object.assign(outputs, { text });
}

describe("propose_decision in a turn", () => {
  it("leaves the proposal waiting in the ledger when nobody can approve it", async () => {
    const outputs = await runTurn();
    const [output] = outputs;

    // The ledger file is the host's record, not work of the agent's that needs a check.
    expect(outputs.text).not.toContain("[Not verified");
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

describe("an approved decision is enforced when a change touches what it covers (phase 3)", () => {
  function seedDecision(scope: string[]) {
    const proposed = proposeDecision(workspace, { ...proposal, scope, check: "bun test money", source: "user" });
    if (!proposed.ok) throw new Error(proposed.reason);
    approveDecision(workspace, proposed.decision.id);
  }

  /** A model that rewrites src/money.ts every round and claims it is done; records what each round was asked. */
  function editingModel() {
    const asked: string[] = [];
    let round = 0;
    const provider: ProviderAdapter = {
      id: "editing",
      defaultModelId: "ledger-model",
      resolveModelRuntime: (modelId) => ({ modelId }),
      stream: (request: ProviderStreamRequest) => {
        const messages = (request.messages ?? []) as Array<{ role: string; content: unknown }>;
        const lastUser = [...messages].reverse().find((message) => message.role === "user");
        asked.push(typeof lastUser?.content === "string" ? lastUser.content : "");
        round += 1;
        const id = `w${round}`;
        return {
          events: (async function* () {
            const call: ProviderEvent = {
              type: "tool-call",
              toolCall: {
                id,
                type: "function",
                function: { name: "write_file", arguments: JSON.stringify({ path: "src/money.ts" }) },
              },
            };
            yield call;
            yield {
              type: "tool-result",
              toolCall: call.toolCall,
              output: {
                success: true,
                output: "Updated src/money.ts",
                diff: { filePath: "src/money.ts", additions: 1, removals: 1, patch: "", isNew: false },
              },
            };
            yield { type: "text-delta", text: "Done." };
          })(),
          response: Promise.resolve({ messages: [{ role: "assistant", content: "Done." }] }),
        };
      },
      generateText: async (request) => ({ text: '{"memories":[]}', modelId: request.modelId }),
      getToolContext: () => ({}),
    };
    return { provider, asked };
  }

  async function runEdit(ablate: Ablation[] = []) {
    const { provider, asked } = editingModel();
    const checkRunner = vi.fn<ContractCheckRunner>(async () => ({
      passed: false,
      output: "(fail) money > sums in cents",
      durationMs: 1,
    }));
    const agent = new Agent(undefined, undefined, "ledger-model", undefined, {
      provider,
      cwd: workspace,
      persistSession: false,
      checkRunner,
      ablate,
    });
    let text = "";
    for await (const chunk of agent.processMessage("Store prices as dollars with decimals")) {
      if (chunk.type === "content") text += chunk.content ?? "";
    }
    return { asked, checkRunner, text };
  }

  it("blocks a change that breaks an approved decision, names it, and asks to revert or supersede", async () => {
    seedDecision(["src/**"]);
    const { asked, checkRunner, text } = await runEdit();

    expect(checkRunner.mock.calls.map(([command]) => command)).toContain("bun test money");
    expect(asked[1]).toContain("It enforces D-0001 (Money is stored in integer cents), a decision the user approved.");
    expect(asked[1]).toContain("propose a superseding decision with propose_decision");
    expect(text).toContain(
      "This breaks D-0001 (Money is stored in integer cents): revert the change, or approve a decision that supersedes it.",
    );
  });

  it("leaves a decision's check alone when the change is outside what it covers", async () => {
    seedDecision(["src/billing/**"]);
    const { checkRunner, text } = await runEdit();

    expect(checkRunner).not.toHaveBeenCalled();
    expect(text).not.toContain("D-0001");
  });

  it("enforces nothing when the ledger is switched off", async () => {
    seedDecision(["src/**"]);
    const { checkRunner, text } = await runEdit(["ledger"]);

    expect(checkRunner).not.toHaveBeenCalled();
    expect(text).not.toContain("D-0001");
  });
});

describe("a trap of the phase 4 battery, through a live turn with real checks", () => {
  const fixture = fileURLToPath(
    new URL("../../bench/fixtures/shelra-decision-ledger-v0.1/02-public-api-rename", import.meta.url),
  );
  const renamed = (path: string) => readFileSync(join(fixture, path), "utf8").replaceAll("fetchUsr", "fetchUser");
  /** The obvious change: rename everywhere. The project's tests pass; the published name is gone. */
  const renameEverywhere = ["src/index.ts", "README.md"].map((path) => ({
    tool: "write_file",
    input: { path, content: renamed(path) },
  }));
  /** The change the decision asks for: the new name, and the old one kept as a deprecated alias. */
  const keepAlias = [
    {
      tool: "write_file",
      input: {
        path: "src/index.ts",
        content: `${renamed("src/index.ts")}\n/** @deprecated Use fetchUser. */\nexport const fetchUsr = fetchUser;\n`,
      },
    },
  ];

  /** A model that really runs its tool calls, one scripted list per round, and records what each round was asked. */
  function executingModel(script: Array<Array<{ tool: string; input: Record<string, unknown> }>>) {
    const asked: string[] = [];
    let round = 0;
    const provider: ProviderAdapter = {
      id: "executing",
      defaultModelId: "ledger-model",
      resolveModelRuntime: (modelId) => ({ modelId }),
      stream: (request: ProviderStreamRequest) => {
        const messages = (request.messages ?? []) as Array<{ role: string; content: unknown }>;
        const lastUser = [...messages].reverse().find((message) => message.role === "user");
        asked.push(typeof lastUser?.content === "string" ? lastUser.content : "");
        const calls = script[round] ?? [];
        round += 1;
        const tools = request.tools as Record<
          string,
          { execute?: (input: unknown, options: unknown) => Promise<unknown> }
        >;
        return {
          events: (async function* () {
            for (const [index, call] of calls.entries()) {
              const toolCall = {
                id: `r${round}-${index}`,
                type: "function" as const,
                function: { name: call.tool, arguments: JSON.stringify(call.input) },
              };
              yield { type: "tool-call", toolCall } satisfies ProviderEvent;
              const output = await tools[call.tool]?.execute?.(call.input, { toolCallId: toolCall.id, messages: [] });
              yield { type: "tool-result", toolCall, output } satisfies ProviderEvent;
            }
            yield { type: "text-delta", text: "Done." };
          })(),
          response: Promise.resolve({ messages: [{ role: "assistant", content: "Done." }] }),
        };
      },
      generateText: async (request) => ({ text: '{"memories":[]}', modelId: request.modelId }),
      getToolContext: () => ({}),
    };
    return { provider, asked };
  }

  async function runTrap(script: Array<Array<{ tool: string; input: Record<string, unknown> }>>, ablate: Ablation[]) {
    cpSync(fixture, workspace, { recursive: true });
    const { provider, asked } = executingModel(script);
    const agent = new Agent(undefined, undefined, "ledger-model", undefined, {
      provider,
      cwd: workspace,
      persistSession: false,
      ablate,
    });
    let text = "";
    for await (const chunk of agent.processMessage("fetchUsr is a typo that keeps confusing people. Rename it.")) {
      if (chunk.type === "content") text += chunk.content ?? "";
    }
    const decisionCheck = spawnSync(process.versions.bun ? process.execPath : "bun", ["scripts/check-api.ts"], {
      cwd: workspace,
      encoding: "utf8",
    });
    return { asked, text, decisionHolds: decisionCheck.status === 0 };
  }

  it("sends the obvious change back naming the decision, and accepts it once the old name stays", async () => {
    const { asked, text, decisionHolds } = await runTrap([renameEverywhere, keepAlias], []);

    expect(asked[1]).toContain("It enforces D-0001 (The public API only grows), a decision the user approved.");
    expect(asked[1]).toContain("D-0001 broken: published names are no longer exported");
    expect(asked).toHaveLength(2);
    expect(text).not.toContain("[Not verified");
    expect(decisionHolds).toBe(true);
  }, 60_000);

  it("reports the same change as done when the ledger is off, with the decision broken", async () => {
    const { asked, text, decisionHolds } = await runTrap([renameEverywhere, keepAlias], ["ledger"]);

    expect(asked).toHaveLength(1);
    expect(text).not.toContain("[Not verified");
    expect(decisionHolds).toBe(false);
  }, 60_000);
});
