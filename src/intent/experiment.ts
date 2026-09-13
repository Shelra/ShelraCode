import type { IntelligenceProvider } from "../intelligence/types";
import {
  dedupeItems,
  measureDivergenceOnDecisions,
  runAsk,
  runAskRepeated,
  runDirect,
  runDivergence,
  runProbe,
} from "./arms";
import { matchArm } from "./scoring";
import type { ArmResult, CaseOutcome, CorpusCase, ExperimentReport } from "./types";

/**
 * The experiment runner.
 *
 * One case at a time, every arm on the same request, then the silent-consensus measurement, then
 * scoring. Raw per-case output is handed back whole rather than summarised in place, so the
 * numbers in the report can always be recomputed from what was actually said.
 */

export interface ExperimentOptions {
  samples: number;
  repeats: number;
  seed: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export async function runCase(
  provider: IntelligenceProvider,
  corpusCase: CorpusCase,
  options: ExperimentOptions,
): Promise<{ outcome: CaseOutcome; costUsd: number; costAvailable: boolean }> {
  const { samples, repeats, seed, signal, onProgress } = options;
  let costUsd = 0;
  let costAvailable = true;

  onProgress?.(`${corpusCase.id}: running arms`);
  const [direct, askOnce, askMany, divergence, probe] = await Promise.all([
    runDirect(provider, corpusCase, signal),
    runAsk(provider, corpusCase, signal),
    runAskRepeated(provider, corpusCase, repeats, signal),
    runDivergence(provider, corpusCase, samples, signal),
    runProbe(provider, corpusCase, signal),
  ]);

  const raw: ArmResult[] = [direct, askOnce, askMany, divergence, probe];
  for (const result of raw) {
    costUsd += result.costUsd;
    if (!result.costAvailable) costAvailable = false;
  }

  // The same collapsing step for every arm, so that raising the same question ten times counts once.
  onProgress?.(`${corpusCase.id}: deduplicating`);
  const deduped: ArmResult[] = [];
  for (const result of raw) {
    const outcome = await dedupeItems(provider, result, signal);
    costUsd += outcome.costUsd;
    if (!outcome.costAvailable) costAvailable = false;
    deduped.push(outcome.result);
  }

  onProgress?.(`${corpusCase.id}: measuring silent consensus`);
  const divergenceMeasure = await measureDivergenceOnDecisions(provider, corpusCase, samples, signal);
  costUsd += divergenceMeasure.costUsd;
  if (!divergenceMeasure.costAvailable) costAvailable = false;

  onProgress?.(`${corpusCase.id}: scoring`);
  const matches = [];
  for (const result of deduped) {
    const scored = await matchArm(provider, corpusCase, result, seed, signal);
    costUsd += scored.costUsd;
    if (!scored.costAvailable) costAvailable = false;
    matches.push(scored.match);
  }

  return {
    outcome: {
      caseId: corpusCase.id,
      domain: corpusCase.domain,
      decisions: corpusCase.decisions,
      divergence: divergenceMeasure.records,
      arms: deduped,
      matches,
    },
    costUsd,
    costAvailable,
  };
}

export async function runExperiment(
  provider: IntelligenceProvider,
  cases: CorpusCase[],
  options: ExperimentOptions,
  armModel = "sonnet",
  judgeModel = "opus",
): Promise<ExperimentReport> {
  const startedAt = new Date().toISOString();
  const outcomes: CaseOutcome[] = [];
  let totalCostUsd = 0;
  let costAvailable = true;

  for (const corpusCase of cases) {
    const result = await runCase(provider, corpusCase, options);
    outcomes.push(result.outcome);
    totalCostUsd += result.costUsd;
    if (!result.costAvailable) costAvailable = false;
    options.onProgress?.(`${corpusCase.id}: done, running total $${totalCostUsd.toFixed(3)}`);
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    armModel,
    judgeModel,
    samples: options.samples,
    cases: outcomes,
    totalCostUsd,
    costAvailable,
  };
}
