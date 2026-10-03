/**
 * Year-in-a-Box, layer 1 (docs/architecture/20-LONG-HORIZON-AUDIT.md §15): one project lived for a year in twelve
 * epochs, each a fresh session in its own process, through the real `Agent.processMessage` with real tools, real
 * storage (SQLite sessions, `.shelra/memory`, `docs/decisions`) and a simulated clock. The model is scripted and ideal
 * (`ledgerly.ts`), so what a fresh session lacks at the end is the harness's limit. Deterministic; no network, no
 * model quota. Epoch 8 is killed mid-turn.
 *
 *   bun run bench/long-horizon/year-in-a-box.ts                     # full harness
 *   bun run bench/long-horizon/year-in-a-box.ts --ablate memory     # the same year with memory off
 *   bun run bench/long-horizon/year-in-a-box.ts --label x --keep    # keep the scratch folder for inspection
 *
 * It scores what reached the model on the first request of epochs 9 to 12 against the facts the year established,
 * and writes `results/<label>.json`.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EPOCHS, type Epoch, LEDGERLY_FIXTURE, type ScriptStep } from "./ledgerly";
import { redactPaths } from "./redact";

const HERE = dirname(fileURLToPath(import.meta.url));
const RealDate = Date;
const realNow = RealDate.now.bind(RealDate);

interface Args {
  child?: number;
  root?: string;
  ablate: string[];
  label: string;
  keep: boolean;
  /** Stop after this epoch and keep the scratch folder: a project state for a real-model turn (`real-run.ts`). */
  stopAfter?: number;
  /**
   * `tests-allowed`: the user adds "Update the tests as needed." to every work request (isolates test protection);
   * `resume`: epoch 9 resumes the latest session (`shelra -s latest`) instead of starting a new one.
   */
  variant?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { ablate: [], label: "full", keep: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--child" && value) args.child = Number(argv[++index]);
    else if (flag === "--root" && value) args.root = argv[++index];
    else if (flag === "--ablate" && value) args.ablate = (argv[++index] ?? "").split(",").filter(Boolean);
    else if (flag === "--label" && value) args.label = argv[++index] ?? args.label;
    else if (flag === "--keep") args.keep = true;
    else if (flag === "--variant" && value) args.variant = argv[++index];
    else if (flag === "--stop-after" && value) {
      args.stopAfter = Number(argv[++index]);
      args.keep = true;
    }
  }
  if (args.ablate.length > 0 && args.label === "full") args.label = `ablate-${args.ablate.join("-")}`;
  if (args.variant && args.label === "full") args.label = args.variant;
  if (args.stopAfter !== undefined && args.label === "full") args.label = `state-after-e${args.stopAfter}`;
  return args;
}

/** Every `new Date()` and `Date.now()` in this process reads the epoch's date, moving forward in real time. */
function installClock(target: number): void {
  const offset = target - realNow();
  class SimulatedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(realNow() + offset);
      else super(...(args as [string]));
    }
    static now(): number {
      return realNow() + offset;
    }
  }
  globalThis.Date = SimulatedDate as unknown as DateConstructor;
}

/** Files the epoch wrote carry its date, as they would have; otherwise every memory entry would look stale. */
function stampMtimes(dir: string, since: number, at: number): void {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === ".shelra" || name === "node_modules") continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) stampMtimes(full, since, at);
    else if (stat.mtimeMs >= since - 1_000) utimesSync(full, at / 1000, at / 1000);
  }
}

interface Capture {
  round: number;
  system: string;
  messages: unknown[];
  tools: string[];
}

function toolEvent(id: string, step: ScriptStep) {
  return {
    type: "tool-call" as const,
    toolCall: { id, type: "function" as const, function: { name: step.tool, arguments: JSON.stringify(step.input) } },
  };
}

/** The work epochs whose changes touch an existing test, apart from the continuation (epoch 9), whose wording must stay. */
const TESTS_TOUCHED = [4, 5, 6, 7, 10];

/** The epochs as the variant words them. */
function epochsFor(variant: string | undefined): Epoch[] {
  if (variant !== "tests-allowed") return EPOCHS;
  return EPOCHS.map((epoch) =>
    TESTS_TOUCHED.includes(epoch.id) ? { ...epoch, user: `${epoch.user} Update the tests as needed.` } : epoch,
  );
}

