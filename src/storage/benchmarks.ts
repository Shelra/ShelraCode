import { randomUUID } from "node:crypto";
import { configurationFingerprint, redactBenchmarkText, sanitizeJsonObject } from "../bench/environment";
import { averageTaskScore, normalizeBenchmarkScore } from "../bench/scoring";
import type {
  BenchmarkAcceptanceResult,
  BenchmarkArtifactRef,
  BenchmarkBehavior,
  BenchmarkCost,
  BenchmarkEnvironment,
  BenchmarkEvent,
  BenchmarkFailureType,
  BenchmarkJsonObject,
  BenchmarkLeaderboardEntry,
  BenchmarkMetricComparison,
  BenchmarkRunComparison,
  BenchmarkRunDetails,
  BenchmarkRunInput,
  BenchmarkRunStatus,
  BenchmarkRunSummary,
  BenchmarkScoreMap,
  BenchmarkTaskCategory,
  BenchmarkTaskDefinition,
  BenchmarkTaskResult,
  BenchmarkTaskStatus,
  BenchmarkTokenUsage,
} from "../bench/types";
import { getDatabase, type SQLiteDatabase, withTransaction } from "./db";
import { ensureWorkspace } from "./workspaces";

const TERMINAL_STATUSES: readonly BenchmarkRunStatus[] = ["completed", "failed", "cancelled", "interrupted", "invalid"];

const SCORE_COLUMNS: Record<keyof BenchmarkScoreMap, string> = {
  overall: "overall_score",
  coding: "coding_score",
  agentic: "agentic_score",
  intent: "intent_score",
  verification: "verification_score",
  research: "research_score",
  memory: "memory_score",
  repair: "repair_score",
  efficiency: "efficiency_score",
};

const RUN_COLUMNS = `
  r.run_number, r.id, r.workspace_id, w.canonical_path AS workspace_path, r.status,
  r.created_at, r.started_at, r.finished_at, r.heartbeat_at, r.finalized_at,
  r.benchmark_version, r.benchmark_suite, r.agent_name, r.agent_version,
  r.leaderboard_eligible,
  r.agent_config_json, r.configuration_fingerprint, r.model, r.model_provider, r.model_version,
  r.repository_commit, r.repository_dirty, r.repository_diff_hash, r.shelra_version,
  r.environment_json, r.benchmark_config_json, r.seed_text, r.task_count,
  r.completed_task_count, r.resolved_task_count, r.resolved_rate, r.overall_score,
  r.coding_score, r.agentic_score,
  r.intent_score, r.verification_score, r.research_score, r.memory_score,
  r.repair_score, r.efficiency_score, r.scores_json, r.confidence_json,
  r.input_tokens, r.output_tokens, r.cached_tokens, r.reasoning_tokens, r.total_tokens,
  r.cost_micros, r.cost_kind, r.cost_source, r.duration_ms, r.failure_reason, r.failure_type, r.process_id
`;

const RUN_FROM = `FROM benchmark_runs r JOIN workspaces w ON w.id = r.workspace_id`;

interface BenchmarkRunRow {
  run_number: number;
  id: string;
  workspace_id: string;
  workspace_path: string;
  status: BenchmarkRunStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  finalized_at: string | null;
  benchmark_version: string;
  benchmark_suite: string;
  agent_name: string;
  leaderboard_eligible: number;
  agent_version: string | null;
  agent_config_json: string;
  configuration_fingerprint: string;
  model: string | null;
  model_provider: string | null;
  model_version: string | null;
  repository_commit: string | null;
  repository_dirty: number;
  repository_diff_hash: string | null;
  shelra_version: string | null;
  environment_json: string;
  benchmark_config_json: string;
  seed_text: string | null;
  task_count: number;
  completed_task_count: number;
  resolved_task_count: number;
  resolved_rate: number | null;
  overall_score: number | null;
  coding_score: number | null;
  agentic_score: number | null;
  intent_score: number | null;
  verification_score: number | null;
  research_score: number | null;
  memory_score: number | null;
  repair_score: number | null;
  efficiency_score: number | null;
  scores_json: string;
  confidence_json: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  cost_micros: number | null;
  cost_kind: BenchmarkCost["kind"] | null;
  cost_source: string | null;
  duration_ms: number | null;
  failure_reason: string | null;
  failure_type: BenchmarkFailureType | null;
  process_id: number | null;
}

interface BenchmarkTaskRow {
  run_id: string;
  task_id: string;
  category: BenchmarkTaskCategory;
  difficulty: string;
  task_definition_json: string;
  status: BenchmarkTaskStatus;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  llm_duration_ms: number | null;
  tool_duration_ms: number | null;
  verification_duration_ms: number | null;
  repair_duration_ms: number | null;
  scores_json: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  cost_micros: number | null;
  cost_kind: BenchmarkCost["kind"] | null;
  cost_source: string | null;
  behavior_json: string;
  acceptance_json: string;
  final_result_json: string | null;
  failure_reason: string | null;
  failure_type: BenchmarkFailureType | null;
  evidence_json: string;
  objective_run_dir: string | null;
}

interface AcceptanceRow {
  run_id: string;
  task_id: string;
  criterion_id: string;
  description: string;
  status: BenchmarkAcceptanceResult["status"];
  required: number | null;
  detail: string | null;
  evidence_json: string;
}

interface EventRow {
  run_id: string;
  sequence: number;
  type: BenchmarkEvent["type"];
  at: string;
  task_id: string | null;
  message: string;
  payload_json: string;
}

interface ArtifactRow {
  kind: BenchmarkArtifactRef["kind"];
  path: string;
  label: string | null;
  sha256: string | null;
  bytes: number | null;
  metadata_json: string;
}

