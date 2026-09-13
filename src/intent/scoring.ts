import type { IntelligenceProvider } from "../intelligence/types";
import type { ArmId, ArmResult, CaseOutcome, CorpusCase, ExperimentReport, MatchResult } from "./types";

/**
 * Scoring.
 *
 * An arm surfaces free text; the ground truth is a fixed list of decisions. Deciding whether
 * "what if two people book at once?" covers decision bk-1 is a semantic judgement, so it is made
 * by a model — but by one that is never told which arm produced the text, and which sees the
 * items in a shuffled order. Matching is many-to-one: several items may cover one decision, and
 * an item covers a decision only if answering it would settle that decision.
 */

const MATCH_SCHEMA = {
  type: "object",
  properties: {
    covered: {
      type: "array",
      items: {
        type: "object",
        properties: {
          decision_id: { type: "string" },
          item_number: { type: "integer" },
        },
        required: ["decision_id", "item_number"],
        additionalProperties: false,
      },
    },
  },
  required: ["covered"],
  additionalProperties: false,
} as const;

/** Deterministic shuffle, so a run is reproducible from its seed while the judge still sees no arm order. */
function shuffle<T>(input: T[], seed: number): T[] {
  const output = [...input];
  let state = seed || 1;
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const swap = state % (index + 1);
    const a = output[index];
    const b = output[swap];
    if (a !== undefined && b !== undefined) {
      output[index] = b;
      output[swap] = a;
    }
  }
  return output;
}

export async function matchArm(
  provider: IntelligenceProvider,
  corpusCase: CorpusCase,
  result: ArmResult,
  seed: number,
  signal?: AbortSignal,
): Promise<{ match: MatchResult; costUsd: number; costAvailable: boolean }> {
  const empty: MatchResult = {
    caseId: corpusCase.id,
    arm: result.arm,
    matched: [],
    unmatchedItems: 0,
    totalItems: result.items.length,
    totalDecisions: corpusCase.decisions.length,
  };
  if (result.items.length === 0) return { match: empty, costUsd: 0, costAvailable: true };

  const ordered = shuffle(
    result.items.map((item, index) => ({ item, original: index })),
    seed,
  );

  const response = await provider.complete<{ covered: { decision_id: string; item_number: number }[] }>({
    role: "judge",
    system: "You decide whether raised questions cover known decisions. You answer in JSON.",
    prompt: [
      "A system was described by this request:",
      `REQUEST: ${corpusCase.request}`,
      "",
      "These are decisions the request leaves open. Each has a situation that distinguishes the",
      "possible answers.",
      "",
      corpusCase.decisions
        .map(
          (decision) =>
            `[${decision.id}] ${decision.question}\n    distinguishing situation: ${decision.discriminator}`,
        )
        .join("\n"),
      "",
      "Somebody reviewing the request raised the following points.",
      "",
      ordered.map((entry, index) => `(${index + 1}) ${entry.item.text}`).join("\n"),
      "",
      "For each decision that is covered by at least one raised point, report the decision id and the",
      "number of the point that covers it. A point covers a decision only if answering that point",
      "would settle that decision — the same underlying question, however differently worded. A point",
      "that merely mentions the same topic without raising the decision does not count. Report nothing",
      "for decisions that no point covers.",
    ].join("\n"),
    schema: MATCH_SCHEMA as unknown as Record<string, unknown>,
    tier: "deep",
    ...(signal ? { signal } : {}),
  });

  const costUsd = response.usage.costAvailable ? (response.usage.costUsd ?? 0) : 0;
  const validIds = new Set(corpusCase.decisions.map((decision) => decision.id));
  const matched = [...new Set((response.data?.covered ?? []).map((entry) => entry.decision_id))].filter((id) =>
    validIds.has(id),
  );
  const usedItems = new Set(
    (response.data?.covered ?? [])
      .map((entry) => entry.item_number)
      .filter((number) => number >= 1 && number <= ordered.length),
  );

  return {
    match: {
      caseId: corpusCase.id,
      arm: result.arm,
      matched,
      unmatchedItems: result.items.length - usedItems.size,
      totalItems: result.items.length,
      totalDecisions: corpusCase.decisions.length,
    },
    costUsd,
    costAvailable: response.usage.costAvailable,
  };
}