async function runChild(epochId: number, root: string, ablate: string[], variant?: string): Promise<void> {
  const epoch = epochsFor(variant).find((candidate) => candidate.id === epochId) as Epoch;
  const home = join(root, "home");
  const workspace = join(root, "ledgerly");
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.SHELRA_USER_MEMORY_ROOT = home;
  process.env.SHELRA_RESEARCH = "off";
  process.env.SHELRA_TRACE_DIR = join(root, "traces");
  process.env.SHELRA_DIAGNOSTICS_LOG = join(root, "swallowed-errors.jsonl");
  const target = Date.parse(epoch.date);
  installClock(target);
  const realStart = realNow();
  const { Agent } = await import("../../src/agent/agent");

  const captures: Capture[] = [];
  const toolOutputs: Array<{ tool: string; output: unknown }> = [];
  const textCalls: Array<{ kind: string; chars: number }> = [];
  let round = 0;
  let toolResults = 0;
  const provider = {
    id: "year-in-a-box",
    defaultModelId: epoch.model,
    resolveModelRuntime: (modelId: string) => ({
      modelId,
      modelInfo: {
        id: modelId,
        name: "Scripted ideal model",
        contextWindow: 200_000,
        inputPrice: 0,
        outputPrice: 0,
        reasoning: false,
        description: "Year-in-a-Box scripted model",
        supportsClientTools: true,
        supportsMaxOutputTokens: true,
      },
    }),
    stream: (request: { system: string; messages: unknown[]; tools?: Record<string, unknown> }) => {
      captures.push({
        round: round + 1,
        system: request.system,
        // A copy: the agent keeps appending to the same array, and the capture is what this request carried.
        messages: JSON.parse(JSON.stringify(request.messages)),
        tools: Object.keys(request.tools ?? {}),
      });
      const steps = epoch.rounds[round] ?? [];
      const answer = round === 0 ? epoch.answer : "Done.";
      round += 1;
      const tools = (request.tools ?? {}) as Record<
        string,
        { execute?: (input: unknown, options: unknown) => Promise<unknown> }
      >;
      const thisRound = round;
      // The response carries the tool calls and results as the AI SDK's would, so the transcript holds them.
      const messages: unknown[] = [];
      let finish: (value: { messages: unknown[] }) => void = () => {};
      const response = new Promise<{ messages: unknown[] }>((resolve) => {
        finish = resolve;
      });
      return {
        events: (async function* () {
          for (const [index, step] of steps.entries()) {
            if (epoch.crashAfterTools !== undefined && toolResults >= epoch.crashAfterTools) {
              writeFileSync(join(root, `crash-ready-e${epoch.id}`), String(process.pid));
              await new Promise(() => {});
            }
            const id = `e${epoch.id}-r${thisRound}-${index}`;
            yield toolEvent(id, step);
            const output = await tools[step.tool]?.execute?.(step.input, { toolCallId: id, messages: [] });
            toolOutputs.push({ tool: step.tool, output });
            toolResults += 1;
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
            yield { ...toolEvent(id, step), type: "tool-result" as const, output };
          }
          yield { type: "text-delta" as const, text: answer };
          messages.push({ role: "assistant", content: answer });
          finish({ messages });
        })(),
        response,
      };
    },
    generateText: async (request: { system: string; prompt: string; modelId: string }) => {
      const reflection = request.system.includes("extract durable project knowledge");
      textCalls.push({ kind: reflection ? "reflection" : "other", chars: request.prompt.length });
      return {
        text: reflection ? JSON.stringify({ memories: epoch.reflection }) : "Summary.",
        modelId: request.modelId,
      };
    },
    getToolContext: () => ({}),
  };

  const agent = new Agent(undefined, undefined, epoch.model, undefined, {
    // The scripted provider satisfies the adapter contract structurally.
    provider: provider as never,
    cwd: workspace,
    persistSession: true,
    // `resume`: after the crash the user picks the last session up with `shelra -s latest` instead of a new one.
    ...(variant === "resume" && epoch.id === 9 ? { session: "latest" } : {}),
    ablate: ablate as never,
  });
  if (epoch.approveDecisions) agent.setDecisionApproval(async () => "approve");
  let text = "";
  for await (const chunk of agent.processMessage(epoch.user)) {
    const item = chunk as { type: string; content?: string };
    if (item.type === "content" && item.content) text += item.content;
  }
  writeFileSync(
    join(root, "captures", `e${epoch.id}.json`),
    JSON.stringify({ epoch: epoch.id, captures, text, toolOutputs, textCalls }, null, 2),
  );
  stampMtimes(workspace, realStart, target);
  process.exit(0);
}

function git(workspace: string, home: string, args: string[], date?: string): string {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
  };
  const result = spawnSync("git", args, { cwd: workspace, env, encoding: "utf8" });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => child.on("exit", (code) => resolve(code)));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

