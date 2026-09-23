import {
  type AcceptanceContext,
  type AcceptanceJudge,
  type AcceptanceDeps as CheckDeps,
  evaluateAcceptance as evaluateChecks,
  failingRequired,
  failureFingerprint,
  VIEWPORTS,
} from "../contract/evaluate";
import type { AcceptanceCriterion, VerificationReport } from "../contract/types";
import type { IntelligenceProvider } from "../intelligence/types";
import { JUDGE_SCHEMA, SYSTEM_JUDGE } from "./prompts";

/**
 * The autonomy runtime's view of the shared verification engine (src/contract/evaluate.ts): the same
 * checks, with `judge` criteria answered by this runtime's intelligence provider.
 */

export type { AcceptanceContext } from "../contract/evaluate";
export { failingRequired, failureFingerprint, VIEWPORTS };

export interface AcceptanceDeps extends Omit<CheckDeps, "judge"> {
  intelligence?: IntelligenceProvider;
}

export function evaluateAcceptance(
  criteria: AcceptanceCriterion[],
  context: AcceptanceContext,
  deps: AcceptanceDeps,
): Promise<VerificationReport> {
  const { intelligence, ...checkDeps } = deps;
  return evaluateChecks(criteria, context, {
    ...checkDeps,
    ...(intelligence ? { judge: judgeWith(intelligence) } : {}),
  });
}

function judgeWith(intelligence: IntelligenceProvider): AcceptanceJudge {
  return async ({ question, evidence, signal }) => {
    const response = await intelligence.complete<{ passed: boolean; reason: string }>({
      role: "judge",
      system: SYSTEM_JUDGE,
      prompt:
        `CRITERION: ${question}\n\n` +
        `EVIDENCE COLLECTED FROM THE RUNNING SOFTWARE:\n${evidence}\n\n` +
        "Does the evidence satisfy the criterion?",
      schema: JUDGE_SCHEMA,
      tier: "fast",
      signal,
    });
    return response.ok && response.data
      ? { passed: response.data.passed, reason: response.data.reason }
      : { error: response.error ?? "no answer" };
  };
}
