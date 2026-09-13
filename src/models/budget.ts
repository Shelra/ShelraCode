import type { ModelInfo } from "../types/index";

/** One millionth of a US dollar. Integer arithmetic avoids rounding surprises at the policy boundary. */
export const USD_MICROS = 1_000_000;

export interface BudgetLimits {
  /** Conservative upper bound for one provider request. `0` means free-only for that request. */
  maxRequestUsd?: number;
  /** Cumulative limit for one logical delegated task. */
  maxTaskUsd?: number;
  /** Cumulative limit for the current persisted session. */
  maxSessionUsd?: number;
  /** Cumulative limit for the current UTC day. */
  maxDayUsd?: number;
}

export interface BudgetUsage {
  requestMicros: number;
  taskMicros: number;
  sessionMicros: number;
  dayMicros: number;
}

export type BudgetScope = "request" | "task" | "session" | "day";

export interface BudgetCheck {
  allowed: boolean;
  estimatedMicros: number;
  limitMicros?: number;
  usedMicros: number;
  scope: BudgetScope;
  reason?: string;
}

/**
 * Estimates the largest plausible cost for a call before it is sent.
 * OpenRouter prices are USD/token; the model adapter may still report the final
 * provider-side amount after completion, which is recorded separately.
 */
export function estimateModelCostMicros(
  model: ModelInfo | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  if (!model) return 0;
  if (model.category === "cloud" && model.pricingKnown === false) return Number.POSITIVE_INFINITY;
  const input = Math.max(0, Number.isFinite(inputTokens) ? inputTokens : 0);
  const output = Math.max(0, Number.isFinite(outputTokens) ? outputTokens : 0);
  const inputPrice = Math.max(0, Number.isFinite(model.inputPrice) ? model.inputPrice : 0);
  const outputPrice = Math.max(0, Number.isFinite(model.outputPrice) ? model.outputPrice : 0);
  return Math.max(0, Math.ceil((input * inputPrice + output * outputPrice) * USD_MICROS));
}

/**
 * Returns a conservative output bound when the caller did not set one. This
 * keeps a request budget meaningful even for providers that omit a max-output
 * capability while avoiding an unbounded estimate.
 */
export function conservativeOutputLimit(model: ModelInfo | undefined, requested?: number): number {
  if (requested !== undefined && Number.isFinite(requested)) return Math.max(0, Math.floor(requested));
  if (!model) return 0;
  return Math.max(0, Math.min(model.maxOutputTokens ?? 8_192, model.contextWindow));
}

export function estimateRequestCostMicros(
  model: ModelInfo | undefined,
  inputTokens: number,
  requestedOutputTokens?: number,
): number {
  return estimateModelCostMicros(model, inputTokens, conservativeOutputLimit(model, requestedOutputTokens));
}

export function budgetLimitMicros(limits: BudgetLimits, scope: BudgetScope): number | undefined {
  const dollars =
    scope === "request"
      ? limits.maxRequestUsd
      : scope === "task"
        ? limits.maxTaskUsd
        : scope === "session"
          ? limits.maxSessionUsd
          : limits.maxDayUsd;
  if (dollars === undefined || !Number.isFinite(dollars)) return undefined;
  return Math.max(0, Math.floor(dollars * USD_MICROS));
}

export function checkBudget(
  limits: BudgetLimits,
  usage: BudgetUsage,
  scope: BudgetScope,
  estimatedMicros: number,
): BudgetCheck {
  const estimate = Math.max(0, Math.ceil(estimatedMicros));
  const usedMicros =
    scope === "request"
      ? usage.requestMicros
      : scope === "task"
        ? usage.taskMicros
        : scope === "session"
          ? usage.sessionMicros
          : usage.dayMicros;
  const limitMicros = budgetLimitMicros(limits, scope);
  if (limitMicros === undefined) {
    return { allowed: true, estimatedMicros: estimate, usedMicros, scope };
  }
  const allowed = usedMicros + estimate <= limitMicros;
  return {
    allowed,
    estimatedMicros: estimate,
    limitMicros,
    usedMicros,
    scope,
    ...(allowed
      ? {}
      : {
          reason: `The ${scope} budget would be exceeded: ${formatUsdMicros(usedMicros + estimate)} estimated of ${formatUsdMicros(limitMicros)} allowed.`,
        }),
  };
}

export function formatUsdMicros(micros: number): string {
  if (!Number.isFinite(micros)) return "an unknown amount";
  return `$${(Math.max(0, micros) / USD_MICROS).toFixed(6)}`;
}

export function parseBudgetUsd(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid budget "${String(value)}". Expected a non-negative USD amount.`);
  }
  return parsed;
}