interface Snapshot {
  epoch: number;
  exit: string;
  memoryIndex: string[];
  decisions: Array<{ file: string; status: string }>;
  episodes: number;
  live: number;
  archived: number;
  verdict: string;
}

function snapshot(root: string, epoch: Epoch, exit: string): Snapshot {
  const workspace = join(root, "ledgerly");
  const memory = join(workspace, ".shelra", "memory");
  const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");
  const decisionsDir = join(workspace, "docs", "decisions");
  const decisions = existsSync(decisionsDir)
    ? readdirSync(decisionsDir)
        .filter((file) => file.endsWith(".md"))
        .map((file) => ({ file, status: /status:\s*(\w+)/u.exec(read(join(decisionsDir, file)))?.[1] ?? "?" }))
    : [];
  const capture = join(root, "captures", `e${epoch.id}.json`);
  const text = existsSync(capture) ? (JSON.parse(read(capture)) as { text: string }).text : "";
  const verdict =
    /\[(?:Checked by Shelra|Not verified|Not marked complete|Cancelled|Paused|Limited|Error)[^\]]*\]/u.exec(text);
  return {
    epoch: epoch.id,
    exit,
    memoryIndex: read(join(memory, "MEMORY.md"))
      .split("\n")
      .filter((line) => line.startsWith("- ")),
    decisions,
    episodes: read(join(memory, "episodes.jsonl")).split("\n").filter(Boolean).length,
    live: existsSync(join(memory, "live")) ? readdirSync(join(memory, "live")).length : 0,
    archived: read(join(memory, "archive.jsonl")).split("\n").filter(Boolean).length,
    verdict: verdict ? verdict[0].slice(0, 160) : "(no verdict line)",
  };
}

/** The text of a model request: system prompt, then every message's text, tool inputs and tool results. */
function requestText(capture: Capture | undefined): string {
  if (!capture) return "";
  const parts: string[] = [capture.system];
  for (const message of capture.messages as Array<{ role: string; content: unknown }>) {
    if (typeof message.content === "string") {
      parts.push(`[${message.role}] ${message.content}`);
      continue;
    }
    for (const part of (message.content ?? []) as Array<Record<string, unknown>>) {
      if (typeof part.text === "string") parts.push(`[${message.role}] ${part.text}`);
      else parts.push(`[${message.role}:${String(part.type)}] ${JSON.stringify(part.input ?? part.output ?? "")}`);
    }
  }
  return parts.join("\n");
}

interface Fact {
  id: string;
  label: string;
  /** Every pattern must appear in the request. */
  all: RegExp[];
  /** The epochs whose first request should carry it. */
  epochs: number[];
}

/** What the year established, and the words that show a fact reached the model. */
const FACTS: Fact[] = [
  {
    id: "F1",
    label: "original purpose (offline tracker for freelancers)",
    all: [/freelancer/iu, /offline/iu],
    epochs: [9, 12],
  },
  {
    id: "F2",
    label: "privacy constraint (nothing leaves the machine)",
    all: [/(nothing (may )?leaves?|no telemetry|no network)/iu],
    epochs: [9, 10, 12],
  },
  { id: "F3", label: "standing rule: money as integer cents", all: [/integer cents/iu], epochs: [9, 10, 11, 12] },
  { id: "F4", label: "standing rule: no new dependency without asking", all: [/dependency/iu], epochs: [9, 10, 12] },
  { id: "F5", label: "active architecture: DuckDB", all: [/duckdb/iu], epochs: [9, 11, 12] },
  { id: "F6", label: "rationale of DuckDB (columnar queries)", all: [/columnar/iu], epochs: [11, 12] },
  { id: "F7", label: "what came before (SQLite, and JSON before it)", all: [/sqlite/iu, /json/iu], epochs: [11] },
  { id: "F8", label: "rationale of SQLite and rejected Postgres", all: [/postgres/iu], epochs: [11] },
  {
    id: "F9",
    label: "current scope: yearly tax summary replaced the monthly report",
    all: [/tax summary/iu, /monthly report/iu],
    epochs: [12],
  },
  { id: "F10", label: "CSV import knowledge (old feature)", all: [/parseCsv|csv import/iu], epochs: [10, 12] },
  { id: "F11", label: "failure lesson: decimal-comma amounts", all: [/1\.234,56|decimal comma/iu], epochs: [10] },
  {
    id: "F12",
    label: "the refactor's target modules (src/reports among them)",
    all: [/src\/reports/iu],
    epochs: [9, 12],
  },
  { id: "F13", label: "the turn interrupted by the crash", all: [/interrupted/iu], epochs: [9] },
  {
    id: "F14",
    label: "plan/progress of the refactor (steps done vs remaining)",
    all: [/(importers and reports remain|reports remain|steps? 3\b)/iu],
    epochs: [9, 12],
  },
];

