/**
 * Long-horizon probes (docs/architecture/20-LONG-HORIZON-AUDIT.md): one deterministic question each about what
 * survives time, scale and boundaries, answered by the real code — the real `Agent.processMessage` with a scripted
 * model where a turn is needed, the store functions where none is. No network, no model quota. Each probe prints what
 * it observed; the audit reads the observation, the probe does not decide it.
 *
 *   bun run bench/long-horizon/probes.ts            # every probe
 *   bun run bench/long-horizon/probes.ts P4 P8      # some
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactPaths } from "./redact";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The real home, before HOME moves: results must not name it. */
const realHome = homedir();
const root = mkdtempSync(join(tmpdir(), "shelra-lh-probes-"));
const home = join(root, "home");
mkdirSync(home, { recursive: true });
writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Probe\n\temail = probe@shelra.invalid\n");
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.SHELRA_USER_MEMORY_ROOT = home;
process.env.SHELRA_RESEARCH = "off";
process.env.SHELRA_TRACE = "off";
process.env.SHELRA_DIAGNOSTICS_LOG = "off";

const { Agent } = await import("../../src/agent/agent");
const { extractUserDirectives, admitCandidates } = await import("../../src/memory/reflection");
const { projectMemoryScope, listMemoryRecords, writeMemoryEntry } = await import("../../src/memory/store");
const { memoryContextFor } = await import("../../src/agent/prompts");
const { proposeDecision, approveDecision, activeDecisions } = await import("../../src/ledger/store");
const { formatDecisionsForPrompt } = await import("../../src/ledger/prompt");

type Step = { tool: string; input: Record<string, unknown> };

interface Turn {
  request: string;
  rounds: Step[][];
  answer?: string;
  /** What a compaction or reflection call returns. */
  text?: (system: string, prompt: string) => string;
}

interface TurnRecord {
  requests: Array<{ system: string; messages: string }>;
  outputs: Array<{ tool: string; output: { success?: boolean; output?: string } }>;
  text: string;
}

function workspace(name: string, files: Record<string, string> = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["commit", "-q", "-m", "start", "--allow-empty"], { cwd: dir, env: { ...process.env } });
  return dir;
}

const PASSING_PROJECT = {
  "package.json": JSON.stringify({ name: "probe", type: "module", scripts: { test: "bun test" } }),
  "src/report.ts": "export function report(rows: number[]): string {\n  return rows.join('\\n');\n}\n",
  "test/report.test.ts":
    "import { expect, test } from 'bun:test';\nimport { report } from '../src/report';\ntest('prints rows', () => expect(report([1, 2])).toBe('1\\n2'));\n",
};

