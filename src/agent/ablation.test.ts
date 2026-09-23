import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedHookResult, HookInput } from "../hooks/types";
import { approveDecision, proposeDecision } from "../ledger/store";
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
import { type Ablation, Ablations, ablateTools, parseAblations } from "./ablation";

/**
 * Proof that each benchmark ablation reaches the request a model actually receives (audit doc 15,
 * item 0.1): a switch that only changed a flag nobody reads would measure nothing.
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
}));

import { Agent } from "./agent";

let root: string;
let workspace: string;
let saved: { HOME?: string; USERPROFILE?: string };

beforeAll(() => {
  // A scratch HOME: the person's own settings, memory and skills must not decide these assertions.
  root = mkdtempSync(join(tmpdir(), "shelra-ablation-test-"));
  saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = join(root, "home");
  process.env.USERPROFILE = join(root, "home");
  mkdirSync(join(root, "home"), { recursive: true });
  workspace = join(root, "project");
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src", "parse.ts"), "export const parse = (s: string) => s;\n");
  mkdirSync(join(workspace, ".agents", "skills", "release-notes"), { recursive: true });
  writeFileSync(
    join(workspace, ".agents", "skills", "release-notes", "SKILL.md"),
    "---\nname: release-notes\ndescription: Write release notes\n---\n",
  );
  const decision = proposeDecision(workspace, {
    title: "Parsers never throw",
    rule: "A parser returns a result object instead of throwing on bad input.",
    scope: ["src/**"],
    source: "user",
  });
  if (decision.ok) approveDecision(workspace, decision.decision.id);
});

afterAll(() => {
  for (const key of ["HOME", "USERPROFILE"] as const) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(root, { recursive: true, force: true });
});

class CapturingProvider implements ProviderAdapter {
  readonly id = "capture-test";
  readonly defaultModelId = "tool-model";
  lastRequest: ProviderStreamRequest | null = null;

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return { modelId };
  }

  stream(request: ProviderStreamRequest): ProviderStream {
    this.lastRequest = request;
    const events: ProviderEvent[] = [{ type: "text-delta", text: "Hi there." }];
    return {
      events: (async function* () {
        yield* events;
      })(),
      response: Promise.resolve({ messages: [{ role: "assistant", content: "Hi there." }] }),
    };
  }

  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    return { text: "Summary.", modelId: request.modelId };
  }

  getToolContext(): ProviderToolContext {
    return {};
  }
}

async function requestWith(ablate: Ablation[]): Promise<{ tools: string[]; system: string }> {
  const provider = new CapturingProvider();
  const agent = new Agent(undefined, undefined, "tool-model", undefined, {
    cwd: workspace,
    provider,
    persistSession: false,
    ablate,
  });
  for await (const _chunk of agent.processMessage("Fix the failing test in src/parse.ts")) {
    // drain
  }
  return {
    tools: Object.keys((provider.lastRequest?.tools as Record<string, unknown> | undefined) ?? {}),
    system: provider.lastRequest?.system ?? "",
  };
}

describe("parseAblations", () => {
  it("reads a comma list, ignores none and repeats, and names what it does not know", () => {
    expect(parseAblations("memory, Gate ,memory,none,bogus")).toEqual({
      ablations: ["memory", "gate"],
      unknown: ["bogus"],
    });
    expect(parseAblations("")).toEqual({ ablations: [], unknown: [] });
  });
});

describe("ablateTools", () => {
  const tools = Object.fromEntries(
    ["bash", "read_file", "grep", "memory_list", "generate_plan", "task", "search_web", "process_logs"].map((name) => [
      name,
      {},
    ]),
  ) as never;

  it("keeps everything without ablations and drops only the switched-off subsystems' tools", () => {
    expect(Object.keys(ablateTools(tools, new Ablations()))).toHaveLength(8);
    expect(Object.keys(ablateTools(tools, new Ablations(["memory", "web"])))).toEqual([
      "bash",
      "read_file",
      "grep",
      "generate_plan",
      "task",
      "process_logs",
    ]);
    expect(Object.keys(ablateTools(tools, new Ablations(["bare"])))).toEqual(["bash", "read_file", "grep"]);
  });
});

describe("ablations in the model request", () => {
  beforeEach(() => {
    executeEventHooksMock.mockResolvedValue({
      blocked: false,
      blockingErrors: [],
      preventContinuation: false,
      additionalContexts: [],
      results: [],
    });
    primeCatalog([
      {
        id: "tool-model",
        name: "Tool model",
        contextWindow: 128_000,
        inputPrice: 0,
        outputPrice: 0,
        reasoning: false,
        description: "test",
        supportsClientTools: true,
        supportsMaxOutputTokens: true,
        category: "cloud",
        provider: "openrouter",
      },
    ]);
  });

  afterEach(() => clearCatalog());

  it("sends every subsystem when nothing is switched off", async () => {
    const { tools, system } = await requestWith([]);
    expect(tools).toEqual(
      expect.arrayContaining(["memory_list", "generate_plan", "task", "search_web", "propose_decision"]),
    );
    for (const marker of [
      "Check memory_list once",
      "MEMORY:",
      "3. For work spanning several files",
      "DELEGATION (task tool)",
      "search_web and open_web only when",
      "<available_skills>",
      "HOST-COMPILED REPOSITORY CONTEXT",
      "The host blocks a turn from completing",
      "DECISIONS:",
      "D-0001 Parsers never throw",
    ]) {
      expect(system).toContain(marker);
    }
  });

  const cases: Array<{ ablate: Ablation; tools: string[]; markers: string[] }> = [
    {
      ablate: "memory",
      tools: ["memory_list", "memory_read", "memory_write", "memory_delete"],
      markers: ["memory_list", "MEMORY:"],
    },
    { ablate: "plan", tools: ["generate_plan", "update_plan_step"], markers: ["generate_plan", "update_plan_step"] },
    { ablate: "subagents", tools: ["task", "delegate", "delegation_read", "delegation_list"], markers: ["DELEGATION"] },
    { ablate: "web", tools: ["search_web", "open_web"], markers: ["search_web", "open_web"] },
    { ablate: "skills", tools: [], markers: ["<available_skills>"] },
    { ablate: "context", tools: [], markers: ["HOST-COMPILED REPOSITORY CONTEXT"] },
    { ablate: "gate", tools: [], markers: ["The host blocks"] },
    { ablate: "ledger", tools: ["propose_decision"], markers: ["DECISIONS:", "D-0001"] },
  ];

  for (const { ablate, tools: gone, markers } of cases) {
    it(`switching off ${ablate} removes its tools and its guidance from the request`, async () => {
      const { tools, system } = await requestWith([ablate]);
      for (const name of gone) expect(tools).not.toContain(name);
      for (const marker of markers) expect(system).not.toContain(marker);
      expect(tools).toContain("bash");
    });
  }

  it("renumbers the way of working when the planning step is gone", async () => {
    const { system } = await requestWith(["plan"]);
    expect(system).toContain("3. Execute with tools instead of narrating.");
    expect(system).toContain("5. Report concisely:");
    expect(system).not.toContain("6. ");
  });

  it("reduces a bare run to environment facts and six basic tools", async () => {
    const { tools, system } = await requestWith(["bare"]);
    expect(tools.sort()).toEqual(["bash", "delete_file", "edit_file", "grep", "read_file", "write_file"]);
    expect(system.startsWith("You are a coding agent working in the user's repository through tools.")).toBe(true);
    expect(system).not.toContain("STANDARDS:");
    expect(system).not.toContain("HOST-COMPILED REPOSITORY CONTEXT");
  });
});