export interface ArmSummary {
  arm: ArmId;
  decisionsFound: number;
  decisionsTotal: number;
  recall: number;
  itemsRaised: number;
  itemsUnmatched: number;
  /** Share of raised points that mapped onto a ground-truth decision. */
  precision: number;
  costUsd: number;
  calls: number;
  costPerDecisionUsd: number;
}

export interface SilentConsensusSummary {
  /** Ground-truth decisions on which every independent interpretation agreed. */
  unanimous: number;
  total: number;
  rate: number;
  /** Recall over the unanimous subset only, per arm. */
  recallOnUnanimous: Record<ArmId, { found: number; total: number; recall: number }>;
  /** Recall over the subset where interpretations diverged, per arm. */
  recallOnDivergent: Record<ArmId, { found: number; total: number; recall: number }>;
}

const ARMS: ArmId[] = ["direct", "ask", "ask10", "divergence", "probe"];

export function summariseArms(cases: CaseOutcome[]): ArmSummary[] {
  return ARMS.map((arm) => {
    let decisionsFound = 0;
    let decisionsTotal = 0;
    let itemsRaised = 0;
    let itemsUnmatched = 0;
    let costUsd = 0;
    let calls = 0;

    for (const outcome of cases) {
      const match = outcome.matches.find((entry) => entry.arm === arm);
      const result = outcome.arms.find((entry) => entry.arm === arm);
      if (match) {
        decisionsFound += match.matched.length;
        decisionsTotal += match.totalDecisions;
        itemsRaised += match.totalItems;
        itemsUnmatched += match.unmatchedItems;
      }
      if (result) {
        costUsd += result.costUsd;
        calls += result.calls;
      }
    }

    return {
      arm,
      decisionsFound,
      decisionsTotal,
      recall: decisionsTotal === 0 ? 0 : decisionsFound / decisionsTotal,
      itemsRaised,
      itemsUnmatched,
      precision: itemsRaised === 0 ? 0 : (itemsRaised - itemsUnmatched) / itemsRaised,
      costUsd,
      calls,
      costPerDecisionUsd: decisionsFound === 0 ? Number.POSITIVE_INFINITY : costUsd / decisionsFound,
    };
  });
}

/**
 * The headline measurement.
 *
 * Splits the ground truth by whether independent interpretations of the request agreed, then asks
 * how much of each half every arm recovered. The unanimous half is the part no sampling-based
 * method can reach; whether anything reaches it is the question the study exists to answer.
 */
export function summariseSilentConsensus(cases: CaseOutcome[]): SilentConsensusSummary {
  const unanimousIds = new Set<string>();
  const divergentIds = new Set<string>();

  for (const outcome of cases) {
    for (const record of outcome.divergence) {
      if (record.unanimous) unanimousIds.add(`${outcome.caseId}:${record.decisionId}`);
      else divergentIds.add(`${outcome.caseId}:${record.decisionId}`);
    }
  }

  const blank = () =>
    Object.fromEntries(ARMS.map((arm) => [arm, { found: 0, total: 0, recall: 0 }])) as Record<
      ArmId,
      { found: number; total: number; recall: number }
    >;

  const onUnanimous = blank();
  const onDivergent = blank();

  for (const arm of ARMS) {
    let foundU = 0;
    let foundD = 0;
    for (const outcome of cases) {
      const match = outcome.matches.find((entry) => entry.arm === arm);
      if (!match) continue;
      for (const id of match.matched) {
        const key = `${outcome.caseId}:${id}`;
        if (unanimousIds.has(key)) foundU += 1;
        else if (divergentIds.has(key)) foundD += 1;
      }
    }
    onUnanimous[arm] = {
      found: foundU,
      total: unanimousIds.size,
      recall: unanimousIds.size === 0 ? 0 : foundU / unanimousIds.size,
    };
    onDivergent[arm] = {
      found: foundD,
      total: divergentIds.size,
      recall: divergentIds.size === 0 ? 0 : foundD / divergentIds.size,
    };
  }

  const total = unanimousIds.size + divergentIds.size;
  return {
    unanimous: unanimousIds.size,
    total,
    rate: total === 0 ? 0 : unanimousIds.size / total,
    recallOnUnanimous: onUnanimous,
    recallOnDivergent: onDivergent,
  };
}

