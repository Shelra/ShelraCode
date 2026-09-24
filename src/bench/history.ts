import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { redact } from "./field-cases";

/**
 * Benchmark history (bench/history/README.md): every benchmark run and field case in one versioned JSON
 * file, so growth, regressions and comparisons with other agents stay on record. Runs are merged by id:
 * a run already in the file is replaced by its newer copy, and nothing is ever dropped. Every text that
 * reaches the file has the home folder, the user name and the machine name removed, and workspace paths
 * are reduced to their last folder, because the repository is public.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface HistoryRun {
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
  tasks: {
    total: number;
    completed: number;
    resolved: number;
    resolvedRate: number | null;
    /** For a suite that judges kept decisions (`AC-KEEP-*`): see `decisionsKept`. */
    decisionsKept?: { kept: number; judged: number };
  };
  scores: Json;
  tokens: Json;
  costMicros: number | null;
  costKind: string | null;
  failureType: string | null;
  failureReason: string | null;
  taskResults: Json[];
}

export interface History {
  schemaVersion: 1;
  description: string;
  updatedAt: string;
  runs: HistoryRun[];
  fieldCases: Json[];
}

export interface Identity {
  home: string;
  user: string;
  host: string;
  /** The repository the run was made from: it and its sibling worktrees (`<name>-…`) read as `<repo>`. */
  repo?: string;
}

/** Who must not appear in the file: this user on this machine, under each home a run may have used. */
export function historyIdentities(extraHomes: readonly (string | undefined)[] = [], repo?: string): Identity[] {
  const identity: Identity = {
    home: homedir(),
    user: userInfo().username,
    host: hostname(),
    ...(repo ? { repo } : {}),
  };
  const homes = [...new Set(extraHomes.filter((home): home is string => Boolean(home) && home !== identity.home))];
  return [identity, ...homes.map((home) => ({ ...identity, home }))];
}

/** The repository root in either separator style, with an optional worktree suffix. */
function repoPattern(repo: string): RegExp {
  const parts = repo
    .replace(/[\\/]+$/u, "")
    .split(/[\\/]+/u)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  return new RegExp(`${parts.join("[\\\\/]+")}(?:-[\\w.-]+)?`, "giu");
}

