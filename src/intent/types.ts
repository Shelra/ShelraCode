/**
 * Intent-gap measurement types.
 *
 * This module is not part of the coding agent. It is an instrument: it measures how much
 * of the distance between a human request and a working system is decided by the machine
 * without anyone noticing.
 *
 * The central object is a Decision — a question the request does not answer, whose
 * different answers produce different observable behaviour. Decisions are the unit of the
 * intent gap. Code is downstream of them.
 */

/** Domain families in the corpus. Chosen because each has state, and state forces decisions. */
export type Domain = "booking" | "billing" | "commerce" | "approval" | "access" | "inventory";

/**
 * One decision a competent implementer must make that the request leaves open.
 *
 * `options` are the concrete readings. They exist to keep the decision honest: if a
 * candidate "decision" cannot be answered at least two ways with different observable
 * consequences, it is not a decision, it is a detail.
 */
export interface Decision {
  id: string;
  /** The question, phrased as the user would have to answer it. */
  question: string;
  /** At least two readings, each with a distinct observable consequence. */
  options: string[];
  /**
   * A concrete scenario that distinguishes the options. This is what makes a decision
   * behavioural rather than verbal: two readings differ only if they answer this differently.
   */
  discriminator: string;
  /** Structural category. Recorded for analysis only — never shown to any arm. */
  category: ProbeCategory;
  /** Why answering this differently changes what the software does. */
  consequence: string;
}

/**
 * Model-independent categories of decision that stateful software must resolve.
 *
 * This catalogue is derived from the shape of stateful systems, not from any model's
 * opinion about a particular request. That independence is the point: it is what allows
 * a decision to be surfaced even when every sample of a model confidently agrees.
 */
export type ProbeCategory =
  | "concurrency" // two actors touch the same state at once
  | "partial_failure" // a multi-step effect succeeds halfway
  | "lifecycle" // an entity is deleted or deactivated while referenced
  | "temporal" // boundaries, deadlines, timezones, "when exactly"
  | "authority" // who may do this, and to whose data
  | "money" // rounding, proration, refunds, currency
  | "boundary" // empty, first, last, maximum, zero
  | "idempotency" // the same request arrives twice
  | "visibility" // who observes the effect, and when
  | "reversal"; // undo, cancel, retract after the fact

export const PROBE_CATEGORIES: ProbeCategory[] = [
  "concurrency",
  "partial_failure",
  "lifecycle",
  "temporal",
  "authority",
  "money",
  "boundary",
  "idempotency",
  "visibility",
  "reversal",
];

/**
 * A corpus case built by specification reduction.
 *
 * The full specification comes first; the request is produced by eliding parts of it. The
 * ground-truth decision set is therefore not a judgement call about what "should" have been
 * asked — it is literally the set of statements present in the specification and absent from
 * the request. Nothing about how the decisions are detected influences what they are.
 */
export interface CorpusCase {
  id: string;
  domain: Domain;
  /** What a real user would type. This is all any arm ever sees. */
  request: string;
  /** The withheld specification. Never shown to an arm; used only to build ground truth. */
  fullSpec: string;
  /** Decisions stated in fullSpec and left open by request. */
  decisions: Decision[];
}

/** The four detection strategies under test. */
export type ArmId = "direct" | "ask" | "ask10" | "divergence" | "probe";

/** One thing an arm surfaced: a question it would ask, or an assumption it flagged as uncertain. */
export interface SurfacedItem {
  /** Free text as the arm produced it. Scoring is semantic, not string matching. */
  text: string;
  /** Present when the arm committed to a reading rather than asking. */
  assumedAnswer?: string;
  /** Arm-specific provenance, e.g. which probe or which samples disagreed. */
  origin?: string;
}

export interface ArmResult {
  arm: ArmId;
  caseId: string;
  items: SurfacedItem[];
  /** Wall-clock and spend, so human-attention cost can be compared against machine cost. */
  costUsd: number;
  costAvailable: boolean;
  calls: number;
  durationMs: number;
  error?: string;
}

/**
 * Per-decision divergence evidence from the sampling arm.
 *
 * This is the measurement the whole study turns on. If K independent interpretations all
 * answer a decision's discriminator identically, no sampling-based method can flag it —
 * regardless of how the sampling is implemented or how good the model is.
 */
export interface DivergenceRecord {
  decisionId: string;
  /** One answer per sample, normalised to a chosen option index or "other". */
  answers: string[];
  /** True when every sample answered identically. */
  unanimous: boolean;
  /** Distinct answers observed, for reporting. */
  distinct: number;
}

/** Result of matching one arm's surfaced items against a case's ground-truth decisions. */
export interface MatchResult {
  caseId: string;
  arm: ArmId;
  /** Ground-truth decision ids the arm surfaced. */
  matched: string[];
  /** Items that matched no ground-truth decision. */
  unmatchedItems: number;
  totalItems: number;
  totalDecisions: number;
}

export interface CaseOutcome {
  caseId: string;
  domain: Domain;
  decisions: Decision[];
  divergence: DivergenceRecord[];
  arms: ArmResult[];
  matches: MatchResult[];
}

export interface ExperimentReport {
  startedAt: string;
  finishedAt: string;
  armModel: string;
  judgeModel: string;
  samples: number;
  cases: CaseOutcome[];
  totalCostUsd: number;
  costAvailable: boolean;
}
