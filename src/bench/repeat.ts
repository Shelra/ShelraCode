/**
 * Summaries for `shelra bench --repeat k` (audit doc 15, §15.3 rule 6): one free-model run is one
 * sample, so a cell is reported as pass@1 with a confidence interval, pass^k (every repeat passed),
 * and the false-completion count, never as a single score.
 */

export interface RepeatTaskOutcome {
  taskId: string;
  passed: boolean;
  /** The agent ended its turn as done while the oracle failed (BenchmarkBehavior.falseCompletion). */
  falseCompletion: boolean;
}

export interface RepeatSummary {
  repeats: number;
  /** Task attempts across all repeats. */
  trials: number;
  passes: number;
  /** passes / trials: the chance one attempt at one task passes. */
  passAt1: number;
  /** 95% Wilson score interval for passAt1. */
  interval: { low: number; high: number };
  /** Tasks that passed in every repeat, out of the tasks attempted in every repeat. */
  passAllK: { tasks: number; of: number };
  falseCompletions: number;
  perTask: Array<{ taskId: string; passes: number; attempts: number; falseCompletions: number }>;
}

/**
 * The Wilson score interval for a binomial proportion: unlike the normal approximation it stays
 * inside [0, 1] and behaves at 0 or n successes, which small free-model samples hit often.
 */
export function wilsonInterval(successes: number, trials: number, z = 1.96): { low: number; high: number } {
  if (trials <= 0) return { low: 0, high: 1 };
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/** Summarizes k runs of one suite, each given as the outcomes of its tasks. */
export function summarizeRepeats(runs: readonly (readonly RepeatTaskOutcome[])[]): RepeatSummary {
  const byTask = new Map<string, { passes: number; attempts: number; falseCompletions: number }>();
  for (const run of runs) {
    for (const outcome of run) {
      const entry = byTask.get(outcome.taskId) ?? { passes: 0, attempts: 0, falseCompletions: 0 };
      entry.attempts += 1;
      if (outcome.passed) entry.passes += 1;
      if (outcome.falseCompletion) entry.falseCompletions += 1;
      byTask.set(outcome.taskId, entry);
    }
  }
  const perTask = [...byTask.entries()].map(([taskId, entry]) => ({ taskId, ...entry }));
  const trials = perTask.reduce((sum, task) => sum + task.attempts, 0);
  const passes = perTask.reduce((sum, task) => sum + task.passes, 0);
  const everyRepeat = perTask.filter((task) => task.attempts === runs.length);
  return {
    repeats: runs.length,
    trials,
    passes,
    passAt1: trials > 0 ? passes / trials : 0,
    interval: wilsonInterval(passes, trials),
    passAllK: { tasks: everyRepeat.filter((task) => task.passes === task.attempts).length, of: everyRepeat.length },
    falseCompletions: perTask.reduce((sum, task) => sum + task.falseCompletions, 0),
    perTask,
  };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Plain-text lines for the terminal. */
export function formatRepeatSummary(summary: RepeatSummary): string[] {
  const width = Math.max(4, ...summary.perTask.map((task) => task.taskId.length));
  return [
    `Repeated ${summary.repeats} times:`,
    ...summary.perTask.map(
      (task) =>
        `  ${task.taskId.padEnd(width)}  ${task.passes}/${task.attempts} passed${
          task.falseCompletions > 0 ? ` · ${task.falseCompletions} false completion(s)` : ""
        }`,
    ),
    `  pass@1 ${percent(summary.passAt1)} (95% CI ${percent(summary.interval.low)}–${percent(summary.interval.high)}, ${
      summary.trials
    } attempts) · pass^${summary.repeats} ${summary.passAllK.tasks}/${summary.passAllK.of} tasks · false completions ${
      summary.falseCompletions
    }/${summary.trials}`,
  ];
}
