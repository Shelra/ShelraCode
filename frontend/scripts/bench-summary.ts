/**
 * Landing-page benchmark data, derived from the versioned benchmark history.
 *
 *   bun run scripts/bench-summary.ts        (from frontend/; also `bun run bench:sync`)
 *
 * Reads ../bench/history/benchmark-history.json (the record of every Shelra Bench run and field
 * case, see bench/history/README.md) and writes src/lib/bench-summary.json: per agent and model, every
 * completed core-suite run of its latest measured version (the table), the progression of the product
 * path on its pinned model, and the field cases. The site never computes numbers itself; re-run this
 * after importing runs.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const historyPath = resolve(root, "..", "bench", "history", "benchmark-history.json");
const manifestPath = resolve(root, "..", "bench", "suites", "shelra-agent-core-v0.2.json");
const outPath = resolve(root, "src", "lib", "bench-summary.json");

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
  harnessCommit: string | null;
  createdAt: string;
  durationMs: number | null;
  tasks: { total: number; completed: number; resolved: number; resolvedRate: number | null };
  costMicros: number | null;
  /** How the cost was obtained: "exact" (billed), "estimated" (catalog prices) or "unavailable". */
  costKind?: string | null;
  taskResults: { taskId?: string; status?: string; failureReason?: string | null }[];
}

interface FieldCase {
  id: string;
  date: string;
  title: string;
  shelra?: {
    model?: string;
    solved?: boolean;
    attemptsToSolve?: number;
    toolCalls?: number;
    gateLoops?: number;
    secondsToFirstAnswer?: number;
  };
  reference?: { agent?: string; solved?: boolean; attemptsToSolve?: number };
  reruns?: {
    date: string;
    commit: string;
    model: string;
    seconds: number;
    toolCalls: number;
    gateLoops: number;
    result: string;
  }[];
}

interface History {
  updatedAt: string;
  runs: HistoryRun[];
  fieldCases: FieldCase[];
}

/**
 * One agent and model in the table: every completed core-suite run of its latest measured version (the
 * latest harness commit for ShelraCode; reference agents record none), added up, never a best run.
 */
export interface BenchRow {
  agent: string;
  label: string;
  model: string;
  free: boolean;
  variant: string | null;
  /** Runs added up in this row. */
  runs: number;
  /** Tasks resolved and attempted across those runs. */
  resolved: number;
  total: number;
  /** Tasks that ended on a provider failure rather than on the task itself. */
  infra: number;
  /** Average per run. */
  costUsd: number | null;
  costKind: string | null;
  /** Average per run. */
  minutes: number | null;
  /** Date of the latest run. */
  date: string;
  commit: string | null;
  source: string;
}

export interface BenchSummary {
  updatedAt: string;
  suite: { name: string; version: string; tasks: number };
  runsTotal: number;
  rows: BenchRow[];
  progress: {
    model: string;
    runs: {
      runNumber: number;
      date: string;
      resolved: number;
      total: number;
      infra: number;
      commit: string | null;
      costUsd: number | null;
      minutes: number | null;
    }[];
  };
  fieldCases: {
    id: string;
    date: string;
    title: string;
    model: string | null;
    solved: boolean | null;
    tries: number | null;
    toolCalls: number | null;
    reference: { agent: string; tries: number | null } | null;
    reruns: { commit: string; minutes: number; toolCalls: number; gateLoops: number }[];
  }[];
  /** Every core-suite run of ShelraCode on a free model, whatever its status: the honest free-tier record. */
  freeRuns: {
    id: string;
    /** "#N" for a run recorded under the suite's name, else the label it was recorded under. */
    label: string;
    runNumber: number;
    date: string;
    model: string;
    status: string;
    resolved: number;
    total: number;
    infra: number;
    commit: string | null;
  }[];
  /** The memory proof suite: per run, whether each arm passed (true), failed (false) or never ran (null). */
  memory: {
    suite: string;
    model: string;
    runs: {
      runNumber: number;
      date: string;
      commit: string | null;
      learn: boolean | null;
      withMemory: boolean | null;
      withoutMemory: boolean | null;
    }[];
    /** Runs of the suite the table leaves out: other models, or runs that did not complete. */
    otherRuns: { runNumber: number; date: string; model: string; status: string }[];
  };
}

