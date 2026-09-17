import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import {
  appendBenchmarkEvent,
  createBenchmarkRun,
  finalizeBenchmarkRun,
  recordBenchmarkTaskResult,
  setBenchmarkRunStatus,
  startBenchmarkTask,
  updateBenchmarkRunProgress,
} from "../storage/benchmarks";
import { manifestSummary } from "./manifest";
import { calculateIntentScore, calculateOverallScore, normalizeBenchmarkScore, roundScore } from "./scoring";
import {
  BENCHMARK_DIMENSIONS,
  type BenchmarkAcceptanceResult,
  type BenchmarkArtifactRef,
  type BenchmarkBehavior,
  type BenchmarkCost,
  type BenchmarkEvent,
  type BenchmarkFailureType,
  type BenchmarkJsonObject,
  type BenchmarkManifest,
  type BenchmarkRunInput,
  type BenchmarkRunStatus,
  type BenchmarkRunSummary,
  type BenchmarkScoreMap,
  type BenchmarkTaskDefinition,
  type BenchmarkTaskResult,
  type BenchmarkTaskStatus,
  type BenchmarkTokenUsage,
} from "./types";

export interface BenchmarkExecutionNotice {
  type: BenchmarkEvent["type"];
  message: string;
  taskId?: string | null;
  payload?: BenchmarkJsonObject;
}

export interface BenchmarkTaskExecution {
  status: Exclude<BenchmarkTaskStatus, "queued" | "running">;
  scores?: BenchmarkScoreMap;
  tokens?: BenchmarkTokenUsage;
  cost?: BenchmarkCost;
  behavior?: BenchmarkBehavior;
  acceptance?: BenchmarkAcceptanceResult[];
  finalResult?: BenchmarkJsonObject | null;
  failureReason?: string | null;
  failureType?: BenchmarkFailureType | null;
  evidence?: BenchmarkArtifactRef[];
  durationMs?: number | null;
  llmDurationMs?: number | null;
  toolDurationMs?: number | null;
  verificationDurationMs?: number | null;
  repairDurationMs?: number | null;
  objectiveRunDir?: string | null;
}

export interface BenchmarkTaskExecutorContext {
  run: BenchmarkRunSummary;
  task: BenchmarkTaskDefinition;
  signal?: AbortSignal;
  emit: (notice: BenchmarkExecutionNotice) => void;
}

export interface BenchmarkTaskExecutor {
  executeTask(task: BenchmarkTaskDefinition, context: BenchmarkTaskExecutorContext): Promise<BenchmarkTaskExecution>;
}

export interface BenchmarkRunnerOptions {
  workspace: string;
  manifest: BenchmarkManifest;
  runInput?: Omit<BenchmarkRunInput, "workspace" | "benchmarkVersion" | "suite" | "taskCount" | "benchmarkConfig"> & {
    benchmarkConfig?: BenchmarkJsonObject;
  };
  createExecutor: (context: {
    run: BenchmarkRunSummary;
    manifest: BenchmarkManifest;
    signal?: AbortSignal;
    emit: (notice: BenchmarkExecutionNotice) => void;
  }) => Promise<BenchmarkTaskExecutor> | BenchmarkTaskExecutor;
  signal?: AbortSignal;
  onRunCreated?: (run: BenchmarkRunSummary) => void;
  onEvent?: (event: BenchmarkEvent) => void;
  onTask?: (result: BenchmarkTaskResult) => void;
}

/**
 * Creates the durable run before provider setup, then persists each task as it finishes.
 * A benchmark task may fail without invalidating the run: `completed` means the suite was
 * executed, while task-level status and scores carry the engineering result. Infrastructure
 * errors, cancellation and interruption remain visible as their own terminal run states.
 */
