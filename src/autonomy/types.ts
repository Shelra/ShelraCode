import type { AcceptanceCriterion, VerificationReport } from "../contract/types";
import type { BrowserObservation, CommandOutcome, FileChange, HttpProbe } from "../exec/types";
import type { IntelligenceLedger } from "../intelligence/types";

// The check vocabulary moved to the neutral contract module; this runtime keeps its old names.
export type {
  AcceptanceCriterion,
  CheckSpec,
  CriterionResult,
  DomCheck,
  VerificationReport,
  ViewportName,
} from "../contract/types";
export { verificationPassed } from "../contract/types";

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

/** The user-visible contract that execution and verification must satisfy. */
export interface ExecutableSpecification {
  /** Original user objective, preserved verbatim. */
  goal: string;
  requirements: string[];
  acceptance: AcceptanceCriterion[];
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