export function cleanText(text: string, identities: readonly Identity[]): string {
  let out = text;
  for (const item of identities) {
    // The repository may live under the home folder: reduce it before the home is.
    if (item.repo) out = out.replace(repoPattern(item.repo), "<repo>");
    out = redact(out, item);
  }
  // A graded workspace path says nothing about the result; keep only its last folder.
  return out.replace(/(?:[A-Za-z]:)?[\\/][^\s"']*[\\/]tasks[\\/](?:run_[\w-]+[\\/])?([^\\/\s"']+)/gu, "<workspace>/$1");
}

function cleanJson(value: unknown, identities: readonly Identity[]): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return cleanText(value, identities);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => cleanJson(item, identities));
  if (typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = cleanJson(item, identities);
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

function pick(record: unknown, keys: readonly string[], identities: readonly Identity[]): Json {
  if (!record || typeof record !== "object") return null;
  const out: { [key: string]: Json } = {};
  for (const key of keys) {
    const value = (record as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = cleanJson(value, identities);
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

/** Reads benchmark runs and their tasks from a Shelra database, read-only; `runIds` limits which. */
export function readRunsFromDatabase(
  path: string,
  source: string,
  options: { identities: readonly Identity[]; runIds?: readonly string[] },
): HistoryRun[] {
  const { identities } = options;
  const wanted = options.runIds ? new Set(options.runIds) : null;
  const db = new Database(path, { readonly: true });
  try {
    const runs = db.query("select * from benchmark_runs order by run_number").all() as Record<string, unknown>[];
    const taskQuery = db.query("select * from benchmark_task_results where run_id = ? order by started_at");
    return runs
      .filter((run) => !wanted || wanted.has(String(run.id)))
      .map((run) => {
        const tasks = taskQuery.all(run.id as string) as Record<string, unknown>[];
        return {
          id: String(run.id),
          source,
          runNumber: Number(run.run_number),
          status: String(run.status),
          suite: String(run.benchmark_suite),
          benchmarkVersion: String(run.benchmark_version),
          agent: {
            name: String(run.agent_name),
            version: (run.agent_version as string | null) ?? null,
            config: cleanJson(parseJson(run.agent_config_json), identities),
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
            identities,
          ),
          tokens: cleanJson(
            {
              input: run.input_tokens,
              output: run.output_tokens,
              cached: run.cached_tokens,
              reasoning: run.reasoning_tokens,
              total: run.total_tokens,
            },
            identities,
          ),
          costMicros: (run.cost_micros as number | null) ?? null,
          costKind: (run.cost_kind as string | null) ?? null,
          failureType: (run.failure_type as string | null) ?? null,
          failureReason:
            typeof run.failure_reason === "string" ? cleanText(run.failure_reason, identities).slice(0, 400) : null,
          taskResults: tasks.map((task) => {
            const definition = parseJson(task.task_definition_json) as Record<string, unknown> | null;
            return cleanJson(
              {
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
                acceptance: (parseJson(task.acceptance_json) as Array<Record<string, unknown>> | null)?.map(
                  (criterion) => ({
                    id: criterion.id,
                    status: criterion.status,
                    detail: typeof criterion.detail === "string" ? criterion.detail.slice(0, 300) : undefined,
                  }),
                ),
                finalResult: pick(parseJson(task.final_result_json), FINAL_RESULT_KEYS, identities),
                failureType: task.failure_type,
                failureReason: typeof task.failure_reason === "string" ? task.failure_reason.slice(0, 300) : null,
                promptWords: typeof definition?.prompt === "string" ? definition.prompt.split(/\s+/u).length : null,
              },
              identities,
            );
          }),
        };
      });
  } finally {
    db.close();
  }
}

/**
 * Decisions kept (the decision chain's metric, F6 of the execution plan): `AC-KEEP-*` criteria passed over
 * those judged at steps whose request (`AC-REQUEST`) was done. Null for a run whose suite judges none. Computed
 * here, not by hand: the plan once reported the steps passed under this name (review round 3, 2026-09-24).
 */
export function decisionsKept(taskResults: readonly Json[]): { kept: number; judged: number } | null {
  let kept = 0;
  let judged = 0;
  let judgesDecisions = false;
  for (const task of taskResults) {
    const acceptance = (task as { acceptance?: Array<{ id?: unknown; status?: unknown }> } | null)?.acceptance ?? [];
    const decisions = acceptance.filter((criterion) => String(criterion.id).startsWith("AC-KEEP"));
    if (decisions.length > 0) judgesDecisions = true;
    const request = acceptance.find((criterion) => criterion.id === "AC-REQUEST");
    if (request?.status !== "passed") continue;
    judged += decisions.length;
    kept += decisions.filter((criterion) => criterion.status === "passed").length;
  }
  return judgesDecisions ? { kept, judged } : null;
}

export function readFieldCases(casesDir: string, identities: readonly Identity[]): Json[] {
  if (!existsSync(casesDir)) return [];
  return readdirSync(casesDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => cleanJson(JSON.parse(readFileSync(join(casesDir, file), "utf8")), identities));
}

export function loadHistory(historyPath: string): History {
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

/** Merges runs into a history by id, newest copy wins; returns how many were new and how many replaced. */
export function mergeRuns(history: History, runs: readonly HistoryRun[]): { added: number; replaced: number } {
  const byId = new Map(history.runs.map((run) => [run.id, run]));
  let added = 0;
  let replaced = 0;
  for (const run of runs) {
    if (byId.has(run.id)) replaced += 1;
    else added += 1;
    byId.set(run.id, run);
  }
  history.runs = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { added, replaced };
}

/**
 * Writes the history as formatted JSON and reads it back. No formatter runs here: one spawned after each save
 * could still be writing when the next save began, and a shorter save then kept the tail of the formatter's
 * longer write, which left the file unreadable (2026-09-24, importing six runs one after another). The
 * pre-commit hook formats the file when it is committed.
 */
export function saveHistory(historyPath: string, history: History): void {
  history.updatedAt = new Date().toISOString();
  mkdirSync(dirname(historyPath), { recursive: true });
  const text = `${JSON.stringify(history, null, 2)}\n`;
  writeFileSync(historyPath, text);
  if (readFileSync(historyPath, "utf8") !== text) throw new Error(`${historyPath} did not save cleanly.`);
}

/** Adds runs from a database to the history file of a repository, with its field cases refreshed. */
export function appendRunsToHistory(input: {
  repositoryRoot: string;
  databasePath: string;
  source: string;
  runIds?: readonly string[];
  extraHomes?: readonly (string | undefined)[];
}): { historyPath: string; runs: number; added: number; replaced: number; fieldCases: number } {
  const identities = historyIdentities(input.extraHomes, input.repositoryRoot);
  const historyPath = join(input.repositoryRoot, "bench", "history", "benchmark-history.json");
  const history = loadHistory(historyPath);
  const counts = mergeRuns(
    history,
    readRunsFromDatabase(input.databasePath, input.source, {
      identities,
      ...(input.runIds ? { runIds: input.runIds } : {}),
    }),
  );
  history.fieldCases = readFieldCases(join(input.repositoryRoot, "bench", "field", "cases"), identities);
  // Every run's, the ones already on record too.
  for (const run of history.runs) {
    const kept = decisionsKept(run.taskResults);
    if (kept) run.tasks.decisionsKept = kept;
  }
  saveHistory(historyPath, history);
  return { historyPath, runs: history.runs.length, ...counts, fieldCases: history.fieldCases.length };
}
