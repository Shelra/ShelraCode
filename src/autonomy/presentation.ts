import { join } from "node:path";
import { ExecutionJournal } from "./journal";
import type { RuntimeEvent } from "./kernel";
import type { CheckSpec, ExecutableSpecification, Objective, Task, TaskStatus, VerificationReport } from "./types";

const TASK_MARKERS: Record<TaskStatus, string> = {
  pending: "[ ]",
  active: "[>]",
  done: "[x]",
  failed: "[!]",
  skipped: "[-]",
};

function compact(value: string, max = 180): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

export function describeCheck(check: CheckSpec): string {
  switch (check.kind) {
    case "file_exists":
      return `file exists: ${check.path}`;
    case "files_exist":
      return `files exist: ${check.paths.join(", ")}`;
    case "file_contains":
      return `file ${check.path} contains ${compact(check.pattern, 80)}`;
    case "no_external_urls":
      return `no external URLs${check.paths?.length ? ` in ${check.paths.join(", ")}` : ""}`;
    case "command_succeeds":
      return `command succeeds: ${compact(check.command, 100)}`;
    case "http_ok":
      return `HTTP ${check.path} returns ${check.expectStatus ?? 200}`;
    case "dom": {
      const target = check.assertion.selector
        ? `selector ${check.assertion.selector}`
        : check.assertion.textContains
          ? `text ${check.assertion.textContains}`
          : "browser expression";
      return `${target}${check.assertion.waitForChangeMs ? ` changes within ${check.assertion.waitForChangeMs}ms` : ""}`;
    }
    case "no_console_errors":
      return "no browser console or page errors";
    case "no_external_requests":
      return "no external runtime requests";
    case "no_horizontal_overflow":
      return `no horizontal overflow at ${check.viewport}`;
    case "judge":
      return `model-judged: ${compact(check.question, 100)}`;
  }
}

export function formatSpecification(specification: ExecutableSpecification): string {
  const requirements = specification.requirements.length
    ? specification.requirements.map((requirement, index) => `  R${index + 1}. ${requirement}`).join("\n")
    : "  (none)";
  const acceptance = specification.acceptance.length
    ? specification.acceptance
        .map(
          (criterion) =>
            `  [${criterion.required ? "MUST" : "OPTIONAL"}] ${criterion.id}: ${criterion.description}\n` +
            `      check: ${describeCheck(criterion.check)}`,
        )
        .join("\n")
    : "  (none)";
  return [
    "[SPECIFICATION] What Shelra understood and must prove",
    `Goal: ${specification.goal}`,
    "Requirements:",
    requirements,
    "Acceptance criteria:",
    acceptance,
  ].join("\n");
}

export function formatPlan(plan: readonly Task[]): string {
  if (plan.length === 0) return "[PLAN] No tasks were generated.";
  return [
    `[PLAN] ${plan.length} ordered task(s)`,
    ...plan.flatMap((task) => [
      `  ${TASK_MARKERS[task.status]} ${task.id}: ${task.description}`,
      `      satisfies: ${task.satisfies.length ? task.satisfies.join(", ") : "not mapped"}`,
    ]),
  ].join("\n");
}

export function formatTask(task: Task): string {
  return `[TASK] ${TASK_MARKERS[task.status]} ${task.id}: ${task.description} | satisfies: ${
    task.satisfies.length ? task.satisfies.join(", ") : "not mapped"
  } | attempt ${task.attempts}`;
}

function formatVerification(report: VerificationReport): string {
  return [
    `Verification ${report.passed ? "PASSED" : "FAILED"} (attempt ${report.attempt})`,
    ...report.results.map(
      (result) =>
        `  ${result.passed ? "PASS" : "FAIL"} ${result.id}: ${result.detail}${result.modelJudged ? " [model-judged]" : ""}`,
    ),
  ].join("\n");
}

