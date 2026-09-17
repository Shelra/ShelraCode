import type { CheckSpec } from "../autonomy/types";

export const BENCHMARK_DIMENSIONS = [
  "overall",
  "coding",
  "agentic",
  "intent",
  "verification",
  "research",
  "memory",
  "repair",
  "efficiency",
] as const;

export type BenchmarkDimension = (typeof BENCHMARK_DIMENSIONS)[number];
export type BenchmarkTaskCategory = Exclude<BenchmarkDimension, "overall">;
export type BenchmarkScoreMap = Partial<Record<BenchmarkDimension, number>>;

export type BenchmarkRunStatus =
  | "queued"
  | "preparing"
  | "running"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "invalid";

export const BENCHMARK_FAILURE_TYPES = [
  "intent_failure",
  "context_failure",
  "memory_failure",
  "planning_failure",
  "research_failure",
  "tool_failure",
  "implementation_failure",
  "verification_failure",
  "repair_failure",
  "timeout",
  "environment",
  "model_failure",
] as const;

export type BenchmarkFailureType = (typeof BENCHMARK_FAILURE_TYPES)[number];

export type BenchmarkTaskStatus = "queued" | "running" | "passed" | "failed" | "cancelled" | "interrupted" | "skipped";
export type BenchmarkCriterionStatus = "passed" | "failed" | "partial" | "not_run";
export type BenchmarkCostKind = "exact" | "estimated" | "unavailable";

export type BenchmarkJson = null | boolean | number | string | BenchmarkJson[] | { [key: string]: BenchmarkJson };
export type BenchmarkJsonObject = { [key: string]: BenchmarkJson };

export interface BenchmarkTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export interface BenchmarkCost {
  micros: number | null;
  kind: BenchmarkCostKind;
  source?: string;
}

export interface BenchmarkEnvironment {
  platform?: string;
  release?: string;
  architecture?: string;
  cpuModel?: string;
  cpuCores?: number;
  memoryMb?: number;
  runtimeVersions?: Record<string, string>;
  toolVersions?: Record<string, string>;
}

export interface BenchmarkAcceptanceResult {
  id: string;
  description: string;
  status: BenchmarkCriterionStatus;
  detail?: string;
  required?: boolean;
  evidence?: string[];
}

export interface BenchmarkArtifactRef {
  kind: "log" | "diff" | "screenshot" | "test_output" | "trace" | "research" | "other";
  path: string;
  label?: string;
  sha256?: string;
  bytes?: number;
  metadata?: BenchmarkJsonObject;
}

export interface BenchmarkBehavior {
  planCreated?: boolean;
  researchPerformed?: boolean;
  researchSources?: number;
  delegatedAgents?: number;
  llmCalls?: number;
  toolCalls?: number;
  commandsExecuted?: number;
  filesRead?: number;
  filesChanged?: number;
  testsExecuted?: number;
  verificationAttempts?: number;
  failuresDetected?: number;
  repairsAttempted?: number;
  repairsSucceeded?: number;
  selfVerification?: boolean;
  humanInterventions?: number;
  completionBlocked?: boolean;
}

export interface BenchmarkTaskDefinition {
  id: string;
  category: BenchmarkTaskCategory;
  difficulty: string;
  prompt: string;
  /** Optional benchmark-owned acceptance contract; the agent's generated criteria are not the oracle. */
  acceptanceCriteria?: BenchmarkAcceptanceCriterion[];
  /** Copy this immutable fixture into a fresh per-run workspace before execution. */
  workspaceTemplate?: string;
  workspace?: string;
  /** Start from the finished workspace of an earlier task in the same run (cross-session scenarios). */
  workspaceFrom?: string;
  /** With `workspaceFrom`: keep the inherited project memory and promoted skills, or wipe them. */
  memoryPolicy?: "keep" | "wipe";
  researchRequired?: boolean;
  memoryRequired?: boolean;
  repairExpected?: boolean;
  metadata?: BenchmarkJsonObject;
}

export interface BenchmarkAcceptanceCriterion {
  id: string;
  description: string;
  /** Deterministic benchmark-owned oracle. Absent only for legacy agent-derived manifests. */
  check?: CheckSpec;
  required?: boolean;
}

export interface BenchmarkScorePolicy {
  id: string;
  version: string;
  weights: Partial<Record<BenchmarkDimension, number>>;
  requiredDimensions?: BenchmarkDimension[];
  correctnessFloor?: number;
  note?: string;
}

