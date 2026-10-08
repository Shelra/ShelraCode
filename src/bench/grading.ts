import { existsSync } from "node:fs";
import { join } from "node:path";
import { evaluateAcceptance } from "../contract/evaluate";
import type { AcceptanceCriterion, CheckSpec, CriterionResult, VerificationReport } from "../contract/types";
import { observePage } from "../exec/browser";
import { runCommand } from "../exec/command";
import { type FrozenWorkspace, type FrozenWorkspaceReceipt, freezeWorkspace } from "../exec/frozen-workspace";
import { probeHttp } from "../exec/http";
import { gradingEnvironment } from "../exec/verification-environment";
import { runWindowsVerification } from "../exec/windows-appcontainer";
import type { BenchmarkExecutionNotice } from "./runner";
import { calculateIntentScore } from "./scoring";
import type { BenchmarkAcceptanceResult, BenchmarkJsonObject, BenchmarkTaskDefinition } from "./types";

/**
 * Grades a finished task workspace with the benchmark-owned oracle. Every agent the benchmark drives,
 * Shelra's own turn loop or an external reference agent, is graded here the same way, so their scores
 * can be compared (audit doc 15, item 0.1).
 */
export interface WorkspaceGrade {
  acceptance: BenchmarkAcceptanceResult[];
  /** Required criteria that did not pass. */
  failedRequired: BenchmarkAcceptanceResult[];
  requiredCount: number;
  /** At least one required criterion, and every one passed. */
  verified: boolean;
  coding?: number;
  intent?: number;
  report?: VerificationReport;
  evaluation?: FrozenWorkspaceReceipt;
}

export async function gradeWorkspace(
  task: BenchmarkTaskDefinition,
  workspace: string,
  options: {
    benchmarkRoot?: string;
    signal?: AbortSignal;
    /** Which agent's workspace this is, for the run's event log. */
    harness: string;
    emit: (notice: BenchmarkExecutionNotice) => void;
  },
): Promise<WorkspaceGrade> {
  const criteria = toRuntimeAcceptanceCriteria(task.acceptanceCriteria);
  let report: VerificationReport | undefined;
  let frozen: FrozenWorkspace | undefined;
  if (criteria) {
    options.emit({
      type: "verification",
      taskId: task.id,
      message: `Grading workspace against ${criteria.length} benchmark-owned criteria`,
      payload: { harness: options.harness },
    });
    try {
      const oracleRoots =
        options.benchmarkRoot && existsSync(join(options.benchmarkRoot, "bench", "oracles"))
          ? [
              "bench/oracles",
              ...(existsSync(join(options.benchmarkRoot, "bench", "fixtures")) ? ["bench/fixtures"] : []),
            ]
          : [""];
      frozen = await freezeWorkspace(workspace, options.benchmarkRoot, { oracleRoots });
      const environment = gradingEnvironment(frozen);
      options.emit({
        type: "verification",
        taskId: task.id,
        message:
          process.platform === "win32"
            ? "Grading a private candidate copy; commands require Windows AppContainer isolation"
            : "Grading a private candidate copy; OS process isolation is unavailable in this adapter",
        payload: { ...frozen.receipt },
      });
      report = await evaluateAcceptance(
        criteria,
        {
          workspace: frozen.workspace,
          benchmarkRoot: frozen.benchmarkRoot,
          attempt: 1,
          signal: options.signal,
          ...(process.platform === "win32" ? { commandShell: "cmd" as const } : {}),
        },
        {
          runCommand: async (command, commandOptions) => {
            if (process.platform === "win32") {
              const outcome = await runWindowsVerification(command, frozen as FrozenWorkspace, {
                env: commandOptions.env,
                timeoutMs: commandOptions.timeoutMs,
                signal: commandOptions.signal,
              });
              if (outcome.isolated && frozen) frozen.receipt.processIsolation = "windows-appcontainer";
              return outcome;
            }
            return runCommand({
              command,
              cwd: commandOptions.cwd,
              timeoutMs: commandOptions.timeoutMs,
              signal: commandOptions.signal,
              env: { ...environment, ...commandOptions.env },
              inheritEnv: false,
              logDir: frozen?.temp,
            });
          },
          probeHttp: (url) => probeHttp(url),
          observePage: (url, pageOptions) => observePage(url, pageOptions),
        },
      );
      await frozen.integrity();
    } catch (error) {
      report = blockedReport(criteria, `Benchmark evaluation unavailable or invalid: ${String(error)}`);
    } finally {
      if (frozen) {
        try {
          await frozen.cleanup();
        } catch (error) {
          report = blockedReport(criteria, `Benchmark evaluation cleanup failed: ${String(error)}`);
        }
      }
    }
    options.emit({
      type: "verification",
      taskId: task.id,
      message: report.passed
        ? `Benchmark oracle passed ${report.results.length} criteria`
        : `Benchmark oracle failed: ${report.results
            .filter((result) => !result.passed)
            .map((result) => result.id)
            .join(", ")}`,
      payload: verificationPayload(report),
    });
  }

  const acceptance = toAcceptanceResults(task.acceptanceCriteria ?? [], report);
  const required = acceptance.filter((criterion) => criterion.required !== false);
  const failedRequired = required.filter((criterion) => criterion.status !== "passed");
  const intent = calculateIntentScore(acceptance);
  return {
    acceptance,
    failedRequired,
    requiredCount: required.length,
    verified: required.length > 0 && failedRequired.length === 0,
    ...(required.length > 0 ? { coding: ((required.length - failedRequired.length) / required.length) * 100 } : {}),
    ...(intent === undefined ? {} : { intent }),
    ...(report ? { report } : {}),
    ...(frozen ? { evaluation: frozen.receipt } : {}),
  };
}