const SUITE = "shelra-agent-core";
const MEMORY_SUITE = "shelra-memory";
// Runs from before the history rewrite of 2026-09-22 record commits the public history no longer has: they stay in
// the history and the progress panel, and leave the table, which shows measurements that can be replayed.
const REWRITE = "2026-09-22";
const INFRA =
  /402|credit|429|rate limit|overloaded|provider returned|404|timed out|timeout|stalled|no model answered|unavailable/i;

const config = (run: HistoryRun): Record<string, Json> =>
  run.agent.config && typeof run.agent.config === "object" && !Array.isArray(run.agent.config) ? run.agent.config : {};

const shortModel = (model: string | null): string => (model ?? "unknown").replace(/^openrouter\//, "");
const isFree = (model: string | null, costMicros: number | null): boolean =>
  /:free$/.test(model ?? "") || costMicros === 0;
const agentLabel = (name: string): string =>
  name === "shelra" ? "ShelraCode" : name === "claude-code" ? "Claude Code" : name === "codex" ? "Codex" : name;

function infraCount(run: HistoryRun): number {
  return run.taskResults.filter((t) => t.status !== "passed" && t.failureReason && INFRA.test(t.failureReason)).length;
}

// Subsystems switched off for an experiment; "none" is the full harness.
function variantOf(run: HistoryRun): string | null {
  const cfg = config(run);
  const ablation =
    typeof cfg.ablation === "string" ? cfg.ablation : Array.isArray(cfg.ablation) ? cfg.ablation.join(",") : null;
  return ablation && ablation !== "none" ? `ablation: ${ablation}` : null;
}

// Reference agents record their model behind the CLI's name: "claude-code/sonnet", "codex/gpt-5.6-luna@max".
function displayModel(run: HistoryRun): string {
  const model = shortModel(run.model).replace(/^(claude-code|codex)\//, "");
  const [name, effort] = model.split("@");
  return effort ? `${name} · effort ${effort}` : name;
}

const usd = (micros: number) => Math.round(micros / 10_000) / 100;
const commitOf = (run: HistoryRun) => (run.harnessCommit ? run.harnessCommit.slice(0, 7) : null);
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function toRow(runs: HistoryRun[]): BenchRow {
  const latest = runs.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  const costs = runs.filter((r) => r.costMicros !== null).map((r) => r.costMicros as number);
  const durations = runs.filter((r) => r.durationMs !== null).map((r) => r.durationMs as number);
  const kinds = new Set(runs.map((r) => r.costKind ?? null));
  return {
    agent: latest.agent.name,
    label: agentLabel(latest.agent.name),
    model: displayModel(latest),
    free: runs.every((r) => isFree(r.model, r.costMicros)),
    variant: variantOf(latest),
    runs: runs.length,
    resolved: runs.reduce((sum, r) => sum + r.tasks.resolved, 0),
    total: runs.reduce((sum, r) => sum + r.tasks.total, 0),
    infra: runs.reduce((sum, r) => sum + infraCount(r), 0),
    costUsd: costs.length ? usd(average(costs)) : null,
    costKind: !costs.length ? null : kinds.size === 1 && kinds.has("exact") ? "exact" : "estimated",
    minutes: durations.length ? Math.round(average(durations) / 60_000) : null,
    date: latest.createdAt.slice(0, 10),
    commit: commitOf(latest),
    source: latest.source,
  };
}

const history = JSON.parse(readFileSync(historyPath, "utf8")) as History;

// The core suite's tasks. The 2026-09-23 audit and the 2026-09-24 phase-4 runs were recorded under their own
// labels ("C1-core-claude-sonnet", "F4C-core-current-nemotron-1") rather than the suite's name: a run over exactly
// these tasks at the suite's version is a core-suite run. The audit's "silent" runs have the same tasks with
// prompts that no longer ask for the tests, a different measurement, and stay out.
const manifest = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { benchmarkVersion: string; tasks: { id: string }[] })
  : null;
const coreTaskIds = manifest
  ? manifest.tasks
      .map((t) => t.id)
      .sort()
      .join(",")
  : null;

function isCoreRun(run: HistoryRun): boolean {
  if (run.suite === SUITE) return true;
  if (!manifest || /silent/i.test(run.suite) || run.benchmarkVersion !== manifest.benchmarkVersion) return false;
  return (
    run.taskResults
      .map((t) => t.taskId ?? "")
      .sort()
      .join(",") === coreTaskIds
  );
}

// The core suite's measurements: completed runs that actually ran (a run that died in its first minute is a
// configuration failure, not a measurement), on the product path.
const core = history.runs.filter(
  (r) =>
    isCoreRun(r) &&
    r.status === "completed" &&
    (r.durationMs ?? 0) >= 120_000 &&
    (r.agent.name !== "shelra" || config(r).harness !== "autonomy-runtime"),
);
const version =
  core
    .map((r) => r.benchmarkVersion)
    .sort()
    .at(-1) ?? "0.2.0";
const total = manifest?.tasks.length ?? core[0]?.tasks.total ?? 8;

// When a commit was made, from this repository's git history: an A/B measurement alternates its runs between
// two commits, so the latest run is not always on the newest one. "" when git does not know the commit.
function commitTime(commit: string | null): string {
  if (!commit) return "";
  const out = spawnSync("git", ["log", "-1", "--format=%cI", commit], { cwd: root, encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : "";
}

// The runs of a group's latest measured version: its newest harness commit (by commit date, else by the date of
// its runs). Reference agents record no commit, so all their runs.
function latestVersion(runs: HistoryRun[]): HistoryRun[] {
  const commits = [...new Set(runs.map(commitOf))];
  const lastRun = (commit: string | null) =>
    runs
      .filter((r) => commitOf(r) === commit)
      .map((r) => r.createdAt)
      .sort()
      .at(-1) ?? "";
  const newest = commits.reduce((a, b) => {
    const [ta, tb] = [commitTime(a), commitTime(b)];
    if (ta && tb && ta !== tb) return tb > ta ? b : a;
    return lastRun(b) > lastRun(a) ? b : a;
  });
  return runs.filter((r) => commitOf(r) === newest);
}

// The table: per agent and model (full harness only), every run of its latest measured version, added up.
const groups = new Map<string, HistoryRun[]>();
for (const run of core.filter((r) => !variantOf(r))) {
  const key = `${run.agent.name}|${shortModel(run.model)}`;
  groups.set(key, [...(groups.get(key) ?? []), run]);
}
const rows = [...groups.values()]
  .map(latestVersion)
  .filter((runs) => runs.every((r) => r.createdAt.slice(0, 10) > REWRITE))
  .map(toRow)
  .sort((a, b) => {
    const order = (agent: string) => (agent === "shelra" ? 0 : agent === "claude-code" ? 1 : agent === "codex" ? 2 : 3);
    return order(a.agent) - order(b.agent) || b.resolved / b.total - a.resolved / a.total;
  });

// Progression of the product path on the model it was measured on most often: the runs the product-path bench
// recorded under the suite's name, one model across harness commits. (The audit's repeated runs compare agents
// and commits side by side; the table shows them.)
const shelraRuns = core.filter((r) => r.suite === SUITE && r.agent.name === "shelra" && !variantOf(r));
const byModel = new Map<string, HistoryRun[]>();
for (const run of shelraRuns) {
  const key = shortModel(run.model);
  byModel.set(key, [...(byModel.get(key) ?? []), run]);
}
const [progressModel, progressRuns] = [...byModel.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? ["", []];

// The memory proof suite: completed runs on the model it was measured on most often, arm by arm.
const memoryRuns = history.runs.filter((r) => r.suite === MEMORY_SUITE && r.status === "completed");
const memoryByModel = new Map<string, HistoryRun[]>();
for (const run of memoryRuns) {
  const key = shortModel(run.model);
  memoryByModel.set(key, [...(memoryByModel.get(key) ?? []), run]);
}
const [memoryModel, memoryModelRuns] = [...memoryByModel.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [
  "",
  [],
];
const arm = (run: HistoryRun, taskId: string): boolean | null => {
  const task = run.taskResults.find((t) => t.taskId === taskId);
  return task ? task.status === "passed" : null;
};

const summary: BenchSummary = {
  updatedAt: history.updatedAt.slice(0, 10),
  suite: { name: SUITE, version, tasks: total },
  runsTotal: history.runs.length,
  rows,
  progress: {
    model: progressModel,
    runs: progressRuns
      .sort((a, b) => a.runNumber - b.runNumber)
      .map((r) => ({
        runNumber: r.runNumber,
        date: r.createdAt.slice(0, 10),
        resolved: r.tasks.resolved,
        total: r.tasks.total,
        infra: infraCount(r),
        commit: commitOf(r),
        costUsd: r.costMicros === null ? null : usd(r.costMicros),
        minutes: r.durationMs === null ? null : Math.round(r.durationMs / 60_000),
      })),
  },
  fieldCases: history.fieldCases.map((c) => ({
    id: c.id,
    date: c.date,
    title: c.title,
    model: c.shelra?.model ? shortModel(c.shelra.model) : null,
    solved: c.shelra?.solved ?? null,
    tries: c.shelra?.attemptsToSolve ?? null,
    toolCalls: c.shelra?.toolCalls ?? null,
    reference: c.reference?.agent ? { agent: c.reference.agent, tries: c.reference.attemptsToSolve ?? null } : null,
    reruns: (c.reruns ?? []).map((r) => ({
      commit: r.commit,
      minutes: Math.round(r.seconds / 6) / 10,
      toolCalls: r.toolCalls,
      gateLoops: r.gateLoops,
    })),
  })),
  // The full harness only: a run with subsystems switched off measures the experiment, not the product.
  freeRuns: history.runs
    .filter((r) => isCoreRun(r) && r.agent.name === "shelra" && /:free$/.test(r.model ?? "") && !variantOf(r))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.runNumber - b.runNumber)
    .map((r) => ({
      id: r.id,
      label: r.suite === SUITE ? `#${r.runNumber}` : r.suite,
      runNumber: r.runNumber,
      date: r.createdAt.slice(0, 10),
      model: shortModel(r.model),
      status: r.status,
      resolved: r.tasks.resolved,
      total: r.tasks.total,
      infra: infraCount(r),
      commit: r.harnessCommit ? r.harnessCommit.slice(0, 7) : null,
    })),
  memory: {
    suite: MEMORY_SUITE,
    model: memoryModel,
    runs: memoryModelRuns
      .sort((a, b) => a.runNumber - b.runNumber)
      .map((r) => ({
        runNumber: r.runNumber,
        date: r.createdAt.slice(0, 10),
        commit: r.harnessCommit ? r.harnessCommit.slice(0, 7) : null,
        learn: arm(r, "a-learn"),
        withMemory: arm(r, "b-recall-with-memory"),
        withoutMemory: arm(r, "b-recall-without-memory"),
      })),
    otherRuns: history.runs
      .filter((r) => r.suite === MEMORY_SUITE && !memoryModelRuns.includes(r))
      .sort((a, b) => a.runNumber - b.runNumber)
      .map((r) => ({
        runNumber: r.runNumber,
        date: r.createdAt.slice(0, 10),
        model: shortModel(r.model),
        status: r.status,
      })),
  },
};

writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `bench-summary: ${rows.length} rows, ${summary.progress.runs.length} progress runs (${progressModel}), ${summary.fieldCases.length} field cases, ${summary.memory.runs.length} memory runs (${memoryModel}) → ${outPath}`,
);
for (const row of rows)
  console.log(
    `  ${row.label} · ${row.model}${row.variant ? ` (${row.variant})` : ""}: ${row.resolved}/${row.total} in ${row.runs} ${row.runs === 1 ? "run" : "runs"}${row.infra ? ` (${row.infra} lost to the provider)` : ""} · ${row.costUsd === null ? "cost n/a" : `$${row.costUsd.toFixed(2)}/run`} · ${row.minutes ?? "?"} min/run · ${row.date}${row.commit ? ` ${row.commit}` : ""}`,
  );