/** An agent with a scripted model that really runs its tool calls; one instance is one session. */
function scriptedAgent(cwd: string, options: { contextWindow?: number; model?: string } = {}) {
  let turn: Turn = { request: "", rounds: [] };
  let round = 0;
  let record: TurnRecord = { requests: [], outputs: [], text: "" };
  const provider = {
    id: "probe",
    defaultModelId: options.model ?? "probe-model",
    resolveModelRuntime: (modelId: string) => ({
      modelId,
      modelInfo: {
        id: modelId,
        name: "Scripted",
        contextWindow: options.contextWindow ?? 200_000,
        inputPrice: 0,
        outputPrice: 0,
        reasoning: false,
        description: "probe",
        supportsClientTools: true,
        supportsMaxOutputTokens: true,
      },
    }),
    stream: (request: { system: string; messages: unknown[]; tools?: Record<string, unknown> }) => {
      record.requests.push({ system: request.system, messages: JSON.stringify(request.messages) });
      const steps = turn.rounds[round] ?? [];
      const answer = round === 0 ? (turn.answer ?? "Done.") : "Done.";
      round += 1;
      const tools = (request.tools ?? {}) as Record<
        string,
        { execute?: (input: unknown, options: unknown) => Promise<unknown> }
      >;
      const outputs = record.outputs;
      // The response carries the tool calls and results as the AI SDK's would, so the transcript and compaction see them.
      const messages: unknown[] = [];
      let finish: (value: { messages: unknown[] }) => void = () => {};
      const response = new Promise<{ messages: unknown[] }>((resolve) => {
        finish = resolve;
      });
      return {
        events: (async function* () {
          for (const [index, step] of steps.entries()) {
            const id = `p-${round}-${index}`;
            const call = {
              id,
              type: "function" as const,
              function: { name: step.tool, arguments: JSON.stringify(step.input) },
            };
            yield { type: "tool-call" as const, toolCall: call };
            const output = (await tools[step.tool]?.execute?.(step.input, { toolCallId: id, messages: [] })) as {
              success?: boolean;
              output?: string;
            };
            outputs.push({ tool: step.tool, output: output ?? { success: false, output: "(tool not offered)" } });
            messages.push(
              {
                role: "assistant",
                content: [{ type: "tool-call", toolCallId: id, toolName: step.tool, input: step.input }],
              },
              {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: id,
                    toolName: step.tool,
                    output: { type: "json", value: output ?? null },
                  },
                ],
              },
            );
            yield { type: "tool-result" as const, toolCall: call, output };
          }
          yield { type: "text-delta" as const, text: answer };
          messages.push({ role: "assistant", content: answer });
          finish({ messages });
        })(),
        response,
      };
    },
    generateText: async (request: { system: string; prompt: string; modelId: string }) => ({
      text: turn.text ? turn.text(request.system, request.prompt) : '{"memories":[]}',
      modelId: request.modelId,
    }),
    getToolContext: () => ({}),
  };
  const agent = new Agent(undefined, undefined, options.model ?? "probe-model", undefined, {
    provider: provider as never,
    cwd,
    persistSession: true,
  });
  return {
    agent,
    async run(next: Turn): Promise<TurnRecord> {
      turn = next;
      round = 0;
      record = { requests: [], outputs: [], text: "" };
      for await (const chunk of agent.processMessage(next.request)) {
        const item = chunk as { type: string; content?: string };
        if (item.type === "content" && item.content) record.text += item.content;
      }
      return record;
    },
  };
}

const verdictOf = (text: string) =>
  /\[(?:Checked by Shelra|Not verified|Not marked complete|Cancelled|Error)[^\]]*\]/u.exec(text)?.[0] ??
  "(no verdict line)";

interface ProbeResult {
  id: string;
  question: string;
  observed: Record<string, unknown>;
}