export async function runBenchmark(options: BenchmarkRunnerOptions): Promise<BenchmarkRunSummary> {
  const { manifest } = options;
  const input = options.runInput;
  const run = createBenchmarkRun({
    workspace: options.workspace,
    benchmarkVersion: manifest.benchmarkVersion,
    suite: manifest.suite,
    agentName: input?.agentName ?? "shelra",
    leaderboardEligible: input?.leaderboardEligible ?? manifest.config?.leaderboardEligible === true,
    agentVersion: input?.agentVersion,
    agentConfig: input?.agentConfig,
    model: input?.model,
    modelProvider: input?.modelProvider,
    modelVersion: input?.modelVersion,
    repositoryCommit: input?.repositoryCommit,
    repositoryDirty: input?.repositoryDirty,
    repositoryDiffHash: input?.repositoryDiffHash,
    shelraVersion: input?.shelraVersion,
    environment: input?.environment,
    benchmarkConfig: {
      ...(input?.benchmarkConfig ?? {}),
      ...manifestSummary(manifest),
    },
    taskCount: manifest.tasks.length,
    seed: input?.seed ?? manifest.seed ?? null,
    processId: input?.processId,
  });
  const persistedNotice = (notice: BenchmarkExecutionNotice): void => {
    const event = appendBenchmarkEvent({
      runId: run.runId,
      type: notice.type,
      message: notice.message,
      taskId: notice.taskId ?? null,
      payload: notice.payload ?? {},
    });
    options.onEvent?.(event);
  };

  const setProgress = (completed: number): void => {
    updateBenchmarkRunProgress(run.runId, completed);
  };

  try {
    options.onRunCreated?.(run);
    setBenchmarkRunStatus(run.runId, "preparing", "Preparing benchmark manifest and agent runtime");

    if (manifest.tasks.length === 0) {
      return finalizeBenchmarkRun({
        runId: run.runId,
        status: "invalid",
        failureReason: "Benchmark manifest contains no tasks.",
      });
    }

    const oracleError = validateBenchmarkOracle(manifest);
    if (oracleError) {
      return finalizeBenchmarkRun({
        runId: run.runId,
        status: "invalid",
        failureReason: oracleError,
      });
    }

    if (options.signal?.aborted) {
      return finalizeBenchmarkRun({
        runId: run.runId,
        status: "interrupted",
        failureReason: "Benchmark was interrupted before task execution began.",
      });
    }

    const executor = await options.createExecutor({
      run,
      manifest,
      signal: options.signal,
      emit: (notice) => persistedNotice({ ...notice, taskId: notice.taskId ?? null }),
    });

    const taskResults: BenchmarkTaskResult[] = [];
    /** Finished workspaces by task id, for tasks that continue an earlier task's project. */
    const completedWorkspaces = new Map<string, string>();
    let infrastructureFailure: string | null = null;
    let terminalStatus: Extract<BenchmarkRunStatus, "completed" | "failed" | "cancelled" | "interrupted"> = "completed";

    for (const task of manifest.tasks) {
      if (options.signal?.aborted) {
        terminalStatus = "interrupted";
        break;
      }

      const startedAt = new Date();
      let executionTask: BenchmarkTaskDefinition;
      try {
        executionTask = prepareBenchmarkTaskWorkspace(options.workspace, run.runId, task, completedWorkspaces);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const result = recordBenchmarkTaskResult({
          runId: run.runId,
          taskId: task.id,
          category: task.category,
          difficulty: task.difficulty,
          status: "failed",
          startedAt,
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          failureReason: message,
          failureType: "environment",
        });
        taskResults.push(result);
        options.onTask?.(result);
        setProgress(taskResults.length);
        infrastructureFailure = message;
        terminalStatus = "failed";
        break;
      }

      setBenchmarkRunStatus(run.runId, "running", `Running task ${task.id}`);
      startBenchmarkTask({
        runId: run.runId,
        taskId: task.id,
        category: task.category,
        difficulty: task.difficulty,
        definition: executionTask,
      });

      try {
        const execution = await executor.executeTask(executionTask, {
          run,
          task: executionTask,
          signal: options.signal,
          emit: (notice) => {
            if (notice.type === "verification") {
              setBenchmarkRunStatus(run.runId, "verifying", `Verifying task ${task.id}`);
            }
            persistedNotice({ ...notice, taskId: notice.taskId ?? task.id });
          },
        });
        if (executionTask.workspace) completedWorkspaces.set(task.id, executionTask.workspace);
        const scores = withDerivedTaskScores(execution.scores ?? {}, execution.acceptance ?? []);
        const result = recordBenchmarkTaskResult({
          runId: run.runId,
          taskId: task.id,
          category: task.category,
          difficulty: task.difficulty,
          status: execution.status,
          startedAt,
          durationMs: execution.durationMs,
          llmDurationMs: execution.llmDurationMs,
          toolDurationMs: execution.toolDurationMs,
          verificationDurationMs: execution.verificationDurationMs,
          repairDurationMs: execution.repairDurationMs,
          scores,
          tokens: execution.tokens,
          cost: execution.cost,
          behavior: execution.behavior,
          acceptance: execution.acceptance,
          finalResult: execution.finalResult,
          failureReason: execution.failureReason,
          failureType: execution.failureType,
          evidence: execution.evidence,
          objectiveRunDir: execution.objectiveRunDir,
        });
        taskResults.push(result);
        options.onTask?.(result);
        setProgress(taskResults.length);

        if (execution.status === "interrupted") {
          terminalStatus = "interrupted";
          break;
        }
        if (execution.status === "cancelled") {
          terminalStatus = "cancelled";
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const interrupted = options.signal?.aborted === true;
        const status: Exclude<BenchmarkTaskStatus, "queued" | "running"> = interrupted ? "interrupted" : "failed";
        const result = recordBenchmarkTaskResult({
          runId: run.runId,
          taskId: task.id,
          category: task.category,
          difficulty: task.difficulty,
          status,
          startedAt,
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          failureReason: message,
        });
        taskResults.push(result);
        options.onTask?.(result);
        setProgress(taskResults.length);
        infrastructureFailure = message;
        terminalStatus = interrupted ? "interrupted" : "failed";
        persistedNotice({
          type: interrupted ? "note" : "error",
          taskId: task.id,
          message: interrupted ? `Task ${task.id} interrupted` : `Task ${task.id} could not be executed`,
          payload: { error: message },
        });
        break;
      }
    }

    if (options.signal?.aborted) terminalStatus = "interrupted";
    const scores = aggregateScores(taskResults, manifest);
    return finalizeBenchmarkRun({
      runId: run.runId,
      status: terminalStatus,
      scores,
      tokens: aggregateTokens(taskResults),
      cost: aggregateCost(taskResults),
      completedTaskCount: taskResults.filter((task) => task.status !== "interrupted").length,
      failureReason: infrastructureFailure,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status: Extract<BenchmarkRunStatus, "failed" | "interrupted"> = options.signal?.aborted
      ? "interrupted"
      : "failed";
    return finalizeBenchmarkRun({
      runId: run.runId,
      status,
      failureReason: message,
    });
  }
}

function validateBenchmarkOracle(manifest: BenchmarkManifest): string | null {
  if (manifest.oracleMode !== "benchmark-owned") return null;
  for (const task of manifest.tasks) {
    if (!task.acceptanceCriteria || task.acceptanceCriteria.length === 0) {
      return `Benchmark task "${task.id}" has no benchmark-owned acceptance criteria.`;
    }
    if (task.acceptanceCriteria.some((criterion) => !criterion.check)) {
      return `Benchmark task "${task.id}" has an acceptance criterion without a deterministic check.`;
    }
  }
  return null;
}

function prepareBenchmarkTaskWorkspace(
  benchmarkRoot: string,
  runId: string,
  task: BenchmarkTaskDefinition,
  completedWorkspaces: ReadonlyMap<string, string> = new Map(),
): BenchmarkTaskDefinition {
  const root = resolve(benchmarkRoot);
  let template: string;
  let wipeMemory = false;
  if (task.workspaceFrom) {
    // Cross-session scenario: continue from the exact workspace an earlier task left behind,
    // including the project memory it wrote — or with that memory wiped, as the control arm.
    const source = completedWorkspaces.get(task.workspaceFrom);
    if (!source) {
      throw new Error(
        `Benchmark task "${task.id}" continues from "${task.workspaceFrom}", which has not completed in this run.`,
      );
    }
    template = source;
    wipeMemory = task.memoryPolicy === "wipe";
  } else {
    if (!task.workspaceTemplate) return task;
    template = resolve(benchmarkRoot, task.workspaceTemplate);
    const rootRelative = relative(root, template);
    if (rootRelative.startsWith("..") || rootRelative.startsWith(`..${sep}`) || rootRelative === resolve(root, "..")) {
      throw new Error(`Benchmark workspace template must remain inside the benchmark root: ${task.workspaceTemplate}`);
    }
  }
  if (!existsSync(template) || !statSync(template).isDirectory()) {
    throw new Error(`Benchmark workspace template is missing or not a directory: ${template}`);
  }

  const taskSlug = task.id.replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 64) || "task";
  const taskHash = createHash("sha256").update(task.id).digest("hex").slice(0, 8);
  const destination = resolve(root, ".shelra", "bench", "runs", runId, "tasks", `${taskSlug}-${taskHash}`);
  if (existsSync(destination)) throw new Error(`Benchmark task workspace already exists: ${destination}`);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(template, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (source) => {
      const childRelative = relative(template, source);
      if (!childRelative) return true;
      const parts = childRelative.split(sep);
      if (parts.some((part) => part === ".git" || part === "node_modules")) return false;
      if (task.workspaceFrom) {
        // Inherited memory is the experimental variable: keep it exactly, or drop it entirely.
        // The `.shelra` directory itself must pass the filter, or cpSync never descends into
        // `.shelra/memory` (run #13 started its with-memory arm blind for exactly this reason).
        const isMemory = parts[0] === ".shelra" && parts[1] === "memory";
        const isSkill = parts[0] === ".agents" && parts[1] === "skills";
        if (wipeMemory && (isMemory || isSkill)) return false;
        if (parts[0] === ".shelra" && parts.length > 1 && !isMemory) return false;
        return true;
      }
      return parts[0] !== ".shelra";
    },
  });
  return {
    ...task,
    workspace: destination,
    metadata: {
      ...(task.metadata ?? {}),
      ...(task.workspaceTemplate ? { workspaceTemplate: task.workspaceTemplate } : {}),
      ...(task.workspaceFrom ? { workspaceFrom: task.workspaceFrom, memoryPolicy: task.memoryPolicy ?? "keep" } : {}),
      workspacePrepared: true,
    },
  };
}

function withDerivedTaskScores(
  scores: BenchmarkScoreMap,
  acceptance: readonly BenchmarkAcceptanceResult[],
): BenchmarkScoreMap {
  const derivedIntent = calculateIntentScore(acceptance);
  return {
    ...scores,
    ...(scores.intent === undefined && derivedIntent === undefined ? {} : { intent: scores.intent ?? derivedIntent }),
  };
}

function aggregateScores(tasks: readonly BenchmarkTaskResult[], manifest: BenchmarkManifest): BenchmarkScoreMap {
  const scores: BenchmarkScoreMap = {};
  for (const dimension of BENCHMARK_DIMENSIONS) {
    if (dimension === "overall") continue;
    const values = tasks
      .map((task) => normalizeBenchmarkScore(task.scores[dimension]))
      .filter((value): value is number => value !== undefined);
    if (values.length > 0)
      scores[dimension] = roundScore(values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  const overall = calculateOverallScore(scores, manifest.scorePolicy);
  if (overall !== undefined) scores.overall = overall;
  return scores;
}

function aggregateTokens(tasks: readonly BenchmarkTaskResult[]): BenchmarkTokenUsage {
  const fields: Array<keyof BenchmarkTokenUsage> = [
    "inputTokens",
    "outputTokens",
    "cachedTokens",
    "reasoningTokens",
    "totalTokens",
  ];
  const result: BenchmarkTokenUsage = {};
  for (const field of fields) {
    const values = tasks.map((task) => task.tokens[field]);
    if (
      values.length > 0 &&
      values.every((value): value is number => typeof value === "number" && Number.isFinite(value))
    ) {
      result[field] = values.reduce((sum, value) => sum + value, 0);
    }
  }
  return result;
}

function aggregateCost(tasks: readonly BenchmarkTaskResult[]): BenchmarkCost {
  if (tasks.length === 0) return { micros: null, kind: "unavailable" };
  if (!tasks.every((task) => task.cost.micros !== null && task.cost.kind !== "unavailable")) {
    return { micros: null, kind: "unavailable" };
  }
  const kind = tasks.every((task) => task.cost.kind === "exact") ? "exact" : "estimated";
  const source = tasks.map((task) => task.cost.source).filter(Boolean);
  return {
    micros: tasks.reduce((sum, task) => sum + (task.cost.micros ?? 0), 0),
    kind,
    ...(source.length > 0 ? { source: [...new Set(source)].join(", ") } : {}),
  };
}
