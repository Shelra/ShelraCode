import { homedir } from "node:os";
import { redact } from "../utils/session-trace";
import { searchTerms } from "./terms";
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
  /** Set when the candidate was skipped only because its type is full: making room would admit it. */
  full?: boolean;
  /** An entry this write makes no longer true: the user stated a new value for the same rule. */
  supersedes?: string;
}

export interface GateOptions {
  /** Maximum entries of one type before new entries of that type are skipped (oldest are not evicted here). */
  perTypeCap?: number;
  /** Token-set similarity above which two entries are treated as the same fact. */
  duplicateThreshold?: number;
}

const DEFAULT_PER_TYPE_CAP = 40;
const DEFAULT_DUPLICATE_THRESHOLD = 0.6;
/** Two statements of the user's are the same only above this similarity; below it they are two statements. */
const SAME_HUMAN_STATEMENT = 0.9;
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

/** A rule's own words, without the date and boilerplate its body carries. */
function statementTerms(input: { title: string; hook: string }): Set<string> {
  return new Set(searchTerms(`${input.title} ${input.hook}`));
}

function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** A number, a version or a size: what changes when a rule is restated with a new value ("Node 18" → "Node 20"). */
const VALUE = /^(?:v?\d[\d.x]*|\d+(?:ms|s|m|h|kb|mb|gb|px|%))$/u;
/** Words of which a rule holds one at a time: its sense, the language it asks for, tabs or spaces. */
const EXCLUSIVE: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["always", "never", "siempre", "nunca", "jamas"]),
  new Set(["spanish", "english", "espanol", "ingle", "castellano", "french", "frances", "portuguese", "portugue"]),
  new Set(["tab", "space", "espacio", "tabulacion", "tabulador"]),
];

function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
}

/**
 * How a new statement of the user's relates to the ones stored (doc 18 review, round 2): the same statement, reworded,
 * updates it; the same rule with a new value supersedes it; a different statement whose name collides with a stored
 * one gets a name of its own. Anything else is a new rule, kept beside the others.
 */
function relationToUserStatements(candidate: MemoryWriteInput, records: readonly MemoryRecord[]): GateDecision | null {
  const mine = statementTerms(candidate);
  let best: { record: MemoryRecord; score: number; theirs: Set<string> } | null = null;
  for (const record of records) {
    if (record.entry.frontmatter.metadata.source !== "human") continue;
    const theirs = statementTerms({ title: record.index.title, hook: record.index.hook });
    const score = overlap(mine, theirs);
    if (!best || score > best.score) best = { record, score, theirs };
  }
  if (best && best.score >= SAME_HUMAN_STATEMENT) {
    return {
      action: "update",
      slug: best.record.slug,
      reason: `restates the user's "${best.record.slug}"`,
      existing: best.record,
    };
  }
  if (best) {
    const theirs = best.theirs;
    const onlyMine = [...mine].filter((term) => !theirs.has(term));
    const onlyTheirs = [...theirs].filter((term) => !mine.has(term));
    const shared = mine.size - onlyMine.length;
    // The same rule with its sense or its setting turned around: "never deploy on Fridays" then "always deploy on
    // Fridays", "answer me in Spanish" then "in English" (doc 18 review, round 3). Two rules that differ in any other
    // word ("write tests first", "write docs first") are two rules, and both stand.
    const swapped =
      onlyMine.length === 1 &&
      onlyTheirs.length === 1 &&
      EXCLUSIVE.some((set) => set.has(onlyMine[0] ?? "") && set.has(onlyTheirs[0] ?? ""));
    const newValue =
      shared >= 2 &&
      onlyMine.length > 0 &&
      onlyTheirs.length > 0 &&
      ([...onlyMine, ...onlyTheirs].every((term) => VALUE.test(term)) || swapped);
    if (newValue) {
      const slug = records.some((record) => record.slug === candidate.slug)
        ? `${candidate.slug.slice(0, 57)}-${shortHash(candidate.hook)}`
        : candidate.slug;
      return {
        action: "create",
        slug,
        reason: `a new value for the user's "${best.record.slug}"`,
        supersedes: best.record.slug,
      };
    }
  }
  const collision = records.find((record) => record.slug === candidate.slug);
  // Only a name the capture made up can collide by accident; a person naming an entry of theirs revises it.
  const madeUpName = (candidate.tags ?? []).includes("user-directive");
  if (madeUpName && collision && collision.entry.frontmatter.metadata.source === "human") {
    return {
      action: "create",
      slug: `${candidate.slug.slice(0, 57)}-${shortHash(candidate.hook)}`,
      reason: `a different statement whose name collides with "${collision.slug}"`,
    };
  }
  return null;
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

/** Anything the redactor would blank is a secret the gate refuses to keep (doc 18 review, round 3). */
export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text)) || redactSecrets(redact(text)) !== text;
}