/** Lines of the request that name a superseded engine, to read whether they are framed as past or as current. */
function supersededMentions(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => /sqlite|json files?|monthly json|monthly report/iu.test(line))
    .map((line) => line.trim().slice(0, 240));
}

/** Standing-rule lines that name an engine the year replaced without naming the current one. */
function supersededRulesShown(text: string): string[] {
  const start = text.indexOf("Standing rules");
  if (start < 0) return [];
  const block = text.slice(start).split("\n\n")[0] ?? "";
  return block
    .split("\n")
    .filter((line) => line.startsWith("- ") && /sqlite|json files?/iu.test(line) && !/duckdb/iu.test(line))
    .map((line) => line.trim());
}

interface EpisodeLine {
  at: string;
  outcome: string;
  request: string;
  summary?: string;
}

/** The newest episodes first, one line each, until the budget is spent. */
function digestOf(episodes: EpisodeLine[], budget: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const episode of [...episodes].reverse()) {
    const line = `- ${episode.at.slice(0, 10)} · ${episode.outcome} · ${episode.request.slice(0, 220)} → ${(episode.summary ?? "").slice(0, 220)}`;
    if (used + line.length > budget) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

/** Ordinary turns of a busy project, after December. */
function routineEpisodes(count: number): EpisodeLine[] {
  return Array.from({ length: count }, (_, index) => ({
    at: `2026-12-${String(16 + Math.floor(index / 30)).padStart(2, "0")}T10:00:00Z`,
    outcome: "verified",
    request: `Rename the helper number ${index} in the importer and tidy its comments.`,
    summary: `Renamed helper ${index}; tests pass.`,
  }));
}

/** Every session the year created, with how many messages its transcript kept. */
function sessionSummary(home: string): Array<{ created: string; model: string; messages: number; toolCalls: number }> {
  const file = join(home, ".shelra", "shelra.db");
  if (!existsSync(file)) return [];
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `const { Database } = require("bun:sqlite"); const db = new Database(${JSON.stringify(file)}, { readonly: true }); console.log(JSON.stringify(db.query("select s.created_at created, s.model model, (select count(*) from messages m where m.session_id = s.id) messages, (select count(*) from tool_calls t where t.session_id = s.id) toolCalls from sessions s order by s.created_at").all()));`,
    ],
    { encoding: "utf8" },
  );
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return [];
  }
}

