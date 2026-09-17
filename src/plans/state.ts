import type { ChatEntry, Plan, ToolResult } from "../types/index";

/**
 * Rebuilds the latest executable plan from durable tool results.
 *
 * A later plan replaces an earlier plan. Updates are then replayed in order so
 * process restarts and transcript compaction do not erase host-owned progress.
 */
export function resolvePlanResults(results: ReadonlyArray<ToolResult | null | undefined>): Plan | null {
  let plan: Plan | null = null;

  for (const result of results) {
    if (result?.success && result.plan) {
      plan = clonePlan(result.plan);
      continue;
    }

    const update = result?.success ? result.planUpdate : undefined;
    if (!plan || !update || !plan.steps[update.index]) continue;
    plan = {
      ...plan,
      steps: plan.steps.map((step, index) =>
        index === update.index
          ? { ...step, status: update.status, ...(update.evidence ? { evidence: update.evidence } : {}) }
          : step,
      ),
    };
  }

  return plan;
}

/** Replays persisted plan traffic projected as chat entries. */
export function resolvePlanState(entries: readonly ChatEntry[]): Plan | null {
  return resolvePlanResults(entries.map((entry) => entry.toolResult));
}

function clonePlan(plan: Plan): Plan {
  return {
    ...plan,
    requirements: plan.requirements ? [...plan.requirements] : undefined,
    acceptanceCriteria: plan.acceptanceCriteria?.map((criterion) => ({ ...criterion })),
    questions: plan.questions?.map((question) => ({
      ...question,
      options: question.options?.map((option) => ({ ...option })),
    })),
    steps: plan.steps.map((step) => ({
      ...step,
      filePaths: step.filePaths ? [...step.filePaths] : undefined,
      satisfies: step.satisfies ? [...step.satisfies] : undefined,
      status: step.status ?? "pending",
    })),
  };
}