export interface BenchmarkRunFilters {
  workspaceId?: string;
  agentName?: string;
  agentVersion?: string;
  model?: string;
  modelProvider?: string;
  modelVersion?: string;
  repositoryCommit?: string;
  benchmarkVersion?: string;
  suite?: string;
  status?: BenchmarkRunStatus;
  statuses?: BenchmarkRunStatus[];
  createdAfter?: Date;
  createdBefore?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface BenchmarkVersionSummary {
  benchmarkVersion: string;
  suite: string;
  runCount: number;
  latestAt: Date;
}

export function createBenchmarkRun(input: BenchmarkRunInput): BenchmarkRunSummary {
  const workspace = ensureWorkspace(input.workspace);
  const runId = createBenchmarkRunId();
  const createdAt = new Date().toISOString();
  const agentConfig = sanitizeJsonObject(input.agentConfig);
  const benchmarkConfig = sanitizeJsonObject(input.benchmarkConfig);
  const fingerprint = configurationFingerprint({
    agentConfig,
    benchmarkConfig,
    model: input.model ?? null,
    modelProvider: input.modelProvider ?? null,
    modelVersion: input.modelVersion ?? null,
  });

  return withTransaction((db) => {
    db.prepare(`
      INSERT INTO benchmark_runs (
        id, workspace_id, status, created_at, heartbeat_at,
        benchmark_version, benchmark_suite, agent_name, agent_version, agent_config_json,
        leaderboard_eligible,
        configuration_fingerprint, model, model_provider, model_version,
        repository_commit, repository_dirty, repository_diff_hash, shelra_version,
        environment_json, benchmark_config_json, seed_text, task_count, process_id
      ) VALUES (
        @id, @workspace_id, 'queued', @created_at, @heartbeat_at,
        @benchmark_version, @benchmark_suite, @agent_name, @agent_version, @agent_config_json,
        @leaderboard_eligible,
        @configuration_fingerprint, @model, @model_provider, @model_version,
        @repository_commit, @repository_dirty, @repository_diff_hash, @shelra_version,
        @environment_json, @benchmark_config_json, @seed_text, @task_count, @process_id
      )
    `).run({
      id: runId,
      workspace_id: workspace.id,
      created_at: createdAt,
      heartbeat_at: createdAt,
      benchmark_version: input.benchmarkVersion,
      benchmark_suite: input.suite,
      agent_name: input.agentName,
      leaderboard_eligible: input.leaderboardEligible ? 1 : 0,
      agent_version: input.agentVersion ?? null,
      agent_config_json: JSON.stringify(agentConfig),
      configuration_fingerprint: fingerprint,
      model: input.model ?? null,
      model_provider: input.modelProvider ?? null,
      model_version: input.modelVersion ?? null,
      repository_commit: input.repositoryCommit ?? null,
      repository_dirty: input.repositoryDirty ? 1 : 0,
      repository_diff_hash: input.repositoryDiffHash ?? null,
      shelra_version: input.shelraVersion ?? null,
      environment_json: JSON.stringify(sanitizeJsonObject(input.environment as unknown as Record<string, unknown>)),
      benchmark_config_json: JSON.stringify(benchmarkConfig),
      seed_text: input.seed === undefined || input.seed === null ? null : String(input.seed),
      task_count: Math.max(0, input.taskCount ?? 0),
      process_id: input.processId ?? process.pid,
    });

    const row = getRunRow(db, runId);
    if (!row) throw new Error(`Benchmark run ${runId} was not created.`);
    appendEventWithDb(db, runId, "run_created", "Benchmark run created", null, {
      benchmarkVersion: input.benchmarkVersion,
      suite: input.suite,
      taskCount: input.taskCount ?? 0,
    });
    return toRunSummary(row);
  });
}

export function updateBenchmarkRunMetadata(
  runId: string,
  metadata: Partial<
    Pick<BenchmarkRunInput, "model" | "modelProvider" | "modelVersion" | "agentConfig" | "benchmarkConfig">
  >,
): BenchmarkRunSummary {
  return withTransaction((db) => {
    const current = getRunRow(db, runId);
    assertMutableRun(current, runId);
    const agentConfig = metadata.agentConfig
      ? sanitizeJsonObject(metadata.agentConfig)
      : parseObject(current.agent_config_json);
    const benchmarkConfig = metadata.benchmarkConfig
      ? sanitizeJsonObject(metadata.benchmarkConfig)
      : parseObject(current.benchmark_config_json);
    const model = metadata.model === undefined ? current.model : metadata.model;
    const modelProvider = metadata.modelProvider === undefined ? current.model_provider : metadata.modelProvider;
    const modelVersion = metadata.modelVersion === undefined ? current.model_version : metadata.modelVersion;
    const fingerprint = configurationFingerprint({
      agentConfig,
      benchmarkConfig,
      model: model ?? null,
      modelProvider: modelProvider ?? null,
      modelVersion: modelVersion ?? null,
    });
    db.prepare(`
      UPDATE benchmark_runs
      SET model = ?, model_provider = ?, model_version = ?, agent_config_json = ?,
          benchmark_config_json = ?, configuration_fingerprint = ?, heartbeat_at = ?
      WHERE id = ?
    `).run(
      model ?? null,
      modelProvider ?? null,
      modelVersion ?? null,
      JSON.stringify(agentConfig),
      JSON.stringify(benchmarkConfig),
      fingerprint,
      new Date().toISOString(),
      runId,
    );
    const updated = getRunRow(db, runId);
    if (!updated) throw new Error(`Benchmark run ${runId} disappeared while updating metadata.`);
    return toRunSummary(updated);
  });
}

export function setBenchmarkRunStatus(
  runId: string,
  status: Extract<BenchmarkRunStatus, "preparing" | "running" | "verifying">,
  message?: string,
): void {
  withTransaction((db) => {
    const current = getRunRow(db, runId);
    assertMutableRun(current, runId);
    const now = new Date().toISOString();
    const startedAt = current?.started_at ?? now;
    db.prepare(`
      UPDATE benchmark_runs
      SET status = ?, started_at = COALESCE(started_at, ?), heartbeat_at = ?
      WHERE id = ?
    `).run(status, startedAt, now, runId);
    appendEventWithDb(db, runId, "status_changed", message ?? `Run ${status}`, null, { status });
  });
}

export function touchBenchmarkRun(runId: string): void {
  const current = getRunRow(getDatabase(), runId);
  assertMutableRun(current, runId);
  getDatabase().prepare("UPDATE benchmark_runs SET heartbeat_at = ? WHERE id = ?").run(new Date().toISOString(), runId);
}

export function updateBenchmarkRunProgress(runId: string, completedTaskCount: number): void {
  const current = getRunRow(getDatabase(), runId);
  assertMutableRun(current, runId);
  const bounded = Math.max(0, Math.min(current.task_count, Math.floor(completedTaskCount)));
  getDatabase()
    .prepare("UPDATE benchmark_runs SET completed_task_count = ?, heartbeat_at = ? WHERE id = ?")
    .run(bounded, new Date().toISOString(), runId);
}

export function startBenchmarkTask(input: {
  runId: string;
  taskId: string;
  category: BenchmarkTaskCategory;
  difficulty: string;
  definition?: BenchmarkTaskDefinition;
  startedAt?: Date;
}): void {
  withTransaction((db) => {
    const current = getRunRow(db, input.runId);
    assertMutableRun(current, input.runId);
    const existing = getTaskRow(db, input.runId, input.taskId);
    if (existing?.finished_at) throw new Error(`Benchmark task ${input.taskId} is already finalized.`);
    const startedAt = existing?.started_at ?? (input.startedAt ?? new Date()).toISOString();
    const definitionJson = input.definition
      ? JSON.stringify(sanitizeJsonObject(input.definition as unknown as Record<string, unknown>))
      : (existing?.task_definition_json ?? "{}");
    if (existing) {
      db.prepare(`
        UPDATE benchmark_task_results
        SET category = ?, difficulty = ?, task_definition_json = ?, status = 'running', started_at = ?,
            failure_reason = NULL, failure_type = NULL
        WHERE run_id = ? AND task_id = ?
      `).run(input.category, input.difficulty, definitionJson, startedAt, input.runId, input.taskId);
    } else {
      db.prepare(`
        INSERT INTO benchmark_task_results (
          run_id, task_id, category, difficulty, task_definition_json, status, started_at,
          scores_json, behavior_json, acceptance_json, evidence_json
        ) VALUES (?, ?, ?, ?, ?, 'running', ?, '{}', '{}', '[]', '[]')
      `).run(input.runId, input.taskId, input.category, input.difficulty, definitionJson, startedAt);
    }
    db.prepare("UPDATE benchmark_runs SET heartbeat_at = ? WHERE id = ?").run(new Date().toISOString(), input.runId);
    appendEventWithDb(db, input.runId, "task_started", `${input.taskId} started`, input.taskId, {
      category: input.category,
      difficulty: input.difficulty,
    });
  });
}

export function recordBenchmarkTaskResult(input: {
  runId: string;
  taskId: string;
  category: BenchmarkTaskCategory;
  difficulty: string;
  definition?: BenchmarkTaskDefinition;
  status: Exclude<BenchmarkTaskStatus, "queued" | "running">;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  durationMs?: number | null;
  llmDurationMs?: number | null;
  toolDurationMs?: number | null;
  verificationDurationMs?: number | null;
  repairDurationMs?: number | null;
  scores?: BenchmarkScoreMap;
  tokens?: BenchmarkTokenUsage;
  cost?: BenchmarkCost;
  behavior?: BenchmarkBehavior;
  acceptance?: BenchmarkAcceptanceResult[];
  finalResult?: BenchmarkJsonObject | null;
  failureReason?: string | null;
  failureType?: BenchmarkFailureType | null;
  evidence?: BenchmarkArtifactRef[];
  objectiveRunDir?: string | null;
}): BenchmarkTaskResult {
  return withTransaction((db) => {
    const current = getRunRow(db, input.runId);
    assertMutableRun(current, input.runId);
    const existing = getTaskRow(db, input.runId, input.taskId);
    if (existing?.finished_at) throw new Error(`Benchmark task ${input.taskId} is already finalized.`);
    const startedAt = input.startedAt ?? (existing?.started_at ? new Date(existing.started_at) : new Date());
    const finishedAt = input.finishedAt ?? new Date();
    const scores = normalizeScores(input.scores ?? {});
    const tokens = input.tokens ?? {};
    const cost = input.cost ?? { micros: null, kind: "unavailable" as const };
    const behavior = input.behavior ?? {};
    const acceptance = sanitizeAcceptanceResults(input.acceptance ?? []);
    const evidence = sanitizeArtifacts(input.evidence ?? []);
    const finalResult = input.finalResult ? sanitizeJsonObject(input.finalResult) : null;
    const taskDefinitionJson = input.definition
      ? JSON.stringify(sanitizeJsonObject(input.definition as unknown as Record<string, unknown>))
      : (existing?.task_definition_json ?? "{}");
    const values = {
      category: input.category,
      difficulty: input.difficulty,
      taskDefinitionJson,
      status: input.status,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: input.durationMs ?? Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      llmDurationMs: input.llmDurationMs ?? null,
      toolDurationMs: input.toolDurationMs ?? null,
      verificationDurationMs: input.verificationDurationMs ?? null,
      repairDurationMs: input.repairDurationMs ?? null,
      scoresJson: JSON.stringify(scores),
      inputTokens: tokens.inputTokens ?? null,
      outputTokens: tokens.outputTokens ?? null,
      cachedTokens: tokens.cachedTokens ?? null,
      reasoningTokens: tokens.reasoningTokens ?? null,
      totalTokens: tokens.totalTokens ?? null,
      costMicros: cost.micros,
      costKind: cost.kind,
      costSource: cost.source ?? null,
      behaviorJson: JSON.stringify(sanitizeJsonObject(behavior as unknown as Record<string, unknown>)),
      acceptanceJson: JSON.stringify(acceptance),
      finalResultJson: finalResult ? JSON.stringify(finalResult) : null,
      failureReason:
        input.failureReason === null || input.failureReason === undefined
          ? null
          : redactBenchmarkText(input.failureReason),
      failureType: input.failureType ?? null,
      evidenceJson: JSON.stringify(evidence),
      objectiveRunDir: input.objectiveRunDir ? redactBenchmarkText(input.objectiveRunDir) : null,
    };

    if (existing) {
      db.prepare(`
        UPDATE benchmark_task_results
        SET category = @category, difficulty = @difficulty, task_definition_json = @taskDefinitionJson, status = @status,
            started_at = @startedAt, finished_at = @finishedAt, duration_ms = @durationMs,
            llm_duration_ms = @llmDurationMs, tool_duration_ms = @toolDurationMs,
            verification_duration_ms = @verificationDurationMs, repair_duration_ms = @repairDurationMs,
            scores_json = @scoresJson, input_tokens = @inputTokens, output_tokens = @outputTokens,
            cached_tokens = @cachedTokens, reasoning_tokens = @reasoningTokens, total_tokens = @totalTokens,
            cost_micros = @costMicros, cost_kind = @costKind, cost_source = @costSource,
            behavior_json = @behaviorJson, acceptance_json = @acceptanceJson,
            final_result_json = @finalResultJson, failure_reason = @failureReason, failure_type = @failureType,
            evidence_json = @evidenceJson, objective_run_dir = @objectiveRunDir
        WHERE run_id = @runId AND task_id = @taskId
      `).run({ ...values, runId: input.runId, taskId: input.taskId });
    } else {
      db.prepare(`
        INSERT INTO benchmark_task_results (
          run_id, task_id, category, difficulty, task_definition_json, status, started_at, finished_at, duration_ms,
          llm_duration_ms, tool_duration_ms, verification_duration_ms, repair_duration_ms,
          scores_json, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens,
          cost_micros, cost_kind, cost_source, behavior_json, acceptance_json, final_result_json,
          failure_reason, failure_type, evidence_json, objective_run_dir
        ) VALUES (
          @runId, @taskId, @category, @difficulty, @taskDefinitionJson, @status, @startedAt, @finishedAt, @durationMs,
          @llmDurationMs, @toolDurationMs, @verificationDurationMs, @repairDurationMs,
          @scoresJson, @inputTokens, @outputTokens, @cachedTokens, @reasoningTokens, @totalTokens,
          @costMicros, @costKind, @costSource, @behaviorJson, @acceptanceJson, @finalResultJson,
          @failureReason, @failureType, @evidenceJson, @objectiveRunDir
        )
      `).run({ ...values, runId: input.runId, taskId: input.taskId });
    }

    db.prepare("DELETE FROM benchmark_acceptance_results WHERE run_id = ? AND task_id = ?").run(
      input.runId,
      input.taskId,
    );
    for (const criterion of acceptance) {
      db.prepare(`
        INSERT INTO benchmark_acceptance_results (
          run_id, task_id, criterion_id, description, status, required, detail, evidence_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.runId,
        input.taskId,
        criterion.id,
        criterion.description,
        criterion.status,
        criterion.required === undefined ? null : criterion.required ? 1 : 0,
        criterion.detail ?? null,
        JSON.stringify(criterion.evidence ?? []),
      );
    }
    for (const artifact of evidence) insertArtifactWithDb(db, input.runId, input.taskId, artifact);
    db.prepare("UPDATE benchmark_runs SET heartbeat_at = ? WHERE id = ?").run(new Date().toISOString(), input.runId);
    appendEventWithDb(db, input.runId, "task_finished", `${input.taskId} ${input.status}`, input.taskId, {
      status: input.status,
      scores,
      acceptanceCount: acceptance.length,
    });

    const row = getTaskRow(db, input.runId, input.taskId);
    if (!row) throw new Error(`Benchmark task ${input.taskId} was not recorded.`);
    return toTaskResult(row, acceptance);
  });
}

export function appendBenchmarkEvent(input: {
  runId: string;
  type: BenchmarkEvent["type"];
  message: string;
  taskId?: string | null;
  payload?: BenchmarkJsonObject;
}): BenchmarkEvent {
  return withTransaction((db) => {
    const current = getRunRow(db, input.runId);
    assertMutableRun(current, input.runId);
    return appendEventWithDb(db, input.runId, input.type, input.message, input.taskId ?? null, input.payload ?? {});
  });
}

export function recordBenchmarkArtifact(input: {
  runId: string;
  taskId?: string | null;
  artifact: BenchmarkArtifactRef;
}): void {
  withTransaction((db) => {
    const current = getRunRow(db, input.runId);
    assertMutableRun(current, input.runId);
    insertArtifactWithDb(db, input.runId, input.taskId ?? null, input.artifact);
    appendEventWithDb(db, input.runId, "artifact", input.artifact.label ?? input.artifact.path, input.taskId ?? null, {
      kind: input.artifact.kind,
      path: input.artifact.path,
    });
  });
}

export function finalizeBenchmarkRun(input: {
  runId: string;
  status: Extract<BenchmarkRunStatus, "completed" | "failed" | "cancelled" | "interrupted" | "invalid">;
  scores?: BenchmarkScoreMap;
  confidence?: BenchmarkJsonObject;
  tokens?: BenchmarkTokenUsage;
  cost?: BenchmarkCost;
  durationMs?: number | null;
  completedTaskCount?: number;
  resolvedTaskCount?: number;
  failureReason?: string | null;
  failureType?: BenchmarkFailureType | null;
  finishedAt?: Date;
}): BenchmarkRunSummary {
  return withTransaction((db) => {
    const current = getRunRow(db, input.runId);
    assertMutableRun(current, input.runId);
    const finishedAt = input.finishedAt ?? new Date();
    if (input.status === "interrupted") {
      db.prepare(`
        UPDATE benchmark_task_results
        SET status = 'interrupted', finished_at = ?,
            failure_reason = COALESCE(failure_reason, 'Task was interrupted before it produced a result.'),
            failure_type = COALESCE(failure_type, 'timeout')
        WHERE run_id = ? AND finished_at IS NULL
      `).run(finishedAt.toISOString(), input.runId);
    }
    const scores = normalizeScores(input.scores ?? {});
    const tokens = input.tokens ?? {};
    const cost = input.cost ?? { micros: null, kind: "unavailable" as const };
    const durationMs =
      input.durationMs ??
      (current?.started_at ? Math.max(0, finishedAt.getTime() - new Date(current.started_at).getTime()) : null);
    const completedTaskCount = Math.max(
      0,
      Math.min(current.task_count, Math.floor(input.completedTaskCount ?? countFinishedTasks(db, input.runId))),
    );
    const resolvedTaskCount = Math.max(
      0,
      Math.min(current.task_count, Math.floor(input.resolvedTaskCount ?? countPassedTasks(db, input.runId))),
    );
    const resolvedRate =
      current && current.task_count > 0 ? Math.round((resolvedTaskCount / current.task_count) * 1_000) / 10 : null;
    const failureReason =
      input.failureReason === null || input.failureReason === undefined
        ? null
        : redactBenchmarkText(input.failureReason);
    db.prepare(`
      UPDATE benchmark_runs
      SET status = ?, finished_at = ?, heartbeat_at = ?, finalized_at = ?,
          completed_task_count = ?, resolved_task_count = ?, resolved_rate = ?, overall_score = ?,
          coding_score = ?, agentic_score = ?,
          intent_score = ?, verification_score = ?, research_score = ?, memory_score = ?,
          repair_score = ?, efficiency_score = ?, scores_json = ?, confidence_json = ?,
          input_tokens = ?, output_tokens = ?, cached_tokens = ?, reasoning_tokens = ?, total_tokens = ?,
          cost_micros = ?, cost_kind = ?, cost_source = ?, duration_ms = ?, failure_reason = ?, failure_type = ?
      WHERE id = ?
    `).run(
      input.status,
      finishedAt.toISOString(),
      finishedAt.toISOString(),
      finishedAt.toISOString(),
      completedTaskCount,
      resolvedTaskCount,
      resolvedRate,
      scores.overall ?? null,
      scores.coding ?? null,
      scores.agentic ?? null,
      scores.intent ?? null,
      scores.verification ?? null,
      scores.research ?? null,
      scores.memory ?? null,
      scores.repair ?? null,
      scores.efficiency ?? null,
      JSON.stringify(scores),
      input.confidence ? JSON.stringify(sanitizeJsonObject(input.confidence)) : null,
      tokens.inputTokens ?? null,
      tokens.outputTokens ?? null,
      tokens.cachedTokens ?? null,
      tokens.reasoningTokens ?? null,
      tokens.totalTokens ?? null,
      cost.micros,
      cost.kind,
      cost.source ?? null,
      durationMs,
      failureReason,
      input.failureType ?? null,
      input.runId,
    );
    appendEventWithDb(db, input.runId, "status_changed", `Run finalized as ${input.status}`, null, {
      status: input.status,
      scores,
      completedTaskCount,
      failureReason,
    });
    const row = getRunRow(db, input.runId);
    if (!row) throw new Error(`Benchmark run ${input.runId} disappeared while finalizing.`);
    return toRunSummary(row);
  });
}

export function getBenchmarkRun(reference: string | number): BenchmarkRunSummary | null {
  const db = getDatabase();
  const row =
    typeof reference === "number" || /^\d+$/u.test(String(reference))
      ? (db.prepare(`SELECT ${RUN_COLUMNS} ${RUN_FROM} WHERE r.run_number = ?`).get(Number(reference)) as
          | BenchmarkRunRow
          | undefined)
      : (db.prepare(`SELECT ${RUN_COLUMNS} ${RUN_FROM} WHERE r.id = ?`).get(reference) as BenchmarkRunRow | undefined);
  return row ? toRunSummary(row) : null;
}

export function getBenchmarkRunDetails(reference: string | number): BenchmarkRunDetails | null {
  const run = getBenchmarkRun(reference);
  if (!run) return null;
  const db = getDatabase();
  const taskRows = db
    .prepare(`
      SELECT run_id, task_id, category, difficulty, task_definition_json, status, started_at, finished_at, duration_ms,
        llm_duration_ms, tool_duration_ms, verification_duration_ms, repair_duration_ms,
        scores_json, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens,
        cost_micros, cost_kind, cost_source, behavior_json, acceptance_json, final_result_json,
        failure_reason, failure_type, evidence_json, objective_run_dir
      FROM benchmark_task_results WHERE run_id = ? ORDER BY COALESCE(started_at, '') ASC, task_id ASC
    `)
    .all(run.runId) as BenchmarkTaskRow[];
  const acceptanceRows = db
    .prepare(`
      SELECT run_id, task_id, criterion_id, description, status, required, detail, evidence_json
      FROM benchmark_acceptance_results WHERE run_id = ? ORDER BY task_id ASC, criterion_id ASC
    `)
    .all(run.runId) as AcceptanceRow[];
  const acceptanceByTask = new Map<string, BenchmarkAcceptanceResult[]>();
  for (const row of acceptanceRows) {
    const list = acceptanceByTask.get(row.task_id) ?? [];
    list.push({
      id: row.criterion_id,
      description: row.description,
      status: row.status,
      ...(row.required === null ? {} : { required: row.required === 1 }),
      ...(row.detail ? { detail: row.detail } : {}),
      evidence: parseStringArray(row.evidence_json),
    });
    acceptanceByTask.set(row.task_id, list);
  }
  const events = db
    .prepare(`
      SELECT run_id, sequence, type, at, task_id, message, payload_json
      FROM benchmark_events WHERE run_id = ? ORDER BY sequence ASC
    `)
    .all(run.runId) as EventRow[];
  const artifacts = db
    .prepare(`
      SELECT kind, path, label, sha256, bytes, metadata_json
      FROM benchmark_artifacts WHERE run_id = ? ORDER BY id ASC
    `)
    .all(run.runId) as ArtifactRow[];
  return {
    ...run,
    tasks: taskRows.map((row) =>
      toTaskResult(row, acceptanceByTask.get(row.task_id) ?? parseAcceptance(row.acceptance_json)),
    ),
    events: events.map(toEvent),
    artifacts: artifacts.map(toArtifact),
  };
}

export function listBenchmarkRuns(filters: BenchmarkRunFilters = {}): BenchmarkRunSummary[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.workspaceId) {
    clauses.push("r.workspace_id = ?");
    params.push(filters.workspaceId);
  }
  if (filters.agentName) {
    clauses.push("r.agent_name = ?");
    params.push(filters.agentName);
  }
  if (filters.agentVersion) {
    clauses.push("r.agent_version = ?");
    params.push(filters.agentVersion);
  }
  if (filters.model) {
    clauses.push("r.model = ?");
    params.push(filters.model);
  }
  if (filters.modelProvider) {
    clauses.push("r.model_provider = ?");
    params.push(filters.modelProvider);
  }
  if (filters.modelVersion) {
    clauses.push("r.model_version = ?");
    params.push(filters.modelVersion);
  }
  if (filters.repositoryCommit) {
    clauses.push("r.repository_commit = ?");
    params.push(filters.repositoryCommit);
  }
  if (filters.benchmarkVersion) {
    clauses.push("r.benchmark_version = ?");
    params.push(filters.benchmarkVersion);
  }
  if (filters.suite) {
    clauses.push("r.benchmark_suite = ?");
    params.push(filters.suite);
  }
  if (filters.createdAfter) {
    clauses.push("r.created_at >= ?");
    params.push(filters.createdAfter.toISOString());
  }
  if (filters.createdBefore) {
    clauses.push("r.created_at <= ?");
    params.push(filters.createdBefore.toISOString());
  }
  const statuses = filters.statuses ?? (filters.status ? [filters.status] : undefined);
  if (statuses?.length) {
    clauses.push(`r.status IN (${statuses.map(() => "?").join(", ")})`);
    params.push(...statuses);
  }
  if (filters.search?.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    clauses.push(
      "(r.id LIKE ? OR CAST(r.run_number AS TEXT) LIKE ? OR r.agent_name LIKE ? OR COALESCE(r.agent_version, '') LIKE ? OR COALESCE(r.model, '') LIKE ? OR COALESCE(r.model_provider, '') LIKE ? OR r.benchmark_version LIKE ? OR r.benchmark_suite LIKE ? OR r.status LIKE ? OR r.created_at LIKE ? OR COALESCE(r.repository_commit, '') LIKE ?)",
    );
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  const limit = Math.max(1, Math.min(500, Math.floor(filters.limit ?? 100)));
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));
  params.push(limit, offset);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDatabase()
    .prepare(`SELECT ${RUN_COLUMNS} ${RUN_FROM} ${where} ORDER BY r.run_number DESC LIMIT ? OFFSET ?`)
    .all(...params) as BenchmarkRunRow[];
  return rows.map(toRunSummary);
}

export function listBenchmarkLeaderboard(
  options: {
    workspaceId?: string;
    suite?: string;
    benchmarkVersion?: string;
    agentName?: string;
    model?: string;
    limit?: number;
  } = {},
): BenchmarkLeaderboardEntry[] {
  const version =
    options.benchmarkVersion ?? latestCompletedVersion(options.workspaceId, options.suite, options.agentName);
  if (!version) return [];
  const clauses = [
    "r.status = 'completed'",
    "r.leaderboard_eligible = 1",
    "r.benchmark_version = ?",
    "r.overall_score IS NOT NULL",
  ];
  const params: unknown[] = [version];
  if (options.workspaceId) {
    clauses.push("r.workspace_id = ?");
    params.push(options.workspaceId);
  }
  if (options.suite) {
    clauses.push("r.benchmark_suite = ?");
    params.push(options.suite);
  }
  if (options.agentName) {
    clauses.push("r.agent_name = ?");
    params.push(options.agentName);
  }
  if (options.model) {
    clauses.push("r.model = ?");
    params.push(options.model);
  }
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));
  params.push(limit);
  const rows = getDatabase()
    .prepare(`
      SELECT * FROM (
          SELECT ${RUN_COLUMNS},
          COUNT(*) OVER (
            PARTITION BY r.workspace_id, r.benchmark_suite, r.benchmark_version,
              r.agent_name, r.agent_version, r.model, r.model_provider, r.model_version,
              r.configuration_fingerprint
          ) AS run_count,
          ROW_NUMBER() OVER (
            PARTITION BY r.workspace_id, r.benchmark_suite, r.benchmark_version,
              r.agent_name, r.agent_version, r.model, r.model_provider, r.model_version,
              r.configuration_fingerprint
            ORDER BY r.run_number DESC
          ) AS configuration_rank
        ${RUN_FROM}
        WHERE ${clauses.join(" AND ")}
      ) ranked
      WHERE configuration_rank = 1
      ORDER BY overall_score DESC, run_number DESC
      LIMIT ?
    `)
    .all(...params) as Array<BenchmarkRunRow & { run_count: number }>;
  return rows.map((row) => ({ ...toRunSummary(row), runCount: row.run_count }));
}

export function listBenchmarkVersions(workspaceId?: string): BenchmarkVersionSummary[] {
  const params: unknown[] = [];
  const where = workspaceId ? "WHERE workspace_id = ?" : "";
  if (workspaceId) params.push(workspaceId);
  const rows = getDatabase()
    .prepare(`
      SELECT benchmark_version, benchmark_suite, COUNT(*) AS run_count, MAX(created_at) AS latest_at
      FROM benchmark_runs ${where}
      GROUP BY benchmark_version, benchmark_suite
      ORDER BY latest_at DESC
    `)
    .all(...params) as Array<{
    benchmark_version: string;
    benchmark_suite: string;
    run_count: number;
    latest_at: string;
  }>;
  return rows.map((row) => ({
    benchmarkVersion: row.benchmark_version,
    suite: row.benchmark_suite,
    runCount: row.run_count,
    latestAt: new Date(row.latest_at),
  }));
}

export function compareBenchmarkRuns(runIds: string[]): BenchmarkRunComparison {
  const uniqueIds = [...new Set(runIds)].slice(0, 4);
  if (uniqueIds.length < 2) throw new Error("Select at least two benchmark runs to compare.");
  const details = uniqueIds.map((runId) => getBenchmarkRunDetails(runId));
  if (details.some((detail): detail is null => detail === null))
    throw new Error("One or more benchmark runs were not found.");
  const runs = details as BenchmarkRunDetails[];
  const comparable = runs.every(
    (run) =>
      run.benchmarkVersion === runs[0]?.benchmarkVersion &&
      run.suite === runs[0]?.suite &&
      run.agentName === runs[0]?.agentName &&
      run.configurationFingerprint === runs[0]?.configurationFingerprint &&
      run.model === runs[0]?.model &&
      run.modelProvider === runs[0]?.modelProvider &&
      run.modelVersion === runs[0]?.modelVersion,
  );
  const reason = comparable
    ? null
    : "Benchmark scope or configuration differs (suite, version, agent, model or config); score deltas are withheld until runs are comparable.";
  const last = runs.at(-1)!;
  const metrics: BenchmarkMetricComparison[] = (Object.keys(SCORE_COLUMNS) as Array<keyof BenchmarkScoreMap>).map(
    (dimension) => {
      const values = runs.map((run) => run.scores[dimension] ?? null);
      const first = values[0];
      const final = values.at(-1) ?? null;
      return {
        dimension,
        values,
        deltaFromFirst: comparable && first !== null && final !== null ? roundDelta(final - first) : null,
      };
    },
  );
  const base = runs[0];
  const baseDetails = base!;
  const taskIds = new Set([...baseDetails.tasks.map((task) => task.taskId), ...last.tasks.map((task) => task.taskId)]);
  const taskChanges = { improved: [] as string[], regressed: [] as string[], unchanged: [] as string[] };
  const currentById = new Map(last.tasks.map((task) => [task.taskId, task]));
  const baseById = new Map(baseDetails.tasks.map((task) => [task.taskId, task]));
  if (comparable) {
    for (const taskId of taskIds) {
      const previous = baseById.get(taskId);
      const current = currentById.get(taskId);
      const delta = taskDelta(previous, current);
      if (delta > 0) taskChanges.improved.push(taskId);
      else if (delta < 0) taskChanges.regressed.push(taskId);
      else taskChanges.unchanged.push(taskId);
    }
  }
  const costDeltaMicros =
    comparable && base.cost.micros !== null && last.cost.micros !== null ? last.cost.micros - base.cost.micros : null;
  const durationDeltaMs =
    comparable && base.durationMs !== null && last.durationMs !== null ? last.durationMs - base.durationMs : null;
  return { runs, comparable, reason, metrics, taskChanges, costDeltaMicros, durationDeltaMs };
}

export function setBenchmarkBaseline(runId: string): BenchmarkRunSummary {
  return withTransaction((db) => {
    const run = getRunRow(db, runId);
    if (!run) throw new Error(`Benchmark run ${runId} was not found.`);
    if (run.status !== "completed" || run.finalized_at === null || run.leaderboard_eligible !== 1)
      throw new Error("Only a completed leaderboard-eligible run can be a baseline.");
    db.prepare(`
      INSERT INTO benchmark_baselines (workspace_id, benchmark_suite, benchmark_version, agent_name, run_id, set_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, benchmark_suite, benchmark_version, agent_name) DO UPDATE SET
        run_id = excluded.run_id, set_at = excluded.set_at
    `).run(
      run.workspace_id,
      run.benchmark_suite,
      run.benchmark_version,
      run.agent_name,
      run.id,
      new Date().toISOString(),
    );
    return toRunSummary(run);
  });
}

export function getBenchmarkBaseline(input: {
  workspaceId: string;
  suite: string;
  benchmarkVersion: string;
  agentName: string;
  model?: string | null;
  modelProvider?: string | null;
  modelVersion?: string | null;
}): BenchmarkRunSummary | null {
  const modelClause =
    input.model === undefined ? "" : " AND r.model IS ? AND r.model_provider IS ? AND r.model_version IS ?";
  const params: unknown[] = [input.workspaceId, input.suite, input.benchmarkVersion, input.agentName];
  if (input.model !== undefined) params.push(input.model, input.modelProvider ?? null, input.modelVersion ?? null);
  const row = getDatabase()
    .prepare(`
      SELECT ${RUN_COLUMNS}
      ${RUN_FROM}
      JOIN benchmark_baselines b ON b.run_id = r.id
      WHERE b.workspace_id = ? AND b.benchmark_suite = ? AND b.benchmark_version = ? AND b.agent_name = ?${modelClause}
    `)
    .get(...params) as BenchmarkRunRow | undefined;
  return row ? toRunSummary(row) : null;
}

export function markBenchmarkRunInterrupted(
  runId: string,
  reason = "The benchmark process stopped before finalization.",
): BenchmarkRunSummary | null {
  const run = getBenchmarkRun(runId);
  if (!run || TERMINAL_STATUSES.includes(run.status)) return run;
  return finalizeBenchmarkRun({ runId, status: "interrupted", failureReason: reason });
}

export function recoverInterruptedBenchmarkRuns(workspaceId?: string): BenchmarkRunSummary[] {
  const active = listBenchmarkRuns({
    workspaceId,
    statuses: ["queued", "preparing", "running", "verifying"],
    limit: 500,
  });
  const recovered: BenchmarkRunSummary[] = [];
  for (const run of active) {
    if (run.processId !== null && isProcessAlive(run.processId)) continue;
    const interrupted = markBenchmarkRunInterrupted(
      run.runId,
      run.processId === null
        ? "No owning benchmark process was recorded; run marked interrupted during recovery."
        : `Owning benchmark process ${run.processId} is no longer running.`,
    );
    if (interrupted) recovered.push(interrupted);
  }
  return recovered;
}

function getRunRow(db: SQLiteDatabase, runId: string): BenchmarkRunRow | undefined {
  return db.prepare(`SELECT ${RUN_COLUMNS} ${RUN_FROM} WHERE r.id = ?`).get(runId) as BenchmarkRunRow | undefined;
}

function getTaskRow(db: SQLiteDatabase, runId: string, taskId: string): BenchmarkTaskRow | undefined {
  return db
    .prepare(`
      SELECT run_id, task_id, category, difficulty, task_definition_json, status, started_at, finished_at, duration_ms,
        llm_duration_ms, tool_duration_ms, verification_duration_ms, repair_duration_ms,
        scores_json, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens,
        cost_micros, cost_kind, cost_source, behavior_json, acceptance_json, final_result_json,
        failure_reason, failure_type, evidence_json, objective_run_dir
      FROM benchmark_task_results WHERE run_id = ? AND task_id = ?
    `)
    .get(runId, taskId) as BenchmarkTaskRow | undefined;
}

function assertMutableRun(row: BenchmarkRunRow | undefined | null, runId: string): asserts row is BenchmarkRunRow {
  if (!row) throw new Error(`Benchmark run ${runId} was not found.`);
  if (row.finalized_at) {
    throw new Error(`Benchmark run ${runId} is finalized and immutable.`);
  }
}

function appendEventWithDb(
  db: SQLiteDatabase,
  runId: string,
  type: BenchmarkEvent["type"],
  message: string,
  taskId: string | null,
  payload: BenchmarkJsonObject,
): BenchmarkEvent {
  const next = db
    .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM benchmark_events WHERE run_id = ?")
    .get(runId) as {
    next_sequence: number;
  };
  const sequence = next.next_sequence;
  const at = new Date();
  const safeMessage = redactBenchmarkText(message);
  const safePayload = sanitizeJsonObject(payload);
  db.prepare(`
    INSERT INTO benchmark_events (run_id, sequence, type, at, task_id, message, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(runId, sequence, type, at.toISOString(), taskId, safeMessage, JSON.stringify(safePayload));
  return { runId, sequence, type, at, taskId, message: safeMessage, payload: safePayload };
}

function insertArtifactWithDb(
  db: SQLiteDatabase,
  runId: string,
  taskId: string | null,
  artifact: BenchmarkArtifactRef,
): void {
  const safeArtifact = sanitizeArtifact(artifact);
  db.prepare(`
    INSERT INTO benchmark_artifacts (
      run_id, task_id, kind, path, label, sha256, bytes, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    taskId,
    safeArtifact.kind,
    safeArtifact.path,
    safeArtifact.label ?? null,
    safeArtifact.sha256 ?? null,
    safeArtifact.bytes ?? null,
    JSON.stringify(sanitizeJsonObject(safeArtifact.metadata)),
    new Date().toISOString(),
  );
}

function sanitizeAcceptanceResults(values: readonly BenchmarkAcceptanceResult[]): BenchmarkAcceptanceResult[] {
  return values.map(
    (criterion) =>
      sanitizeJsonObject(criterion as unknown as Record<string, unknown>) as unknown as BenchmarkAcceptanceResult,
  );
}

function sanitizeArtifacts(values: readonly BenchmarkArtifactRef[]): BenchmarkArtifactRef[] {
  return values.map((artifact) => sanitizeArtifact(artifact));
}

function sanitizeArtifact(artifact: BenchmarkArtifactRef): BenchmarkArtifactRef {
  return sanitizeJsonObject(artifact as unknown as Record<string, unknown>) as unknown as BenchmarkArtifactRef;
}

function countFinishedTasks(db: SQLiteDatabase, runId: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS count FROM benchmark_task_results WHERE run_id = ? AND finished_at IS NOT NULL AND status <> 'interrupted'",
    )
    .get(runId) as { count: number };
  return row.count;
}

function countPassedTasks(db: SQLiteDatabase, runId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM benchmark_task_results WHERE run_id = ? AND status = 'passed'")
    .get(runId) as { count: number };
  return row.count;
}

function toRunSummary(row: BenchmarkRunRow): BenchmarkRunSummary {
  const scores = normalizeScores(parseObject(row.scores_json));
  const tokens: BenchmarkTokenUsage = {
    ...(row.input_tokens === null ? {} : { inputTokens: row.input_tokens }),
    ...(row.output_tokens === null ? {} : { outputTokens: row.output_tokens }),
    ...(row.cached_tokens === null ? {} : { cachedTokens: row.cached_tokens }),
    ...(row.reasoning_tokens === null ? {} : { reasoningTokens: row.reasoning_tokens }),
    ...(row.total_tokens === null ? {} : { totalTokens: row.total_tokens }),
  };
  const cost: BenchmarkCost = {
    micros: row.cost_micros,
    kind: row.cost_kind ?? "unavailable",
    ...(row.cost_source ? { source: row.cost_source } : {}),
  };
  return {
    runId: row.id,
    runNumber: row.run_number,
    workspaceId: row.workspace_id,
    workspacePath: row.workspace_path,
    status: row.status,
    createdAt: new Date(row.created_at),
    startedAt: toDate(row.started_at),
    finishedAt: toDate(row.finished_at),
    heartbeatAt: toDate(row.heartbeat_at),
    benchmarkVersion: row.benchmark_version,
    suite: row.benchmark_suite,
    agentName: row.agent_name,
    leaderboardEligible: row.leaderboard_eligible === 1,
    agentVersion: row.agent_version,
    agentConfig: parseObject(row.agent_config_json),
    configurationFingerprint: row.configuration_fingerprint,
    model: row.model,
    modelProvider: row.model_provider,
    modelVersion: row.model_version,
    repositoryCommit: row.repository_commit,
    repositoryDirty: row.repository_dirty === 1,
    repositoryDiffHash: row.repository_diff_hash,
    shelraVersion: row.shelra_version,
    environment: parseObject(row.environment_json) as unknown as BenchmarkEnvironment,
    benchmarkConfig: parseObject(row.benchmark_config_json),
    ...(row.seed_text === null ? {} : { seed: row.seed_text }),
    taskCount: row.task_count,
    completedTaskCount: row.completed_task_count,
    resolvedTaskCount: row.resolved_task_count,
    resolvedRate: row.resolved_rate,
    scores,
    ...(row.confidence_json ? { confidence: parseObject(row.confidence_json) } : {}),
    tokens,
    cost,
    durationMs: row.duration_ms,
    failureReason: row.failure_reason,
    failureType: row.failure_type,
    processId: row.process_id,
    finalizedAt: toDate(row.finalized_at),
  } as BenchmarkRunSummary;
}

function toTaskResult(row: BenchmarkTaskRow, acceptance: BenchmarkAcceptanceResult[]): BenchmarkTaskResult {
  return {
    runId: row.run_id,
    taskId: row.task_id,
    category: row.category,
    difficulty: row.difficulty,
    definition: parseTaskDefinition(row.task_definition_json),
    status: row.status,
    startedAt: toDate(row.started_at),
    finishedAt: toDate(row.finished_at),
    durationMs: row.duration_ms,
    llmDurationMs: row.llm_duration_ms,
    toolDurationMs: row.tool_duration_ms,
    verificationDurationMs: row.verification_duration_ms,
    repairDurationMs: row.repair_duration_ms,
    scores: normalizeScores(parseObject(row.scores_json)),
    tokens: {
      ...(row.input_tokens === null ? {} : { inputTokens: row.input_tokens }),
      ...(row.output_tokens === null ? {} : { outputTokens: row.output_tokens }),
      ...(row.cached_tokens === null ? {} : { cachedTokens: row.cached_tokens }),
      ...(row.reasoning_tokens === null ? {} : { reasoningTokens: row.reasoning_tokens }),
      ...(row.total_tokens === null ? {} : { totalTokens: row.total_tokens }),
    },
    cost: {
      micros: row.cost_micros,
      kind: row.cost_kind ?? "unavailable",
      ...(row.cost_source ? { source: row.cost_source } : {}),
    },
    behavior: parseObject(row.behavior_json) as unknown as BenchmarkBehavior,
    acceptance,
    finalResult: row.final_result_json ? parseObject(row.final_result_json) : null,
    failureReason: row.failure_reason,
    failureType: row.failure_type,
    evidence: parseArtifacts(row.evidence_json),
    objectiveRunDir: row.objective_run_dir,
  };
}

function toEvent(row: EventRow): BenchmarkEvent {
  return {
    runId: row.run_id,
    sequence: row.sequence,
    type: row.type,
    at: new Date(row.at),
    taskId: row.task_id,
    message: row.message,
    payload: parseObject(row.payload_json),
  };
}

function toArtifact(row: ArtifactRow): BenchmarkArtifactRef {
  return {
    kind: row.kind,
    path: row.path,
    ...(row.label ? { label: row.label } : {}),
    ...(row.sha256 ? { sha256: row.sha256 } : {}),
    ...(row.bytes === null ? {} : { bytes: row.bytes }),
    metadata: parseObject(row.metadata_json),
  };
}

function normalizeScores(input: BenchmarkJsonObject | BenchmarkScoreMap): BenchmarkScoreMap {
  const result: BenchmarkScoreMap = {};
  for (const dimension of Object.keys(SCORE_COLUMNS) as Array<keyof BenchmarkScoreMap>) {
    const value = normalizeBenchmarkScore(input[dimension]);
    if (value !== undefined) result[dimension] = value;
  }
  return result;
}

function parseObject(value: string): BenchmarkJsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as BenchmarkJsonObject;
  } catch {
    // Corrupt optional JSON is represented as an empty object so history remains readable.
  }
  return {};
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseArtifacts(value: string): BenchmarkArtifactRef[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? (parsed.filter((item) => typeof item === "object" && item !== null) as BenchmarkArtifactRef[])
      : [];
  } catch {
    return [];
  }
}

function parseAcceptance(value: string): BenchmarkAcceptanceResult[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? (parsed.filter((item) => typeof item === "object" && item !== null) as BenchmarkAcceptanceResult[])
      : [];
  } catch {
    return [];
  }
}

function parseTaskDefinition(value: string): BenchmarkTaskDefinition | null {
  const parsed = parseObject(value);
  if (
    typeof parsed.id !== "string" ||
    typeof parsed.category !== "string" ||
    typeof parsed.difficulty !== "string" ||
    typeof parsed.prompt !== "string"
  ) {
    return null;
  }
  return parsed as unknown as BenchmarkTaskDefinition;
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

function latestCompletedVersion(workspaceId?: string, suite?: string, agentName?: string): string | null {
  const clauses = ["status = 'completed'"];
  const params: unknown[] = [];
  if (workspaceId) {
    clauses.push("workspace_id = ?");
    params.push(workspaceId);
  }
  if (suite) {
    clauses.push("benchmark_suite = ?");
    params.push(suite);
  }
  if (agentName) {
    clauses.push("agent_name = ?");
    params.push(agentName);
  }
  const row = getDatabase()
    .prepare(
      `SELECT benchmark_version FROM benchmark_runs WHERE ${clauses.join(" AND ")} ORDER BY run_number DESC LIMIT 1`,
    )
    .get(...params) as { benchmark_version: string } | undefined;
  return row?.benchmark_version ?? null;
}

function taskDelta(previous: BenchmarkTaskResult | undefined, current: BenchmarkTaskResult | undefined): number {
  const previousScore = previous ? averageTaskScore(previous) : undefined;
  const currentScore = current ? averageTaskScore(current) : undefined;
  if (previousScore === undefined && currentScore === undefined) return 0;
  if (previousScore === undefined) return 1;
  if (currentScore === undefined) return -1;
  if (currentScore > previousScore + 0.05) return 1;
  if (currentScore < previousScore - 0.05) return -1;
  return 0;
}

function roundDelta(value: number): number {
  return Math.round(value * 10) / 10;
}

function createBenchmarkRunId(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/gu, "")
    .slice(0, 14);
  return `run_${stamp}_${randomUUID().replace(/-/gu, "").slice(0, 8)}`;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
