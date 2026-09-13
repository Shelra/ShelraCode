import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Action, Objective, Observation, RepairAttempt, VerificationReport } from "./types";

/**
 * The execution journal.
 *
 * Long-horizon autonomy cannot depend on a model's context to remember what happened, so
 * every objective owns a directory holding its state, its append-only event log, and the
 * artifacts (command logs, screenshots) that events refer to. A run can be reconstructed
 * — what was attempted, what failed, what changed, what still needs verifying — from disk
 * alone, which is also what makes benchmark results auditable after the fact.
 *
 * State is written as a whole-file snapshot; the event log is append-only. The snapshot is
 * small (a few hundred KB at worst) because bulky output lives in artifact files that the
 * records only reference by path.
 */

export type JournalEventType =
  | "objective_started"
  | "phase_changed"
  | "requirements_derived"
  | "acceptance_derived"
  | "plan_created"
  | "task_started"
  | "task_finished"
  | "action"
  | "observation"
  | "verification"
  | "repair"
  | "intelligence"
  | "objective_stopped";

export interface JournalEvent {
  at: number;
  type: JournalEventType;
  summary: string;
  data?: Record<string, unknown>;
}

export class ExecutionJournal {
  readonly runDir: string;
  private readonly eventsPath: string;
  private readonly statePath: string;
  private readonly events: JournalEvent[] = [];

  constructor(runDir: string) {
    this.runDir = runDir;
    this.eventsPath = join(runDir, "events.jsonl");
    this.statePath = join(runDir, "objective.json");
    mkdirSync(join(runDir, "artifacts"), { recursive: true });
  }

  /** Directory for command logs, screenshots and other bulky evidence. */
  artifactPath(name: string): string {
    return join(this.runDir, "artifacts", name);
  }

  record(type: JournalEventType, summary: string, data?: Record<string, unknown>): JournalEvent {
    const event: JournalEvent = { at: Date.now(), type, summary, data };
    this.events.push(event);
    try {
      // Append-only: a crash mid-run still leaves every prior event intact.
      writeFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, { flag: "a", encoding: "utf8" });
    } catch {
      // Journalling must never take down a run.
    }
    return event;
  }

  recordAction(action: Action): void {
    this.record("action", `${action.kind}: ${action.summary}`, {
      ok: action.ok,
      durationMs: action.durationMs,
      exitCode: action.command?.exitCode,
      path: action.fileChange?.path,
    });
  }

  recordObservation(observation: Observation): void {
    this.record("observation", observation.text, { phase: observation.phase });
  }

  recordVerification(report: VerificationReport): void {
    this.record("verification", `attempt ${report.attempt}: ${report.passed ? "passed" : "failed"}`, {
      passed: report.passed,
      failed: report.results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.detail}`),
      blocked: report.blocked,
    });
  }

  recordRepair(repair: RepairAttempt): void {
    this.record("repair", `attempt ${repair.attempt}: ${repair.strategy}`, {
      targets: repair.targets,
      rootCause: repair.diagnosis,
      changedFiles: repair.changedFiles,
    });
  }

  /** Snapshot the objective so an interrupted run can be inspected or resumed. */
  saveState(objective: Objective): void {
    const temporaryPath = `${this.statePath}.tmp`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(objective, null, 2), "utf8");
      renameSync(temporaryPath, this.statePath);
    } catch {
      try {
        rmSync(temporaryPath, { force: true });
      } catch {
        // Best-effort cleanup of an interrupted snapshot.
      }
      // Non-fatal.
    }
  }

  getEvents(): readonly JournalEvent[] {
    return this.events;
  }

  /** Reconstruct a run from disk — used by the benchmark reporter and by `shelra objectives`. */
  static load(runDir: string): { objective: Objective; events: JournalEvent[] } | null {
    const statePath = join(runDir, "objective.json");
    if (!existsSync(statePath)) return null;
    try {
      const objective = JSON.parse(readFileSync(statePath, "utf8")) as Objective;
      const eventsPath = join(runDir, "events.jsonl");
      const events: JournalEvent[] = [];
      if (existsSync(eventsPath)) {
        for (const line of readFileSync(eventsPath, "utf8").split(/\r?\n/u)) {
          if (!line.trim()) continue;
          try {
            events.push(JSON.parse(line) as JournalEvent);
          } catch {
            // Skip a torn final line.
          }
        }
      }
      return { objective, events };
    } catch {
      return null;
    }
  }

  static listRuns(root: string): string[] {
    if (!existsSync(root)) return [];
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(root, e.name))
        .sort();
    } catch {
      return [];
    }
  }
}

/** Objectives live under the workspace so their evidence travels with the project. */
export function objectiveRunDir(workspace: string, objectiveId: string): string {
  return join(workspace, ".shelra", "objectives", objectiveId);
}