export interface BenchmarkManifest {
  benchmarkVersion: string;
  suite: string;
  /** Strict suites must provide deterministic benchmark-owned checks for every task criterion. */
  oracleMode?: "benchmark-owned" | "agent-derived";
  tasks: BenchmarkTaskDefinition[];
  scorePolicy?: BenchmarkScorePolicy;
  seed?: string | number;
  config?: BenchmarkJsonObject;
}

export interface BenchmarkRunInput {
  workspace: string;
  benchmarkVersion: string;
  suite: string;
  agentName: string;
  /** Only explicitly certified benchmark suites enter the primary leaderboard. */
  leaderboardEligible?: boolean;
  agentVersion?: string | null;
  agentConfig?: BenchmarkJsonObject;
  model?: string | null;
  modelProvider?: string | null;
  modelVersion?: string | null;
  repositoryCommit?: string | null;
  repositoryDirty?: boolean;
  repositoryDiffHash?: string | null;
  shelraVersion?: string | null;
  environment?: BenchmarkEnvironment;
  benchmarkConfig?: BenchmarkJsonObject;
  taskCount?: number;
  seed?: string | number | null;
  processId?: number | null;
}

export interface BenchmarkRunSummary {
  runId: string;
  runNumber: number;
  workspaceId: string;
  workspacePath: string;
  status: BenchmarkRunStatus;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  heartbeatAt: Date | null;
  benchmarkVersion: string;
  suite: string;
  agentName: string;
  leaderboardEligible: boolean;
  agentVersion: string | null;
  agentConfig: BenchmarkJsonObject;
  configurationFingerprint: string;
  model: string | null;
  modelProvider: string | null;
  modelVersion: string | null;
  repositoryCommit: string | null;
  repositoryDirty: boolean;
  repositoryDiffHash: string | null;
  shelraVersion: string | null;
  environment: BenchmarkEnvironment;
  benchmarkConfig: BenchmarkJsonObject;
  seed?: string;
  taskCount: number;
  completedTaskCount: number;
  resolvedTaskCount: number;
  resolvedRate: number | null;
  scores: BenchmarkScoreMap;
  confidence?: BenchmarkJsonObject;
  tokens: BenchmarkTokenUsage;
  cost: BenchmarkCost;
  durationMs: number | null;
  failureReason: string | null;
  failureType: BenchmarkFailureType | null;
  processId: number | null;
  finalizedAt: Date | null;
}

export interface BenchmarkTaskResult {
  runId: string;
  taskId: string;
  category: BenchmarkTaskCategory;
  difficulty: string;
  definition: BenchmarkTaskDefinition | null;
  status: BenchmarkTaskStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  llmDurationMs: number | null;
  toolDurationMs: number | null;
  verificationDurationMs: number | null;
  repairDurationMs: number | null;
  scores: BenchmarkScoreMap;
  tokens: BenchmarkTokenUsage;
  cost: BenchmarkCost;
  behavior: BenchmarkBehavior;
  acceptance: BenchmarkAcceptanceResult[];
  finalResult: BenchmarkJsonObject | null;
  failureReason: string | null;
  failureType: BenchmarkFailureType | null;
  evidence: BenchmarkArtifactRef[];
  objectiveRunDir: string | null;
}

export interface BenchmarkEvent {
  runId: string;
  sequence: number;
  type:
    | "run_created"
    | "status_changed"
    | "task_started"
    | "task_finished"
    | "verification"
    | "repair"
    | "artifact"
    | "error"
    | "note";
  at: Date;
  taskId: string | null;
  message: string;
  payload: BenchmarkJsonObject;
}

export interface BenchmarkRunDetails extends BenchmarkRunSummary {
  tasks: BenchmarkTaskResult[];
  events: BenchmarkEvent[];
  artifacts: BenchmarkArtifactRef[];
}

export interface BenchmarkLeaderboardEntry extends BenchmarkRunSummary {
  runCount: number;
}

export interface BenchmarkMetricComparison {
  dimension: BenchmarkDimension;
  values: Array<number | null>;
  deltaFromFirst: number | null;
}

export interface BenchmarkTaskComparison {
  improved: string[];
  regressed: string[];
  unchanged: string[];
}

export interface BenchmarkRunComparison {
  runs: BenchmarkRunSummary[];
  comparable: boolean;
  reason: string | null;
  metrics: BenchmarkMetricComparison[];
  taskChanges: BenchmarkTaskComparison;
  costDeltaMicros: number | null;
  durationDeltaMs: number | null;
}