function blockedReport(criteria: AcceptanceCriterion[], detail: string): VerificationReport {
  const now = Date.now();
  return {
    attempt: 1,
    passed: false,
    startedAt: now,
    durationMs: 0,
    blocked: criteria.map((criterion) => criterion.id),
    results: criteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
      passed: false,
      kind: criterion.check.kind,
      modelJudged: false,
      checkedAt: now,
      durationMs: 0,
      detail,
    })),
  };
}

export function describeFailures(failedRequired: readonly BenchmarkAcceptanceResult[]): string {
  if (failedRequired.length === 0) return "No benchmark-owned acceptance criteria were supplied.";
  return `Benchmark acceptance criteria not satisfied: ${failedRequired.map((criterion) => criterion.id).join(", ")}`;
}

function toAcceptanceResults(
  criteria: readonly { id: string; description: string; required?: boolean }[],
  report: VerificationReport | undefined,
): BenchmarkAcceptanceResult[] {
  const byId = new Map<string, CriterionResult>((report?.results ?? []).map((result) => [result.id, result]));
  return criteria.map((criterion) => {
    const result = byId.get(criterion.id);
    return {
      id: criterion.id,
      description: criterion.description,
      status: !result || report?.blocked.includes(criterion.id) ? "not_run" : result.passed ? "passed" : "failed",
      required: criterion.required !== false,
      ...(result?.detail ? { detail: result.detail } : {}),
    };
  });
}

function toRuntimeAcceptanceCriteria(
  criteria: BenchmarkTaskDefinition["acceptanceCriteria"],
): AcceptanceCriterion[] | undefined {
  if (!criteria || criteria.length === 0 || criteria.some((criterion) => !criterion.check)) return undefined;
  return criteria.map((criterion) => ({
    id: criterion.id,
    description: criterion.description,
    required: criterion.required !== false,
    check: cloneCheckSpec(criterion.check as CheckSpec),
  }));
}

function cloneCheckSpec(check: CheckSpec): AcceptanceCriterion["check"] {
  if (check.kind === "files_exist" || check.kind === "no_external_urls") {
    return { ...check, ...(check.paths ? { paths: [...check.paths] } : {}) };
  }
  if (check.kind === "dom") return { ...check, assertion: { ...check.assertion } };
  return { ...check };
}

function verificationPayload(report: VerificationReport): BenchmarkJsonObject {
  return {
    attempt: report.attempt,
    passed: report.passed,
    durationMs: report.durationMs,
    blocked: report.blocked,
    results: report.results.map((result) => ({
      id: result.id,
      passed: result.passed,
      kind: result.kind,
      modelJudged: result.modelJudged,
      durationMs: result.durationMs,
      detail: result.detail.slice(0, 500),
    })),
  };
}