/**
 * What the gate would reject, blanked instead, for text memory keeps as a record rather than admits as knowledge
 * (episodes, deferred reflections): key shapes, `SECRET=value` lines of an env file, private key blocks, JWTs and the
 * password in a connection URL.
 */
const REDACTIONS: Array<[RegExp, string]> = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/gu,
    "***PRIVATE KEY***",
  ],
  [/(https:\/\/hooks\.slack\.com\/services\/)[A-Za-z0-9/_-]+/gu, "$1***"],
  [/(https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/)[A-Za-z0-9/_-]+/gu, "$1***"],
  [/\bnpm_[A-Za-z0-9]{20,}/gu, "***"],
  [/(:_authToken=)\S+/gu, "$1***"],
  [/\bwhsec_[A-Za-z0-9]{8,}/gu, "***"],
  [/\bglpat-[A-Za-z0-9_-]{16,}/gu, "***"],
  [/\bhf_[A-Za-z0-9]{20,}/gu, "***"],
  [/\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/gu, "***"],
  [/(\bAuthorization:\s*Basic\s+)\S+/giu, "$1***"],
  [
    /([?&](?:sig|signature|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|auth|token|access_token|api_key|apikey|key)=)[^&\s"']+/giu,
    "$1***",
  ],
  [/(\b(?:mysql|mariadb|mysqldump)\b[^\n]*?\s-p)(?!\s)\S+/gu, "$1***"],
  [/\b(sk|rk|pk)[-_](live|test|or|ant|proj)[-_][A-Za-z0-9_-]{12,}/gu, "***"],
  [/\bsk-[A-Za-z0-9_-]{16,}/gu, "***"],
  [/\bAKIA[0-9A-Z]{16}\b/gu, "***"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu, "***"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/gu, "***"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/gu, "***"],
  [/\bgsk_[A-Za-z0-9]{16,}/gu, "***"],
  [/\bAIza[0-9A-Za-z_-]{20,}/gu, "***"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu, "***"],
  [/(\bBearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gu, "$1***"],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/giu, "$1***@"],
  [
    /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIALS?)[A-Za-z0-9_]*\s*[=:]\s*)["']?[^\s"']{4,}["']?/giu,
    "$1***",
  ],
];

export function redactSecrets(text: string): string {
  let clean = text;
  for (const [pattern, replacement] of REDACTIONS) clean = clean.replace(pattern, replacement);
  return clean;
}

const HOME = homedir();
const HOME_PATTERN = HOME
  ? new RegExp(HOME.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/(?:\\\\|\/)+/gu, "[\\\\/]+"), "giu")
  : null;

/**
 * What memory keeps of a turn's own text: no key, token, password or private key (the trace's shapes and the gate's,
 * with the env-file lines around them; doc 18 reviews, rounds 2 and 3), and no personal home folder.
 */
export function privateText(text: string): string {
  const clean = redactSecrets(redact(text));
  return HOME_PATTERN ? clean.replace(HOME_PATTERN, "~") : clean;
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
  if (candidateSource === "human") {
    const relation = relationToUserStatements(candidate, records);
    if (relation) return relation;
  }
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
  // Two statements of the user's were compared above, on their words alone; only an identical one merges.
  const bothHuman = candidateSource === "human" && best?.record.entry.frontmatter.metadata.source === "human";
  // Two different sentences the user stated are two statements unless they are practically the same: "Always write
  // docs for new code" used to replace "Always write tests for new code" (doc 18 §2.1 C3). A contradiction between
  // them is resolved by supersession, never by one silently overwriting the other.
  if (best && best.score >= duplicateThreshold && !bothHuman) {
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
      full: true,
    };
  }
  return { action: "create", slug: candidate.slug, reason: "novel" };
}
