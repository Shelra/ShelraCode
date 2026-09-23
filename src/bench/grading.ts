import { evaluateAcceptance } from "../autonomy/acceptance";
import type { AcceptanceCriterion, CheckSpec, CriterionResult, VerificationReport } from "../autonomy/types";
import { observePage } from "../exec/browser";
import { runCommand } from "../exec/command";
import { probeHttp } from "../exec/http";
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
  if (criteria) {
    options.emit({
      type: "verification",
      taskId: task.id,
      message: `Grading workspace against ${criteria.length} benchmark-owned criteria`,
      payload: { harness: options.harness },
    });
    report = await evaluateAcceptance(
      criteria,
      { workspace, benchmarkRoot: options.benchmarkRoot, attempt: 1, signal: options.signal },
      {
        runCommand: (command, commandOptions) =>
          runCommand({
            command,
            cwd: commandOptions.cwd,
            timeoutMs: commandOptions.timeoutMs,
            signal: commandOptions.signal,
            env: commandOptions.env,
          }),
        probeHttp: (url) => probeHttp(url),
        observePage: (url, pageOptions) => observePage(url, pageOptions),
      },
    );
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
      status: result ? (result.passed ? "passed" : "failed") : "not_run",
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
