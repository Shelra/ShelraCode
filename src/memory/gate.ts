import { MEMORY_SOURCE_WEIGHT, type MemoryRecord, type MemorySource, type MemoryWriteInput } from "./types";

/**
 * The write gate: every automatic memory write passes through this deterministic filter before it
 * can land in the store. It exists because the most-replicated 2026 finding on agent memory is that
 * memory systems fail at the write decision, not at retrieval (research/lanes/11 §6), and because
 * fetched web content becoming permanent memory is the sharpest security gap lane 14 found. One
 * mechanism, two jobs: quality (no duplicates, no noise, no unsupported overwrites) and safety (no
 * secrets, no instruction-shaped text, no inference silently replacing a human statement).
 *
 * Decisions are pure functions of the candidate and the current records, so they are testable and
 * explainable; nothing here calls a model.
 */

export type GateAction = "create" | "update" | "skip" | "reject";

export interface GateDecision {
  action: GateAction;
  /** The slug the write should target (may differ from the candidate's when merged into a near-duplicate). */
  slug: string;
  reason: string;
  /** When updating a near-duplicate, the record being replaced. */
  existing?: MemoryRecord;
}

export interface GateOptions {
  /** Maximum entries of one type before new entries of that type are skipped (oldest are not evicted here). */
  perTypeCap?: number;
  /** Token-set similarity above which two entries are treated as the same fact. */
  duplicateThreshold?: number;
}

const DEFAULT_PER_TYPE_CAP = 40;
const DEFAULT_DUPLICATE_THRESHOLD = 0.6;
const MIN_BODY_CHARS = 20;
const MAX_BODY_CHARS = 6_000;

/** Phrasing shaped like an attempt to steer the harness, not a project fact. Same family as the skill reviewer. */
const INJECTION_SHAPED_PATTERNS: RegExp[] = [
  /ignore (all |any )?(previous|prior|earlier) instructions/i,
  /disregard (all |any )?(previous|prior|earlier|your) (instructions|rules|guidelines)/i,
  /you must always (approve|allow|accept|run|execute)/i,
  /never ask (for|the user)/i,
  /do not (ask|confirm|verify) with the user/i,
  /bypass (all |any )?(safety|security|verification|checks?)/i,
  /pretend (you are|to be)/i,
  /\bsystem prompt\b.*\b(override|replace|ignore)\b/i,
];

/** Credential-shaped tokens that must never become permanent memory. */
const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|rk|pk)[-_](live|test|or|ant|proj)[-_][A-Za-z0-9_-]{12,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["']?[A-Za-z0-9_\-/+]{16,}/i,
];

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "it",
  "this",
  "that",
  "with",
  "as",
  "by",
  "be",
  "are",
  "was",
  "at",
  "from",
  "use",
  "uses",
  "used",
  "when",
  "which",
  "into",
  "not",
]);

/** Lower-cased identifier-preserving tokens with stopwords removed. Shared with retrieval. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/u)
    .map((token) => token.replace(/^[./-]+|[./-]+$/gu, ""))
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function fingerprint(input: { title: string; hook: string; body: string }): string[] {
  return tokenize(`${input.title} ${input.hook} ${input.body.slice(0, 1_500)}`);
}

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function looksInjectionShaped(text: string): boolean {
  return INJECTION_SHAPED_PATTERNS.some((pattern) => pattern.test(text));
}

function trustRank(source: MemorySource | undefined): number {
  return MEMORY_SOURCE_WEIGHT[source ?? "inference"];
}

/**
 * Decide what to do with one candidate write against the current records of the same scope.
 * Order of checks matters: safety rejections first, then exact-slug updates, then near-duplicate
 * merges, then caps.
 */
