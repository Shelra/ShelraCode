import { type RuntimeEvent, runObjective } from "../autonomy/runtime";
import type {
  AcceptanceCriterion,
  CheckSpec,
  CriterionResult,
  ObjectiveOutcome,
  VerificationReport,
} from "../autonomy/types";
import type { IntelligenceProvider } from "../intelligence/types";
import type { BenchmarkExecutionNotice, BenchmarkTaskExecution } from "./runner";
import { calculateIntentScore } from "./scoring";
import type {
  BenchmarkAcceptanceResult,
  BenchmarkBehavior,
  BenchmarkJsonObject,
  BenchmarkTaskDefinition,
} from "./types";

export interface ShelraBenchmarkExecutorOptions {
  intelligence: IntelligenceProvider;
  benchmarkRoot?: string;
  maxCostUsd?: number;
  maxRequestCostUsd?: number;
  signal?: AbortSignal;
}

/** Adapts Shelra's autonomous objective runtime to the benchmark task contract. */
export function createShelraBenchmarkExecutor(options: ShelraBenchmarkExecutorOptions) {
  return {
    async executeTask(
      task: BenchmarkTaskDefinition,
      context: { signal?: AbortSignal; emit: (notice: BenchmarkExecutionNotice) => void },
    ): Promise<BenchmarkTaskExecution> {
      const startedAt = Date.now();
      let outcome: ObjectiveOutcome | undefined;
      let researchPerformed = false;

      for await (const event of runObjective({
        workspace: task.workspace ?? process.cwd(),
        request: task.prompt,
        intelligence: options.intelligence,
        signal: context.signal ?? options.signal,
        maxCostUsd: options.maxCostUsd,
        maxRequestCostUsd: options.maxRequestCostUsd,
        benchmarkRoot: options.benchmarkRoot,
        acceptanceCriteria: toRuntimeAcceptanceCriteria(task.acceptanceCriteria),
      })) {
        if (event.message.toLowerCase().includes("research")) researchPerformed = true;
        context.emit(toBenchmarkNotice(event, task.id));
        if (event.outcome) outcome = event.outcome;
      }

      if (!outcome) {
        return {
          status: context.signal?.aborted ? "interrupted" : "failed",
          durationMs: Math.max(0, Date.now() - startedAt),
          behavior: { researchPerformed },
          failureReason: "Autonomy runtime ended without a terminal outcome.",
        };
      }
      const benchmarkCriteria = toRuntimeAcceptanceCriteria(task.acceptanceCriteria);
      return outcomeToExecution(outcome, researchPerformed, task.acceptanceCriteria, Boolean(benchmarkCriteria));
    },
  };
}

