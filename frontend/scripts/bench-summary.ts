/**
 * Landing-page benchmark data, derived from the versioned benchmark history.
 *
 *   bun run scripts/bench-summary.ts        (from frontend/; also `bun run bench:sync`)
 *
 * Reads ../bench/history/benchmark-history.json (the record of every Shelra Bench run and field
 * case, see bench/history/README.md) and writes src/lib/bench-summary.json: the best completed run
 * per agent and model on the core suite, the progression of the product path on its pinned model,
 * and the field cases. The site never computes numbers itself; re-run this after importing runs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const historyPath = resolve(root, "..", "bench", "history", "benchmark-history.json");
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

export interface BenchRow {
  agent: string;
  label: string;
  model: string;
  free: boolean;
  variant: string | null;
  resolved: number;
  total: number;
  /** Tasks that ended on a provider failure rather than on the task itself. */
  infra: number;
  costUsd: number | null;
  costKind: string | null;
  minutes: number | null;
  runNumber: number;
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
    runs: { runNumber: number; date: string; resolved: number; total: number; infra: number; commit: string | null }[];
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

function toRow(run: HistoryRun): BenchRow {
  const cfg = config(run);
  const ablation =
    typeof cfg.ablation === "string" ? cfg.ablation : Array.isArray(cfg.ablation) ? cfg.ablation.join(",") : null;
  return {
    agent: run.agent.name,
    label: agentLabel(run.agent.name),
    model: shortModel(run.model),
    free: isFree(run.model, run.costMicros),
    variant: ablation ? `ablation: ${ablation}` : null,
    resolved: run.tasks.resolved,
    total: run.tasks.total,
    infra: infraCount(run),
    costUsd: run.costMicros === null ? null : Math.round(run.costMicros / 10_000) / 100,
    costKind: run.costKind ?? null,
    minutes: run.durationMs === null ? null : Math.round(run.durationMs / 60_000),
    runNumber: run.runNumber,
    date: run.createdAt.slice(0, 10),
    commit: run.harnessCommit ? run.harnessCommit.slice(0, 7) : null,
    source: run.source,
  };
}

const history = JSON.parse(readFileSync(historyPath, "utf8")) as History;

// The product path on the core suite: completed runs that actually ran (a run that died in its first
// minute is a configuration failure, not a measurement).
const core = history.runs.filter(
  (r) =>
    r.suite === SUITE &&
    r.status === "completed" &&
    (r.durationMs ?? 0) >= 120_000 &&
    (r.agent.name !== "shelra" || config(r).harness !== "autonomy-runtime"),
);
const version =
  core
    .map((r) => r.benchmarkVersion)
    .sort()
    .at(-1) ?? "0.2.0";
const total = core[0]?.tasks.total ?? 8;

// Best completed run per agent + model + variant: most tasks resolved, then the latest.
const best = new Map<string, HistoryRun>();
for (const run of core) {
  const row = toRow(run);
  const key = `${row.agent}|${row.model}|${row.variant ?? ""}`;
  const current = best.get(key);
  if (
    !current ||
    run.tasks.resolved > current.tasks.resolved ||
    (run.tasks.resolved === current.tasks.resolved && run.createdAt > current.createdAt)
  ) {
    best.set(key, run);
  }
}
const rows = [...best.values()].map(toRow).sort((a, b) => {
  const order = (agent: string) => (agent === "shelra" ? 0 : agent === "claude-code" ? 1 : agent === "codex" ? 2 : 3);
  return order(a.agent) - order(b.agent) || b.resolved - a.resolved || (a.costUsd ?? 0) - (b.costUsd ?? 0);
});

// Progression of the product path on the model it was measured on most often.
const shelraRuns = core.filter((r) => r.agent.name === "shelra" && !toRow(r).variant);
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
        commit: r.harnessCommit ? r.harnessCommit.slice(0, 7) : null,
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
  freeRuns: history.runs
    .filter((r) => r.suite === SUITE && r.agent.name === "shelra" && /:free$/.test(r.model ?? ""))
    .sort((a, b) => a.runNumber - b.runNumber)
    .map((r) => ({
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
    `  ${row.label} · ${row.model}${row.variant ? ` (${row.variant})` : ""}: ${row.resolved}/${row.total}${row.infra ? ` (${row.infra} lost to the provider)` : ""} · ${row.costUsd === null ? "cost n/a" : `$${row.costUsd.toFixed(2)}`} · ${row.minutes ?? "?"} min · #${row.runNumber} ${row.date}`,
  );
