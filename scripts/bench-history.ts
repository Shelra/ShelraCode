/**
 * Benchmark history (bench/history/README.md): every benchmark run and field case in one versioned
 * JSON file, so growth, regressions and comparisons with other agents stay on record.
 *
 *   bun run scripts/bench-history.ts import --db <shelra.db> [--db <other.db>] [--source <label>]
 *   bun run scripts/bench-history.ts summary
 *
 * `import` opens each session database read-only, reads its benchmark runs and their tasks, adds the
 * field cases from bench/field/cases, and merges everything into bench/history/benchmark-history.json
 * by run id: a run already in the file is replaced by its newer copy, and nothing is ever dropped.
 * Every text that leaves this script has the home folder, the user name and the machine name
 * removed, and workspace paths are reduced to their last folder: the repository is public.
 */
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { redact } from "../src/bench/field-cases";

const root = resolve(import.meta.dir, "..");
const historyPath = join(root, "bench", "history", "benchmark-history.json");
const casesDir = join(root, "bench", "field", "cases");
const identity = { home: homedir(), user: userInfo().username, host: hostname() };
// A benchmark run under a scratch home still records paths under the real one; redact both.
const realHome = process.env.SHELRA_REDACT_HOME || process.env.AUDIT_REAL_USERPROFILE;
const identities = realHome ? [identity, { ...identity, home: realHome }] : [identity];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface HistoryRun {
  id: string;
  source: string;
  runNumber: number;
  status: string;
  suite: string;
  benchmarkVersion: string;
  agent: { name: string; version: string | null; config: Json };
  model: string | null;
  modelProvider: string | null;
  harnessCommit: string | null;
  harnessDirty: boolean | null;
  createdAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  tasks: { total: number; completed: number; resolved: number; resolvedRate: number | null };
  scores: Json;
  tokens: Json;
  costMicros: number | null;
  costKind: string | null;
  failureType: string | null;
  failureReason: string | null;
  taskResults: Json[];
}

interface History {
  schemaVersion: 1;
  description: string;
  updatedAt: string;
  runs: HistoryRun[];
  fieldCases: Json[];
}

