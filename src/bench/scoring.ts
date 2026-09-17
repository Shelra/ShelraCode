import type {
  BenchmarkAcceptanceResult,
  BenchmarkCriterionStatus,
  BenchmarkScoreMap,
  BenchmarkScorePolicy,
  BenchmarkTaskResult,
} from "./types";

const SCORE_MIN = 0;
const SCORE_MAX = 100;

/** Return a score only when the evaluator supplied a real finite value. */
export function normalizeBenchmarkScore(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(value * 10) / 10));
}

/**
 * Intent fidelity is criterion-level by design. Partial credit is explicit in the
 * criterion status; an absent criterion is not silently treated as a pass.
 */
export function calculateIntentScore(criteria: readonly BenchmarkAcceptanceResult[]): number | undefined {
  if (criteria.length === 0) return undefined;
  const points = criteria.reduce((total, criterion) => total + criterionPoints(criterion.status), 0);
  return roundScore((points / criteria.length) * 100);
}

export function calculateResolvedRate(tasks: readonly Pick<BenchmarkTaskResult, "status">[]): number | undefined {
  if (tasks.length === 0) return undefined;
  const resolved = tasks.filter((task) => task.status === "passed").length;
  return roundScore((resolved / tasks.length) * 100);
}

/**
 * Compute an overall score only from an explicit, versioned policy. There is no
 * implicit weighting: missing policy or missing weighted dimensions yields N/A.
 * A configured correctness floor is a gate, so efficiency cannot compensate for
 * a failed correctness requirement.
 */
export function calculateOverallScore(
  scores: BenchmarkScoreMap,
  policy: BenchmarkScorePolicy | undefined,
): number | undefined {
  if (!policy) return undefined;

  const weightedDimensions = Object.entries(policy.weights).filter(
    (entry): entry is [keyof BenchmarkScoreMap, number] => typeof entry[1] === "number" && entry[1] > 0,
  );
  if (weightedDimensions.length === 0) return undefined;

  const totalWeight = weightedDimensions.reduce((sum, [, weight]) => sum + weight, 0);
  if (!Number.isFinite(totalWeight) || Math.abs(totalWeight - 1) > 0.001) return undefined;

  const requiredDimensions = policy.requiredDimensions ?? weightedDimensions.map(([dimension]) => dimension);
  if (requiredDimensions.some((dimension) => normalizeBenchmarkScore(scores[dimension]) === undefined))
    return undefined;

  if (policy.correctnessFloor !== undefined) {
    const coding = normalizeBenchmarkScore(scores.coding);
    if (coding === undefined || coding < policy.correctnessFloor) return 0;
  }

  const weighted = weightedDimensions.reduce((sum, [dimension, weight]) => {
    const score = normalizeBenchmarkScore(scores[dimension]);
    return sum + (score ?? 0) * weight;
  }, 0);
  return roundScore(weighted);
}

export function criterionPoints(status: BenchmarkCriterionStatus): number {
  switch (status) {
    case "passed":
      return 1;
    case "partial":
      return 0.5;
    case "failed":
    case "not_run":
      return 0;
  }
}

export function averageTaskScore(task: Pick<BenchmarkTaskResult, "scores" | "status">): number | undefined {
  const values = Object.entries(task.scores)
    .filter(([dimension]) => dimension !== "overall")
    .map(([, value]) => normalizeBenchmarkScore(value))
    .filter((value): value is number => value !== undefined);
  if (values.length > 0) return roundScore(values.reduce((sum, value) => sum + value, 0) / values.length);
  if (task.status === "passed") return 100;
  if (task.status === "failed") return 0;
  return undefined;
}

export function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}