async function orchestrate(args: Args): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "shelra-yib-"));
  const home = join(root, "home");
  const workspace = join(root, "ledgerly");
  for (const dir of [home, workspace, join(root, "captures"), join(root, "traces")])
    mkdirSync(dir, { recursive: true });
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Ledgerly Owner\n\temail = owner@ledgerly.invalid\n");
  for (const [file, content] of Object.entries(LEDGERLY_FIXTURE)) {
    mkdirSync(dirname(join(workspace, file)), { recursive: true });
    writeFileSync(join(workspace, file), content);
  }
  git(workspace, home, ["init", "-q", "-b", "main"]);
  git(workspace, home, ["add", "-A"]);
  git(workspace, home, ["commit", "-q", "-m", "Start Ledgerly"], "2026-01-05T09:00:00Z");

  const snapshots: Snapshot[] = [];
  for (const epoch of epochsFor(args.variant)) {
    if (args.stopAfter !== undefined && epoch.id > args.stopAfter) break;
    const started = realNow();
    const child = spawn(
      process.execPath,
      [
        "run",
        join(HERE, "year-in-a-box.ts"),
        "--child",
        String(epoch.id),
        "--root",
        root,
        ...(args.ablate.length ? ["--ablate", args.ablate.join(",")] : []),
        ...(args.variant ? ["--variant", args.variant] : []),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (data) => {
      stderr += String(data);
    });
    let exit: string;
    if (epoch.crashAfterTools !== undefined) {
      const marker = join(root, `crash-ready-e${epoch.id}`);
      const liveDir = join(workspace, ".shelra", "memory", "live");
      const deadline = realNow() + 120_000;
      while (realNow() < deadline && !(existsSync(marker) && existsSync(liveDir) && readdirSync(liveDir).length > 0)) {
        await sleep(100);
      }
      await sleep(300);
      child.kill("SIGKILL");
      await waitForExit(child);
      exit = existsSync(marker) ? "killed mid-turn after its first tool result" : "killed (marker missing)";
    } else {
      const code = await waitForExit(child);
      exit = code === 0 ? "ok" : `exit ${code}: ${stderr.slice(-400)}`;
    }
    if (epoch.commit) {
      git(workspace, home, ["add", "-A"]);
      git(workspace, home, ["commit", "-q", "-m", epoch.commit], epoch.date);
    }
    const shot = snapshot(root, epoch, exit);
    snapshots.push(shot);
    console.log(
      `E${String(epoch.id).padStart(2)} ${epoch.date.slice(0, 10)} ${((realNow() - started) / 1000).toFixed(1)}s ${exit} | memory ${shot.memoryIndex.length} | decisions ${shot.decisions.map((d) => `${d.file.slice(0, 6)}:${d.status}`).join(" ") || "-"} | episodes ${shot.episodes} | live ${shot.live} | ${shot.verdict}`,
    );
  }

  const sessions = sessionSummary(home);
  console.log(
    `sessions: ${sessions.map((row) => `${row.created.slice(0, 10)} ${row.model} msgs=${row.messages}`).join(" | ")}`,
  );
  const results: Record<string, unknown> = {
    label: args.label,
    ablate: args.ablate,
    variant: args.variant ?? null,
    root,
    snapshots,
    sessions,
    epochs: {},
  };
  const matrix: string[] = [];
  for (const id of [9, 10, 11, 12]) {
    const file = join(root, "captures", `e${id}.json`);
    if (!existsSync(file)) continue;
    const data = JSON.parse(readFileSync(file, "utf8")) as {
      captures: Capture[];
      toolOutputs: Array<{ tool: string; output: unknown }>;
    };
    const first = requestText(data.captures[0]);
    const facts = FACTS.filter((fact) => fact.epochs.includes(id)).map((fact) => ({
      id: fact.id,
      label: fact.label,
      reached: fact.all.every((pattern) => pattern.test(first)),
    }));
    const memoryList = data.toolOutputs.find((item) => item.tool === "memory_list")?.output as
      | { output?: string }
      | undefined;
    const supersededAsCurrent = supersededRulesShown(first);
    (results.epochs as Record<string, unknown>)[`e${id}`] = {
      user: epochsFor(args.variant).find((epoch) => epoch.id === id)?.user,
      firstRequestChars: first.length,
      systemChars: data.captures[0]?.system.length ?? 0,
      facts,
      supersededAsCurrent,
      supersededMentions: supersededMentions(first),
      memoryListOutput: memoryList?.output,
      firstRequest: first,
    };
    matrix.push(
      `E${id}: ${facts.filter((fact) => fact.reached).length}/${facts.length} facts reached, ${supersededAsCurrent.length} superseded shown as current (${first.length} chars) — missing: ${
        facts
          .filter((fact) => !fact.reached)
          .map((fact) => fact.id)
          .join(", ") || "none"
      }`,
    );
  }
  // A counterfactual, not product behavior: what a host-side digest of the episode log Shelra already writes would
  // carry, newest first within the knowledge tier's 3,000 characters, as the log stands after December, and after a
  // busy project's routine turns pile on top of it (the owner's main project averaged about 11 sessions a day).
  const episodesFile = join(workspace, ".shelra", "memory", "episodes.jsonl");
  const episodes = existsSync(episodesFile)
    ? readFileSync(episodesFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as EpisodeLine)
    : [];
  const digests = [0, 30, 300].map((routine) => {
    const text = digestOf([...episodes, ...routineEpisodes(routine)], 3_000);
    const reached = FACTS.filter((fact) => fact.all.every((pattern) => pattern.test(text))).map((fact) => fact.id);
    return { routineEpisodesAdded: routine, chars: text.length, reached, of: FACTS.length };
  });
  results.digestCounterfactual = digests;
  matrix.push(
    `digest counterfactual: ${digests.map((digest) => `+${digest.routineEpisodesAdded} routine → ${digest.reached.length}/${digest.of}`).join(", ")}`,
  );
  console.log(matrix.join("\n"));
  mkdirSync(join(HERE, "results"), { recursive: true });
  writeFileSync(
    join(HERE, "results", `${args.label}.json`),
    `${redactPaths(JSON.stringify(results, null, 2), { "<root>": root })}\n`,
  );
  console.log(`results/${args.label}.json written; scratch root ${args.keep ? root : "(removed)"}`);
  if (!args.keep) rmSync(root, { recursive: true, force: true });
}

const args = parseArgs(process.argv.slice(2));
if (args.child !== undefined && args.root) await runChild(args.child, args.root, args.ablate, args.variant);
else await orchestrate(args);