function clean(text: string): string {
  let out = text;
  for (const item of identities) out = redact(out, item);
  // A graded workspace path says nothing about the result; keep only its last folder.
  return out.replace(/(?:[A-Za-z]:)?[\\/][^\s"']*[\\/]tasks[\\/]([^\\/\s"']+)/gu, "<workspace>/$1");
}

function cleanJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return clean(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(cleanJson);
  if (typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = cleanJson(item);
    return out;
  }
  return String(value);
}

function parseJson(text: unknown): unknown {
  if (typeof text !== "string" || !text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pick(record: unknown, keys: readonly string[]): Json {
  if (!record || typeof record !== "object") return null;
  const out: { [key: string]: Json } = {};
  for (const key of keys) {
    const value = (record as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = cleanJson(value);
  }
  return out;
}

const FINAL_RESULT_KEYS = [
  "harness",
  "model",
  "modelsUsed",
  "reasoningEffort",
  "verified",
  "completionBlocked",
  "timedOut",
  "turnError",
  "llmSteps",
  "numTurns",
  "memoryExpanded",
  "memoryWritten",
  "memoryQualified",
  "routingNotes",
  "costUsd",
  "itemCounts",
  "finalTextExcerpt",
] as const;

function readDatabase(path: string, source: string): HistoryRun[] {
  const db = new Database(path, { readonly: true });
  const runs = db.query("select * from benchmark_runs order by run_number").all() as Record<string, unknown>[];
  const taskQuery = db.query("select * from benchmark_task_results where run_id = ? order by started_at");
  const history: HistoryRun[] = [];
  for (const run of runs) {
    const tasks = taskQuery.all(run.id as string) as Record<string, unknown>[];
    history.push({
      id: String(run.id),
      source,
      runNumber: Number(run.run_number),
      status: String(run.status),
      suite: String(run.benchmark_suite),
      benchmarkVersion: String(run.benchmark_version),
      agent: {
        name: String(run.agent_name),
        version: (run.agent_version as string | null) ?? null,
        config: cleanJson(parseJson(run.agent_config_json)),
      },
      model: (run.model as string | null) ?? null,
      modelProvider: (run.model_provider as string | null) ?? null,
      harnessCommit: (run.repository_commit as string | null) ?? null,
      harnessDirty: run.repository_dirty === null ? null : Boolean(run.repository_dirty),
      createdAt: String(run.created_at),
      finishedAt: (run.finished_at as string | null) ?? null,
      durationMs: (run.duration_ms as number | null) ?? null,
      tasks: {
        total: Number(run.task_count ?? 0),
        completed: Number(run.completed_task_count ?? 0),
        resolved: Number(run.resolved_task_count ?? 0),
        resolvedRate: (run.resolved_rate as number | null) ?? null,
      },
      scores: cleanJson(
        parseJson(run.scores_json) ?? {
          overall: run.overall_score,
          coding: run.coding_score,
          intent: run.intent_score,
          verification: run.verification_score,
        },
      ),
      tokens: cleanJson({
        input: run.input_tokens,
        output: run.output_tokens,
        cached: run.cached_tokens,
        reasoning: run.reasoning_tokens,
        total: run.total_tokens,
      }),
      costMicros: (run.cost_micros as number | null) ?? null,
      costKind: (run.cost_kind as string | null) ?? null,
      failureType: (run.failure_type as string | null) ?? null,
      failureReason: typeof run.failure_reason === "string" ? clean(run.failure_reason).slice(0, 400) : null,
      taskResults: tasks.map((task) => {
        const definition = parseJson(task.task_definition_json) as Record<string, unknown> | null;
        return cleanJson({
          taskId: task.task_id,
          category: task.category,
          difficulty: task.difficulty,
          status: task.status,
          durationMs: task.duration_ms,
          llmDurationMs: task.llm_duration_ms,
          toolDurationMs: task.tool_duration_ms,
          scores: parseJson(task.scores_json),
          tokens: { input: task.input_tokens, output: task.output_tokens, total: task.total_tokens },
          costMicros: task.cost_micros,
          behavior: parseJson(task.behavior_json),
          acceptance: (parseJson(task.acceptance_json) as Array<Record<string, unknown>> | null)?.map((criterion) => ({
            id: criterion.id,
            status: criterion.status,
            detail: typeof criterion.detail === "string" ? criterion.detail.slice(0, 300) : undefined,
          })),
          finalResult: pick(parseJson(task.final_result_json), FINAL_RESULT_KEYS),
          failureType: task.failure_type,
          failureReason: typeof task.failure_reason === "string" ? task.failure_reason.slice(0, 300) : null,
          promptWords: typeof definition?.prompt === "string" ? definition.prompt.split(/\s+/u).length : null,
        });
      }),
    });
  }
  db.close();
  return history;
}

function readFieldCases(): Json[] {
  if (!existsSync(casesDir)) return [];
  return readdirSync(casesDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => cleanJson(JSON.parse(readFileSync(join(casesDir, file), "utf8"))));
}

function loadHistory(): History {
  if (existsSync(historyPath)) return JSON.parse(readFileSync(historyPath, "utf8")) as History;
  return {
    schemaVersion: 1,
    description:
      "Every Shelra Bench run and field case, with the agent, model, harness commit and per-task results. Runs are merged by id and never dropped.",
    updatedAt: new Date().toISOString(),
    runs: [],
    fieldCases: [],
  };
}

function importCommand(args: string[]): void {
  const dbs: string[] = [];
  let source = "shelra-db";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--db" && args[index + 1]) dbs.push(args[++index] as string);
    else if (args[index] === "--source" && args[index + 1]) source = args[++index] as string;
  }
  if (dbs.length === 0) dbs.push(join(homedir(), ".shelra", "shelra.db"));
  const history = loadHistory();
  const byId = new Map(history.runs.map((run) => [run.id, run]));
  let added = 0;
  let replaced = 0;
  for (const db of dbs) {
    for (const run of readDatabase(db, source)) {
      if (byId.has(run.id)) replaced += 1;
      else added += 1;
      byId.set(run.id, run);
    }
  }
  history.runs = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  history.fieldCases = readFieldCases();
  history.updatedAt = new Date().toISOString();
  mkdirSync(dirname(historyPath), { recursive: true });
  writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`);
  // Leave the file as the repository's formatter would, so `bun run format` stays green after an import.
  spawnSync(process.execPath, ["x", "biome", "format", "--write", historyPath], { cwd: root, stdio: "ignore" });
  console.log(
    `${basename(historyPath)}: ${history.runs.length} runs (${added} new, ${replaced} updated), ${history.fieldCases.length} field cases`,
  );
}

function summaryCommand(): void {
  const history = loadHistory();
  for (const run of history.runs) {
    const config = run.agent.config as { ablation?: string } | null;
    const ablation = config?.ablation && config.ablation !== "none" ? ` [${config.ablation}]` : "";
    console.log(
      [
        run.createdAt.slice(0, 16),
        `${run.agent.name}${ablation}`.padEnd(22),
        (run.model ?? "?").padEnd(52),
        run.suite.padEnd(34),
        `${run.tasks.resolved}/${run.tasks.total}`.padEnd(6),
        run.status,
      ].join("  "),
    );
  }
}

const [command, ...rest] = process.argv.slice(2);
if (command === "import") importCommand(rest);
else if (command === "summary") summaryCommand();
else {
  console.error("Usage: bun run scripts/bench-history.ts import [--db <path>]... [--source <label>] | summary");
  process.exitCode = 1;
}
