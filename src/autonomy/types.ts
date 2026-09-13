import type { BrowserObservation, CommandOutcome, FileChange, HttpProbe } from "../exec/types";
import type { IntelligenceLedger } from "../intelligence/types";

/**
 * The autonomy runtime's state model.
 *
 * An objective is not a chat message. It is a durable execution record that owns its
 * own requirements, acceptance criteria, plan, actions, observations and verdict, so
 * work can continue across turns without the model's context having to remember it.
 */

export type ObjectivePhase =
  | "interpreting"
  | "inspecting"
  | "planning"
  | "implementing"
  | "running"
  | "verifying"
  | "diagnosing"
  | "repairing"
  | "complete"
  | "stopped";

/** Why the runtime stopped. Ordinary build/test failures are NOT stop reasons — they are repair input. */
export type StopReason =
  | "verified_success"
  | "user_cancelled"
  | "authorization_required"
  | "impossible_environment"
  | "retry_exhausted";

/**
 * A deterministic, machine-evaluable check. The runtime — not the model — decides whether
 * an objective is complete, and it decides using these.
 *
 * `judge` is the deliberate escape hatch for genuinely semantic requirements. It is the only
 * variant that consults intelligence, and it is recorded as such so evidence stays honest
 * about what was machine-verified versus model-judged.
 */
export type CheckSpec =
  | { kind: "file_exists"; path: string }
  | { kind: "files_exist"; paths: string[] }
  | { kind: "file_contains"; path: string; pattern: string; ignoreCase?: boolean }
  | { kind: "no_external_urls"; paths?: string[] }
  | { kind: "command_succeeds"; command: string; timeoutMs?: number; expectExitCode?: number }
  | { kind: "http_ok"; path: string; expectStatus?: number }
  | { kind: "dom"; assertion: DomCheck; viewport?: ViewportName }
  | { kind: "no_console_errors" }
  | { kind: "no_external_requests" }
  | { kind: "no_horizontal_overflow"; viewport: ViewportName; tolerancePx?: number }
  | { kind: "judge"; question: string };

export type ViewportName = "mobile" | "desktop";

export interface DomCheck {
  description: string;
  selector?: string;
  minCount?: number;
  textContains?: string;
  expression?: string;
  /** Require the selected element's text to change during the observation window. */
  waitForChangeMs?: number;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  check: CheckSpec;
  /** Non-required criteria are reported but do not block completion. */
  required: boolean;
}

/** The user-visible contract that execution and verification must satisfy. */
export interface ExecutableSpecification {
  /** Original user objective, preserved verbatim. */
  goal: string;
  requirements: string[];
  acceptance: AcceptanceCriterion[];
}

export interface CriterionResult {
  id: string;
  description: string;
  passed: boolean;
  /** Human- and model-readable reason. For failures this is the primary repair input. */
  detail: string;
  kind: CheckSpec["kind"];
  /** True when a model decided this rather than a deterministic check. */
  modelJudged: boolean;
  checkedAt: number;
  durationMs: number;
}

export interface VerificationReport {
  attempt: number;
  passed: boolean;
  results: CriterionResult[];
  startedAt: number;
  durationMs: number;
  /** Criteria that could not be evaluated at all (e.g. app never started). */
  blocked: string[];
}

export function verificationPassed(report: VerificationReport, criteria: AcceptanceCriterion[]): boolean {
  const requiredIds = new Set(criteria.filter((c) => c.required).map((c) => c.id));
  if (report.blocked.some((id) => requiredIds.has(id))) return false;
  const byId = new Map(report.results.map((r) => [r.id, r]));
  for (const id of requiredIds) {
    const result = byId.get(id);
    if (!result || !result.passed) return false;
  }
  return true;
}

export type TaskStatus = "pending" | "active" | "done" | "failed" | "skipped";

export interface Task {
  id: string;
  description: string;
  /** Criterion ids this task is intended to satisfy. Used to focus verification and repair. */
  satisfies: string[];
  status: TaskStatus;
  attempts: number;
  lastError?: string;
}

export type ActionKind =
  | "inspect"
  | "write_file"
  | "edit_file"
  | "delete_file"
  | "run_command"
  | "start_process"
  | "stop_process"
  | "http_probe"
  | "browser_observe"
  | "intelligence_call";

/** One thing the runtime actually did, with its observed consequence. */
export interface Action {
  id: string;
  kind: ActionKind;
  taskId?: string;
  summary: string;
  startedAt: number;
  durationMs: number;
  ok: boolean;
  /** Structured evidence, kept out of model context unless the runtime chooses to surface it. */
  command?: CommandOutcome;
  fileChange?: FileChange;
  http?: HttpProbe;
  browser?: BrowserObservation;
  detail?: string;
}

/** A concise fact the runtime learned. Observations are what get fed back into intelligence. */
export interface Observation {
  at: number;
  phase: ObjectivePhase;
  text: string;
}

export interface RepairAttempt {
  attempt: number;
  /** The failing criteria this repair targeted. */
  targets: string[];
  diagnosis: string;
  strategy: string;
  /** Fingerprint of the failure this attempt responded to, for loop detection. */
  failureFingerprint: string;
  changedFiles: string[];
  resolved: boolean;
}

export interface AppRuntimeInfo {
  processId?: string;
  url?: string;
  port?: number;
  startCommand?: string;
  ready: boolean;
}

export interface Objective {
  id: string;
  /** Exactly what the user asked for, unmodified. */
  request: string;
  workspace: string;
  createdAt: number;
  updatedAt: number;
  phase: ObjectivePhase;

  /** Intelligence's reading of the request. */
  requirements: string[];
  acceptance: AcceptanceCriterion[];
  plan: Task[];

  actions: Action[];
  observations: Observation[];
  verifications: VerificationReport[];
  repairs: RepairAttempt[];

  app: AppRuntimeInfo;
  ledger: IntelligenceLedger;

  stopReason?: StopReason;
  /** Populated only for genuine blockers, never for ordinary failures. */
  blocker?: string;
  /** Directory holding logs, screenshots and the journal for this run. */
  runDir: string;
}

export interface ObjectiveOutcome {
  objective: Objective;
  stopReason: StopReason;
  verified: boolean;
  finalReport?: VerificationReport;
  /** Wall clock from objective start to stop. */
  durationMs: number;
  humanInterventions: number;
}

/** Phase labels surfaced to the user. Deliberately plain language, not internal jargon. */
export const PHASE_LABELS: Record<ObjectivePhase, string> = {
  interpreting: "Understanding request",
  inspecting: "Inspecting project",
  planning: "Planning",
  implementing: "Implementing",
  running: "Running application",
  verifying: "Verifying",
  diagnosing: "Diagnosing failure",
  repairing: "Repairing",
  complete: "Completed",
  stopped: "Stopped",
};