/** Per-category recall, used to see whether any arm is systematically blind to a class of decision. */
export function summariseByCategory(cases: CaseOutcome[]): Record<string, Record<ArmId, number>> {
  const totals = new Map<string, number>();
  const found = new Map<string, Map<ArmId, number>>();

  for (const outcome of cases) {
    for (const decision of outcome.decisions) {
      totals.set(decision.category, (totals.get(decision.category) ?? 0) + 1);
      if (!found.has(decision.category)) found.set(decision.category, new Map());
    }
    for (const match of outcome.matches) {
      for (const id of match.matched) {
        const decision = outcome.decisions.find((entry) => entry.id === id);
        if (!decision) continue;
        const bucket = found.get(decision.category);
        if (!bucket) continue;
        bucket.set(match.arm, (bucket.get(match.arm) ?? 0) + 1);
      }
    }
  }

  const output: Record<string, Record<ArmId, number>> = {};
  for (const [category, total] of totals) {
    const bucket = found.get(category) ?? new Map<ArmId, number>();
    output[category] = Object.fromEntries(
      ARMS.map((arm) => [arm, total === 0 ? 0 : (bucket.get(arm) ?? 0) / total]),
    ) as Record<ArmId, number>;
  }
  return output;
}

export function renderReport(report: ExperimentReport): string {
  const arms = summariseArms(report.cases);
  const silent = summariseSilentConsensus(report.cases);
  const byCategory = summariseByCategory(report.cases);
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines: string[] = [];

  lines.push("INTENT GAP MEASUREMENT");
  lines.push(`cases ${report.cases.length}  decisions ${arms[0]?.decisionsTotal ?? 0}  samples ${report.samples}`);
  lines.push(`arms on ${report.armModel}, judged by ${report.judgeModel}`);
  lines.push("");
  lines.push("RECALL OF GROUND-TRUTH DECISIONS");
  lines.push("arm         found/total   recall   raised  precision   cost     per decision");
  for (const summary of arms) {
    lines.push(
      [
        summary.arm.padEnd(11),
        `${String(summary.decisionsFound).padStart(3)}/${String(summary.decisionsTotal).padEnd(6)}`,
        pct(summary.recall).padStart(7),
        String(summary.itemsRaised).padStart(7),
        pct(summary.precision).padStart(10),
        `$${summary.costUsd.toFixed(3)}`.padStart(9),
        Number.isFinite(summary.costPerDecisionUsd)
          ? `$${summary.costPerDecisionUsd.toFixed(4)}`.padStart(13)
          : "n/a".padStart(13),
      ].join(" "),
    );
  }

  lines.push("");
  lines.push("SILENT CONSENSUS");
  lines.push(
    `${silent.unanimous}/${silent.total} decisions (${pct(silent.rate)}) drew the same behaviour from every independent interpretation.`,
  );
  lines.push("No sampling-based detector can reach these, however it is implemented.");
  lines.push("");
  lines.push("arm          recall on silent   recall on divergent");
  for (const arm of arms) {
    const u = silent.recallOnUnanimous[arm.arm];
    const d = silent.recallOnDivergent[arm.arm];
    lines.push(
      [
        arm.arm.padEnd(12),
        `${pct(u.recall)} (${u.found}/${u.total})`.padStart(18),
        `${pct(d.recall)} (${d.found}/${d.total})`.padStart(22),
      ].join(" "),
    );
  }

  lines.push("");
  lines.push("RECALL BY DECISION CATEGORY");
  lines.push("category           direct     ask   ask10   diverg    probe");
  for (const [category, values] of Object.entries(byCategory).sort()) {
    lines.push(
      [
        category.padEnd(18),
        pct(values.direct).padStart(6),
        pct(values.ask).padStart(7),
        pct(values.divergence).padStart(8),
        pct(values.probe).padStart(8),
      ].join(" "),
    );
  }

  lines.push("");
  lines.push(
    report.costAvailable
      ? `total spend $${report.totalCostUsd.toFixed(3)}`
      : `total spend $${report.totalCostUsd.toFixed(3)} (incomplete: some calls did not report cost)`,
  );
  return lines.join("\n");
}