const probes: Record<string, () => Promise<ProbeResult>> = {
  async P1() {
    const dir = workspace("p1", PASSING_PROJECT);
    const session = scriptedAgent(dir);
    await session.run({
      request: "Add a CSV export and a JSON export to the report module, step by step.",
      rounds: [
        [
          {
            tool: "generate_plan",
            input: {
              title: "Exports",
              goal: "CSV and JSON exports",
              acceptanceCriteria: [{ id: "AC1", description: "exports work", verification: "bun test" }],
              steps: ["Add CSV export", "Add JSON export", "Document both"],
            },
          },
          { tool: "update_plan_step", input: { index: 1, status: "working" } },
          {
            tool: "write_file",
            input: { path: "src/csv.ts", content: "export const csv = (r: number[]) => r.join(',');\n" },
          },
          { tool: "bash", input: { command: "bun test" } },
          { tool: "update_plan_step", input: { index: 1, status: "complete", evidence: "bun test" } },
        ],
      ],
    });
    const second = await session.run({
      request: "Continue with step 2.",
      rounds: [[{ tool: "update_plan_step", input: { index: 2, status: "working" } }]],
    });
    return {
      id: "P1",
      question: "Same session, next turn: can the model update the plan it published in the previous turn?",
      observed: {
        updatePlanStepOutput: second.outputs[0]?.output?.output,
        planVisibleInHistory: second.requests[0]?.messages.includes("Add JSON export") ?? false,
      },
    };
  },

  async P3() {
    const dir = workspace("p3");
    const scope = projectMemoryScope(dir);
    let stored = 0;
    for (let index = 1; index <= 45; index++) {
      const candidates = extractUserDirectives(`Always prefix module number ${index} with the code M${index}x.`);
      stored += admitCandidates(scope, candidates).written.length;
    }
    const rules = listMemoryRecords(scope).filter((record) => record.entry.frontmatter.metadata.source === "human");
    const context = memoryContextFor(dir, "Fix the build script");
    const shownInFull = (context.text.match(/^- Always prefix module/gmu) ?? []).length;
    return {
      id: "P3",
      question: "A year of standing rules: how many of 45 stated rules are kept, and how many reach a request?",
      observed: {
        stated: 45,
        stored,
        humanEntries: rules.length,
        shownAsStandingRuleLines: shownInFull,
        tail: context.text.split("\n").slice(-4).join(" | ").slice(0, 400),
      },
    };
  },

  async P4() {
    const dir = workspace("p4");
    for (let index = 1; index <= 40; index++) {
      const proposed = proposeDecision(dir, {
        title: `Decision number ${index} about module ${index}`,
        rule: `Module ${index} follows rule ${index}.`,
        why: `Reason ${index}`,
        source: "user",
      });
      if (proposed.ok) approveDecision(dir, proposed.decision.id);
    }
    const prompt = formatDecisionsForPrompt(activeDecisions(dir));
    const listed = [...prompt.matchAll(/^- (D-\d{4})/gmu)].map((match) => match[1]);
    return {
      id: "P4",
      question: "A year of decisions: with 40 active, which ones reach the prompt?",
      observed: {
        active: activeDecisions(dir).length,
        listed: listed.length,
        first: listed[0],
        last: listed.at(-1),
        newestListed: listed.includes("D-0040"),
        overflowLine: prompt.split("\n").at(-1),
        whyShown: prompt.includes("Reason 1"),
      },
    };
  },

  async P5() {
    const dir = workspace("p5");
    const scope = projectMemoryScope(dir);
    admitCandidates(scope, extractUserDirectives("Use SQLite instead of JSON files for storage."));
    admitCandidates(scope, extractUserDirectives("Use DuckDB instead of SQLite."));
    admitCandidates(scope, extractUserDirectives("We no longer want the monthly report."));
    admitCandidates(scope, extractUserDirectives("We use Postgres for storage."));
    const context = memoryContextFor(dir, "Change how expenses are stored");
    const current = listMemoryRecords(scope).filter(
      (record) => (record.entry.frontmatter.metadata.status ?? "active") === "active",
    );
    return {
      id: "P5",
      question: "Contradicting statements over time (SQLite, then DuckDB, then Postgres): what is current truth?",
      observed: {
        currentEntries: current.map((record) => record.index.hook),
        standingRulesShown: context.text
          .split("\n")
          .filter((line) => line.startsWith("- "))
          .slice(0, 8),
        changeOfIntentCaptured: current.some((record) => /monthly report/iu.test(record.index.hook)),
      },
    };
  },

  async P6() {
    const dir = workspace("p6", PASSING_PROJECT);
    const scope = projectMemoryScope(dir);
    const [rule] = extractUserDirectives("Never commit generated files.");
    if (rule) admitCandidates(scope, [rule]);
    const session = scriptedAgent(dir);
    const turn = await session.run({
      request: "Tidy up the project memory.",
      rounds: [[{ tool: "memory_delete", input: { slug: rule?.slug ?? "" } }]],
    });
    return {
      id: "P6",
      question: "Can the model delete a rule the user stated?",
      observed: {
        slug: rule?.slug,
        deleteOutput: turn.outputs[0]?.output?.output,
        stillOnDisk: existsSync(join(dir, ".shelra", "memory", `${rule?.slug}.md`)),
      },
    };
  },

  async P7() {
    const projectA = workspace("p7-a", PASSING_PROJECT);
    const projectB = workspace("p7-b", PASSING_PROJECT);
    const a = scriptedAgent(projectA);
    await a.run({
      request: "Remember how this project stores data.",
      rounds: [
        [
          {
            tool: "memory_write",
            input: {
              slug: "storage-engine",
              title: "Storage is DuckDB",
              hook: "The ledger lives in data/ledger.duckdb",
              type: "architecture",
              description: "storage",
              body: "DuckDB file data/ledger.duckdb.",
              scope: "user",
            },
          },
        ],
      ],
    });
    const b = scriptedAgent(projectB);
    const turn = await b.run({ request: "Where is the data stored in this project?", rounds: [[]] });
    const nested = join(projectA, "packages", "api");
    mkdirSync(nested, { recursive: true });
    writeMemoryEntry(projectMemoryScope(projectA), {
      slug: "root-fact",
      title: "Root fact",
      hook: "Deploy with make release",
      type: "build",
      description: "x",
      body: "make release",
      source: "observed",
    });
    const nestedContext = memoryContextFor(nested, "How do I deploy with make release?");
    return {
      id: "P7",
      question:
        "Cross-project isolation: does a fact the model saved in project A reach project B? Does a subfolder see the repository's memory?",
      observed: {
        projectBSystemMentionsDuckDB: /duckdb/iu.test(turn.requests[0]?.system ?? ""),
        projectBLine: (turn.requests[0]?.system ?? "").split("\n").find((line) => /duckdb/iu.test(line)),
        subfolderSeesRootMemory: nestedContext.text.includes("make release"),
      },
    };
  },

  async P8() {
    const dir = workspace("p8", { ...PASSING_PROJECT, "src/sub/x.ts": "export {};\n" });
    const proposed = proposeDecision(dir, {
      title: "Reports never print raw cents",
      rule: "Every report formats amounts with two decimals.",
      source: "user",
      check: "bun test",
    });
    if (proposed.ok) approveDecision(dir, proposed.decision.id);
    const session = scriptedAgent(dir);
    const first = await session.run({
      request: "Look around src/sub.",
      rounds: [[{ tool: "bash", input: { command: "cd src/sub" } }]],
    });
    const second = await session.run({ request: "Now add a totals line to the report.", rounds: [[]] });
    return {
      id: "P8",
      question: "After the shell moves into a subfolder, do the project's decisions still reach the prompt?",
      observed: {
        decisionsInFirstPrompt: first.requests[0]?.system.includes("D-0001") ?? false,
        decisionsInNextTurnPrompt: second.requests[0]?.system.includes("D-0001") ?? false,
      },
    };
  },

  async P9() {
    const dir = workspace("p9", PASSING_PROJECT);
    const session = scriptedAgent(dir);
    const turn = await session.run({
      request:
        "Add a --json flag to the report CLI that prints the rows as a JSON array, and keep the default text output unchanged.",
      rounds: [
        [
          {
            tool: "write_file",
            input: { path: "src/report.ts", content: `// json flag: TODO\n${PASSING_PROJECT["src/report.ts"]}` },
          },
          { tool: "bash", input: { command: "bun test" } },
        ],
      ],
      answer: "Added the --json flag; tests pass.",
    });
    return {
      id: "P9",
      question:
        "False completion: the change does nothing the request asked, and the existing tests still pass. What is the verdict?",
      observed: {
        rounds: turn.requests.length,
        verdict: verdictOf(turn.text),
        closingText: turn.text.slice(-400),
        episodeOutcome: (() => {
          const file = join(dir, ".shelra", "memory", "episodes.jsonl");
          const last = existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").at(-1) : undefined;
          return last ? (JSON.parse(last) as { outcome?: string }).outcome : undefined;
        })(),
        auditAsked: turn.requests.slice(1).some((request) => /requirement|behavio/iu.test(request.messages)),
      },
    };
  },

  async P10() {
    const dir = workspace("p10", PASSING_PROJECT);
    const session = scriptedAgent(dir);
    const turn = await session.run({
      request: "Ship the release to production.",
      rounds: [
        [
          { tool: "bash", input: { command: "git push --force origin main" } },
          { tool: "report_blocker", input: { reason: "No production credentials are configured." } },
        ],
      ],
    });
    return {
      id: "P10",
      question: "Escalation: what does a destructive command get headless, and what shape does a blocker take?",
      observed: {
        forcePushOutput: turn.outputs[0]?.output?.output?.slice(0, 240),
        blockerOutput: turn.outputs[1]?.output?.output,
        finalText: turn.text.slice(-300),
      },
    };
  },

  async P11() {
    const dir = workspace("p11", PASSING_PROJECT);
    const session = scriptedAgent(dir, { contextWindow: 12_000 });
    const big = "lorem ipsum ".repeat(4_000);
    const turn1 = await session.run({
      request: "Build the invoicing module. Goal: invoices in EUR and USD; never round before summing.",
      rounds: [
        [
          {
            tool: "generate_plan",
            input: {
              title: "Invoicing",
              goal: "Invoices in EUR and USD; never round before summing",
              acceptanceCriteria: [{ id: "AC1", description: "Totals sum unrounded cents", verification: "bun test" }],
              steps: ["Write invoice.ts", "Write tests"],
            },
          },
          { tool: "write_file", input: { path: "notes.txt", content: big } },
          { tool: "read_file", input: { path: "notes.txt" } },
        ],
      ],
      text: () => "Worked on some files.",
    });
    // Three more turns of reading push the first request out of the kept recent part.
    for (const label of ["first", "second", "third"]) {
      await session.run({
        request: `Read the notes again, the ${label} time.`,
        rounds: [[{ tool: "read_file", input: { path: "notes.txt" } }]],
        text: () => "Worked on some files.",
      });
    }
    const turn2 = await session.run({ request: "Keep going.", rounds: [[]], text: () => "Worked on some files." });
    const after = `${turn2.requests[0]?.system ?? ""}\n${turn2.requests[0]?.messages ?? ""}`;
    return {
      id: "P11",
      question: "Compaction written by a weak model: what of the goal and criteria survives?",
      observed: {
        compacted: after.includes("Worked on some files."),
        criterionSurvives: after.includes("Totals sum unrounded cents"),
        goalSurvives: after.includes("never round before summing"),
        turn1Rounds: turn1.requests.length,
      },
    };
  },
};

const wanted = process.argv.slice(2).filter((arg) => /^P\d+$/u.test(arg));
const results: ProbeResult[] = [];
for (const [id, probe] of Object.entries(probes)) {
  if (wanted.length > 0 && !wanted.includes(id)) continue;
  try {
    const result = await probe();
    results.push(result);
    console.log(`${result.id} ${result.question}\n  ${JSON.stringify(result.observed)}`);
  } catch (error) {
    console.log(`${id} FAILED TO RUN: ${error instanceof Error ? error.stack : String(error)}`);
    results.push({ id, question: "(probe crashed)", observed: { error: String(error) } });
  }
}
mkdirSync(join(HERE, "results"), { recursive: true });
const redacted = redactPaths(JSON.stringify(results, null, 2), { "<root>": root, "~": realHome });
writeFileSync(
  join(HERE, "results", wanted.length ? `probes-${wanted.join("-")}.json` : "probes.json"),
  `${redacted}\n`,
);
try {
  rmSync(root, { recursive: true, force: true });
} catch {
  // the session database may still be open on Windows; the scratch folder is in the temp directory
}
process.exit(0);