function outcomeToExecution(
  outcome: ObjectiveOutcome,
  researchPerformed: boolean,
  expectedCriteria?: BenchmarkTaskDefinition["acceptanceCriteria"],
  benchmarkOwned = false,
): BenchmarkTaskExecution {
  const objective = outcome.objective;
  const report = outcome.finalReport ?? objective.verifications.at(-1);
  const acceptance = toAcceptanceResults(expectedCriteria ?? objective.acceptance, report);
  const required = acceptance.filter((criterion) => criterion.required !== false);
  const passedRequired = required.filter((criterion) => criterion.status === "passed").length;
  const failedRequired = required.filter((criterion) => criterion.status === "failed");
  const coding = required.length > 0 ? (passedRequired / required.length) * 100 : undefined;
  const benchmarkVerified = outcome.verified && required.every((criterion) => criterion.status === "passed");
  const failureType = benchmarkVerified ? null : failedRequired.length > 0 ? "intent_failure" : "verification_failure";
  const intent = calculateIntentScore(acceptance);
  const verification = verificationScore(objective.verifications, acceptance, benchmarkOwned, objective);
  const repair =
    objective.repairs.length > 0
      ? (objective.repairs.filter((repairAttempt) => repairAttempt.resolved).length / objective.repairs.length) * 100
      : undefined;
  const behavior = toBehavior(objective, outcome, researchPerformed);
  const ledger = objective.ledger;
  const evidence = objective.runDir
    ? [
        {
          kind: "other" as const,
          path: objective.runDir,
          label: "Objective journal and execution artifacts",
        },
      ]
    : [];
  const tokens =
    ledger.calls > 0 && ledger.inputTokensComplete && ledger.outputTokensComplete
      ? {
          inputTokens: ledger.inputTokens,
          outputTokens: ledger.outputTokens,
          totalTokens: ledger.inputTokens + ledger.outputTokens,
        }
      : {};

  return {
    status: benchmarkVerified ? "passed" : "failed",
    scores: {
      ...(coding === undefined ? {} : { coding }),
      ...(intent === undefined ? {} : { intent }),
      ...(verification === undefined ? {} : { verification }),
      ...(repair === undefined ? {} : { repair }),
    },
    tokens,
    cost: {
      micros: ledger.costAvailable ? Math.max(0, Math.round(ledger.costUsd * 1_000_000)) : null,
      kind: ledger.costAvailable ? "exact" : "unavailable",
      source: "intelligence ledger",
    },
    behavior,
    acceptance,
    finalResult: toFinalResult(outcome, acceptance, benchmarkVerified),
    failureReason: benchmarkVerified
      ? null
      : required.some((criterion) => criterion.status !== "passed")
        ? `Benchmark acceptance criteria not satisfied: ${required
            .filter((criterion) => criterion.status !== "passed")
            .map((criterion) => criterion.id)
            .join(", ")}`
        : (objective.blocker ?? `Objective stopped: ${outcome.stopReason}`),
    failureType,
    evidence,
    objectiveRunDir: objective.runDir,
    durationMs: outcome.durationMs,
    llmDurationMs: sumActionDurations(objective, "intelligence_call"),
    toolDurationMs: sumNonIntelligenceDurations(objective),
    verificationDurationMs: sumVerificationDurations(objective.verifications),
    repairDurationMs: null,
  };
}

function toAcceptanceResults(
  criteria: readonly { id: string; description: string; required?: boolean }[],
  report: VerificationReport | undefined,
): BenchmarkAcceptanceResult[] {
  const byId = new Map<string, CriterionResult>((report?.results ?? []).map((result) => [result.id, result]));
  const blocked = new Set(report?.blocked ?? []);
  return criteria.map((criterion) => {
    const result = byId.get(criterion.id);
    const status = result ? (result.passed ? "passed" : "failed") : blocked.has(criterion.id) ? "not_run" : "not_run";
    return {
      id: criterion.id,
      description: criterion.description,
      status,
      required: criterion.required !== false,
      ...(result?.detail ? { detail: result.detail } : {}),
    };
  });
}

function verificationScore(
  reports: readonly VerificationReport[],
  criteria: readonly BenchmarkAcceptanceResult[],
  benchmarkOwned: boolean,
  objective: ObjectiveOutcome["objective"],
): number | undefined {
  const report = reports.at(-1);
  if (!report || criteria.length === 0) return undefined;
  const expectedIds = new Set(criteria.map((criterion) => criterion.id));
  const checked = report.results.filter((result) => expectedIds.has(result.id)).length;
  const coverage = Math.min(1, checked / criteria.length);
  if (benchmarkOwned && !hasSelfVerification(objective)) return 0;
  return Math.round(coverage * 1000) / 10;
}

function hasSelfVerification(objective: ObjectiveOutcome["objective"]): boolean {
  return objective.actions.some(
    (action) =>
      action.ok && (action.kind === "run_command" || action.kind === "browser_observe" || action.kind === "http_probe"),
  );
}