export function decideMemoryWrite(
  candidate: MemoryWriteInput,
  records: readonly MemoryRecord[],
  options: GateOptions = {},
): GateDecision {
  const perTypeCap = options.perTypeCap ?? DEFAULT_PER_TYPE_CAP;
  const duplicateThreshold = options.duplicateThreshold ?? DEFAULT_DUPLICATE_THRESHOLD;
  const body = candidate.body.trim();
  const full = `${candidate.title}\n${candidate.hook}\n${candidate.description}\n${body}`;

  if (body.length < MIN_BODY_CHARS)
    return { action: "reject", slug: candidate.slug, reason: "body too short to be a reusable fact" };
  if (body.length > MAX_BODY_CHARS)
    return { action: "reject", slug: candidate.slug, reason: "body too long for a memory entry; split or summarize" };
  if (containsSecret(full))
    return { action: "reject", slug: candidate.slug, reason: "contains a credential-shaped token" };
  if (looksInjectionShaped(full))
    return { action: "reject", slug: candidate.slug, reason: "instruction-shaped text is not a project fact" };
  if (
    candidate.source === "web" &&
    /\b(always|never|must)\b/i.test(body) &&
    !/\b(docs?|documentation|api|version)\b/i.test(body)
  ) {
    return {
      action: "reject",
      slug: candidate.slug,
      reason: "web-derived directives are not admitted as memory without a human confirmation",
    };
  }

  const candidateSource = candidate.source ?? "inference";
  const exact = records.find((record) => record.slug === candidate.slug);
  if (exact) {
    const existingSource = exact.entry.frontmatter.metadata.source;
    if (existingSource === "human" && candidateSource !== "human") {
      return {
        action: "skip",
        slug: exact.slug,
        reason: "a human-stated memory is only revised by the human",
        existing: exact,
      };
    }
    if (trustRank(candidateSource) < trustRank(existingSource) - 0.2) {
      return {
        action: "skip",
        slug: exact.slug,
        reason: `existing ${existingSource} entry outranks a ${candidateSource} rewrite`,
        existing: exact,
      };
    }
    const same =
      jaccard(
        fingerprint(candidate),
        fingerprint({ title: exact.index.title, hook: exact.index.hook, body: exact.entry.body }),
      ) > 0.92;
    if (same) return { action: "skip", slug: exact.slug, reason: "identical to the stored entry", existing: exact };
    return {
      action: "update",
      slug: exact.slug,
      reason: "revises the existing entry with the same slug",
      existing: exact,
    };
  }

  const candidateTokens = fingerprint(candidate);
  let best: { record: MemoryRecord; score: number } | null = null;
  for (const record of records) {
    const score = jaccard(
      candidateTokens,
      fingerprint({ title: record.index.title, hook: record.index.hook, body: record.entry.body }),
    );
    if (!best || score > best.score) best = { record, score };
  }
  if (best && best.score >= duplicateThreshold) {
    const existingMeta = best.record.entry.frontmatter.metadata;
    const existingSource = existingMeta.source;
    if (existingSource === "human" && candidateSource !== "human") {
      return {
        action: "skip",
        slug: best.record.slug,
        reason: "near-duplicate of a human-stated memory",
        existing: best.record,
      };
    }
    // A near-duplicate only replaces the stored entry when it is more trustworthy or more confident;
    // otherwise the newcomer is noise and the existing entry stands.
    const moreConfident = (candidate.confidence ?? 0.7) > (existingMeta.confidence ?? 0.7) + 0.1;
    const moreTrusted = trustRank(candidateSource) > trustRank(existingSource);
    if (
      !moreConfident &&
      !moreTrusted &&
      (best.score > 0.85 || trustRank(candidateSource) < trustRank(existingSource))
    ) {
      return {
        action: "skip",
        slug: best.record.slug,
        reason: `near-duplicate of "${best.record.slug}" (${best.score.toFixed(2)})`,
        existing: best.record,
      };
    }
    return {
      action: "update",
      slug: best.record.slug,
      reason: `merges into near-duplicate "${best.record.slug}" (${best.score.toFixed(2)})`,
      existing: best.record,
    };
  }

  const sameType = records.filter((record) => record.entry.frontmatter.metadata.type === candidate.type).length;
  if (sameType >= perTypeCap) {
    return {
      action: "skip",
      slug: candidate.slug,
      reason: `type "${candidate.type}" already holds ${sameType} entries; consolidate before adding`,
    };
  }
  return { action: "create", slug: candidate.slug, reason: "novel" };
}