export function objectiveEventPayload(event: RuntimeEvent): Record<string, unknown> {
  return {
    type: event.type,
    ...(event.phase ? { phase: event.phase } : {}),
    message: event.message,
    ...(event.specification ? { specification: event.specification } : {}),
    ...(event.plan ? { plan: event.plan } : {}),
    ...(event.task ? { task: event.task } : {}),
    ...(event.report
      ? {
          verification: {
            attempt: event.report.attempt,
            passed: event.report.passed,
            blocked: event.report.blocked,
            results: event.report.results.map((result) => ({
              id: result.id,
              description: result.description,
              passed: result.passed,
              detail: result.detail,
              kind: result.kind,
              modelJudged: result.modelJudged,
            })),
          },
        }
      : {}),
    ...(event.outcome
      ? {
          outcome: {
            verified: event.outcome.verified,
            stopReason: event.outcome.stopReason,
            objectiveId: event.outcome.objective.id,
            runDir: event.outcome.objective.runDir,
            modelCalls: event.outcome.objective.ledger.calls,
            models: event.outcome.objective.ledger.models ?? [],
            costUsd: event.outcome.objective.ledger.costAvailable ? event.outcome.objective.ledger.costUsd : null,
          },
        }
      : {}),
  };
}

export function formatObjectiveEvent(event: RuntimeEvent): string {
  switch (event.type) {
    case "phase":
      return `\n[${event.phase ?? "objective"}] ${event.message}\n`;
    case "specification":
      return `${event.specification ? formatSpecification(event.specification) : event.message}\n`;
    case "plan":
      return `${event.plan ? formatPlan(event.plan) : event.message}\n`;
    case "task":
      return `${event.task ? formatTask(event.task) : event.message}\n`;
    case "verification":
      return `${event.report ? formatVerification(event.report) : event.message}\n`;
    case "complete":
      return `${event.message}${event.outcome ? `\nEvidence: ${event.outcome.objective.runDir}` : ""}\n`;
    default:
      return `${event.message}\n`;
  }
}

export function loadObjectives(workspace: string): Objective[] {
  const root = join(workspace, ".shelra", "objectives");
  return ExecutionJournal.listRuns(root)
    .flatMap((runDir) => {
      const loaded = ExecutionJournal.load(runDir);
      return loaded ? [loaded.objective] : [];
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function findObjective<T extends Pick<Objective, "id">>(
  objectives: readonly T[],
  reference: string,
): T | undefined {
  if (reference.toLowerCase() === "latest") return objectives[0];
  const exact = objectives.find((objective) => objective.id === reference);
  if (exact) return exact;
  const matches = objectives.filter((objective) => objective.id.startsWith(reference));
  return matches.length === 1 ? matches[0] : undefined;
}

export function formatObjectiveList(objectives: readonly Objective[]): string {
  if (objectives.length === 0) return "No Shelra objectives were found in this workspace.";
  return [
    "Shelra objectives (newest first):",
    ...objectives.map(
      (objective) =>
        `  ${objective.id}  ${objective.phase.padEnd(12)}  ${new Date(objective.updatedAt).toISOString()}  ${compact(objective.request, 90)}`,
    ),
    "Use `shelra objectives latest` or `shelra objectives <id>` to inspect the specification and plan.",
  ].join("\n");
}

export function formatObjective(objective: Objective): string {
  const specification: ExecutableSpecification = {
    goal: objective.request,
    requirements: objective.requirements,
    acceptance: objective.acceptance,
  };
  const verification = objective.verifications.at(-1);
  return [
    `Objective ${objective.id}`,
    `State: ${objective.phase}${objective.stopReason ? ` (${objective.stopReason})` : ""}`,
    "",
    formatSpecification(specification),
    "",
    formatPlan(objective.plan),
    ...(verification ? ["", formatVerification(verification)] : []),
    "",
    `Evidence: ${objective.runDir}`,
  ].join("\n");
}