function toBehavior(
  objective: ObjectiveOutcome["objective"],
  outcome: ObjectiveOutcome,
  researchPerformed: boolean,
): BenchmarkBehavior {
  const failuresDetected = objective.verifications.reduce(
    (total, report) => total + report.results.filter((result) => !result.passed).length,
    0,
  );
  return {
    planCreated: objective.plan.length > 0,
    researchPerformed,
    llmCalls: objective.actions.filter((action) => action.kind === "intelligence_call").length,
    toolCalls: objective.actions.filter((action) => action.kind !== "intelligence_call").length,
    commandsExecuted: objective.actions.filter((action) => action.kind === "run_command").length,
    filesChanged: objective.actions.filter((action) => action.fileChange?.changed).length,
    testsExecuted: objective.actions.filter(
      (action) =>
        action.kind === "run_command" && /(?:test|check|lint|typecheck|verify)/iu.test(action.command?.command ?? ""),
    ).length,
    verificationAttempts: objective.verifications.length,
    failuresDetected,
    repairsAttempted: objective.repairs.length,
    repairsSucceeded: objective.repairs.filter((repair) => repair.resolved).length,
    selfVerification: hasSelfVerification(objective),
    humanInterventions: outcome.humanInterventions,
    completionBlocked: !outcome.verified,
  };
}

function toRuntimeAcceptanceCriteria(
  criteria: BenchmarkTaskDefinition["acceptanceCriteria"],
): AcceptanceCriterion[] | undefined {
  if (!criteria || criteria.length === 0 || criteria.some((criterion) => !criterion.check)) return undefined;
  return criteria.map((criterion) => ({
    id: criterion.id,
    description: criterion.description,
    required: criterion.required !== false,
    check: cloneCheckSpec(criterion.check!),
  }));
}

function cloneCheckSpec(check: CheckSpec): AcceptanceCriterion["check"] {
  if (check.kind === "files_exist" || check.kind === "no_external_urls") {
    return { ...check, ...(check.paths ? { paths: [...check.paths] } : {}) };
  }
  if (check.kind === "dom") return { ...check, assertion: { ...check.assertion } };
  return { ...check };
}

function toFinalResult(
  outcome: ObjectiveOutcome,
  acceptance: readonly BenchmarkAcceptanceResult[],
  benchmarkVerified: boolean,
): BenchmarkJsonObject {
  return {
    verified: benchmarkVerified,
    runtimeVerified: outcome.verified,
    stopReason: outcome.stopReason,
    phase: outcome.objective.phase,
    verificationAttempts: outcome.objective.verifications.length,
    repairAttempts: outcome.objective.repairs.length,
    acceptanceCount: acceptance.length,
    passedCriteria: acceptance.filter((criterion) => criterion.status === "passed").length,
    failedCriteria: acceptance.filter((criterion) => criterion.status === "failed").length,
  };
}

function toBenchmarkNotice(event: RuntimeEvent, taskId: string): BenchmarkExecutionNotice {
  if (event.type === "verification") {
    return {
      type: "verification",
      taskId,
      message: event.message,
      payload: event.report ? verificationPayload(event.report) : {},
    };
  }
  if (event.phase === "repairing" || event.phase === "diagnosing") {
    return {
      type: "repair",
      taskId,
      message: event.message,
      payload: event.phase ? { phase: event.phase } : {},
    };
  }
  return {
    type: "note",
    taskId,
    message: event.message,
    payload: {
      runtimeEvent: event.type,
      ...(event.phase ? { phase: event.phase } : {}),
    },
  };
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
    })),
  };
}

function sumActionDurations(objective: ObjectiveOutcome["objective"], kind: "intelligence_call"): number | null {
  const total = objective.actions
    .filter((action) => action.kind === kind)
    .reduce((sum, action) => sum + action.durationMs, 0);
  return total > 0 ? total : null;
}

function sumNonIntelligenceDurations(objective: ObjectiveOutcome["objective"]): number | null {
  const total = objective.actions
    .filter((action) => action.kind !== "intelligence_call")
    .reduce((sum, action) => sum + action.durationMs, 0);
  return total > 0 ? total : null;
}

function sumVerificationDurations(reports: readonly VerificationReport[]): number | null {
  const total = reports.reduce((sum, report) => sum + report.durationMs, 0);
  return total > 0 ? total : null;
}
