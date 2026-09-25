import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { foldText, previousRequestWeight, searchTerms } from "./terms";
import { MEMORY_SOURCE_WEIGHT, type MemoryRecord } from "./types";

/**
 * Deterministic, lexical retrieval over the memory store — no embeddings, on purpose. Production
 * practice for code converged on lexical/agentic retrieval (research/lanes/13 §1), and the score must be
 * explainable. The ranking follows the Generative Agents shape (relevance + recency + importance) with the
 * provenance weight standing in for importance, plus two code-specific signals: overlap between the entry's
 * `relatedFiles` and the paths of the turn, and a staleness penalty when one of those files changed after the
 * entry was last confirmed.
 *
 * Memory v2 (docs/architecture/18-MEMORY-V2.md §4.3) puts the context in tiers:
 * 1. standing rules — what the user said to always or never do, their facts and corrections — reach every request,
 *    whatever its words (a rule shares no word with "yes, do it", and used to score zero);
 * 2. knowledge ranked for the request: terms weighted by rarity across the store (a word every entry has decides
 *    nothing), matched in English or Spanish (`terms.ts`), with a short follow-up read with the request before it;
 * 3. pointers to the next entries by rank, loadable with memory_read.
 * Every shown entry carries the reasons it was chosen.
 */

export interface RetrievalQuery {
  /** The user's request (and, optionally, recent context) as free text. */
  text: string;
  /** The session's previous request: a short follow-up ("sí, hazlo", "ok continue") is about it (doc 18 R2). */
  previous?: string;
  /** Workspace-relative paths already known to matter for this turn. */
  paths?: readonly string[];
  now?: number;
}

export interface RankedMemory {
  record: MemoryRecord;
  score: number;
  relevance: number;
  stale: boolean;
  staleReason?: string;
  /** Why it ranks where it does: matched terms, files, provenance, staleness. */
  reasons: string[];
  /**
   * Whether the match is enough to show the whole entry: two of the request's terms, half of them, a name or a path.
   * One ordinary word shared with an unrelated request ("write a haiku" and "batches writes") is a pointer at most.
   */
  expandable: boolean;
}

export interface MemoryContextOptions {
  /** Maximum characters of injected entry bodies. */
  bodyBudgetChars?: number;
  /** Maximum number of bodies to inject. */
  maxEntries?: number;
  /** Below this relevance an entry is listed in the index only, never expanded. */
  minRelevance?: number;
  /** Maximum number of other entries listed by title; the rest are counted, and memory_list shows them. */
  maxListed?: number;
  /** An entry is expanded only when it scores at least this share of the best match; the rest become pointers. */
  relativeCutoff?: number;
  /** Maximum characters of standing rules; the ones past it are listed by their hook. */
  rulesBudgetChars?: number;
}

export type MemoryTier = "rule" | "knowledge" | "pointer" | "episode";

export interface MemoryContext {
  /** Prompt section, or an empty string when the project has no memory. */
  text: string;
  /** Slugs whose bodies were injected — retrieval "used" them. */
  expanded: string[];
  /** Slugs that were listed as index lines only. */
  listed: string[];
  /** Standing rules shown in full whatever the request (tier 1). */
  rules?: string[];
  /** Past attempts shown as lessons, by the time they happened. */
  episodes?: string[];
  /** Why each shown entry was chosen, for the trace and `shelra memory why`. */
  explain?: Array<{ slug: string; tier: MemoryTier; score: number; reasons: string[] }>;
}

const DEFAULT_BODY_BUDGET = 3_000;
const DEFAULT_MAX_ENTRIES = 4;
const DEFAULT_MIN_RELEVANCE = 0.08;
/**
 * Every entry listed in every request made memory growth a per-request token cost (audit doc 15, M6); the
 * most relevant are listed and the rest counted.
 */
const DEFAULT_MAX_LISTED = 12;
const DEFAULT_RULES_BUDGET = 1_500;
/**
 * Four expanded entries for every request made the model read three it did not need (precision 38% on the memory
 * benchmark, doc 18 §6): an entry far below the best match is listed, not expanded.
 */
const DEFAULT_RELATIVE_CUTOFF = 0.6;
/** A body longer than what is left of the budget is shown clipped when at least this much room is left (R6). */
const MIN_CLIPPED_BODY = 400;
/** A request with fewer terms than this is read together with the one before it. */
const BODY_WEIGHT = 0.4;
const BODY_TERMS = 60;
/** A single matched term is enough to expand an entry when it is at least this rare, relative to an unseen term. */
const RARE_TERM = 0.55;
const DAY_MS = 24 * 60 * 60_000;

function pathTokens(paths: readonly string[] | undefined): Set<string> {
  const tokens = new Set<string>();
  for (const path of paths ?? []) {
    const normalized = foldText(path.replaceAll("\\", "/"));
    tokens.add(normalized);
    const base = normalized.split("/").pop();
    if (base) {
      tokens.add(base);
      tokens.add(base.replace(/\.[a-z0-9]+$/u, ""));
    }
  }
  return tokens;
}

/** Marks an entry stale when one of its related files changed after the entry was last confirmed. */
export function detectStaleness(
  workspace: string,
  record: MemoryRecord,
  now = Date.now(),
): { stale: boolean; reason?: string } {
  const meta = record.entry.frontmatter.metadata;
  const confirmedAt = Date.parse(meta.lastConfirmed ?? meta.modified);
  if (!Number.isFinite(confirmedAt)) return { stale: false };
  for (const file of meta.relatedFiles ?? []) {
    const full = join(workspace, file);
    if (!existsSync(full)) return { stale: true, reason: `${file} no longer exists` };
    try {
      if (statSync(full).mtimeMs > confirmedAt + 1_000)
        return { stale: true, reason: `${file} changed after this was last confirmed` };
    } catch {
      // unreadable: not evidence either way
    }
  }
  if (now - confirmedAt > 180 * DAY_MS) return { stale: true, reason: "not confirmed in six months" };
  return { stale: false };
}

/**
 * A standing rule: something the user said in their own words (a rule, a fact, a correction) or a preference a
 * person stated. It reaches every request (doc 18 §4.3, cause R1).
 */
export function isStandingRule(record: MemoryRecord): boolean {
  const meta = record.entry.frontmatter.metadata;
  if (meta.source !== "human") return false;
  return meta.type === "preference" || (meta.tags ?? []).includes("user-directive");
}

interface RecordTerms {
  head: Set<string>;
  body: Set<string>;
}

/** Records are immutable once loaded; their terms are computed once. */
const termCache = new WeakMap<MemoryRecord, RecordTerms>();

function termsOf(record: MemoryRecord): RecordTerms {
  const cached = termCache.get(record);
  if (cached) return cached;
  const meta = record.entry.frontmatter.metadata;
  const head = new Set(
    searchTerms(
      `${record.index.title} ${record.index.hook} ${record.entry.frontmatter.description} ${(meta.tags ?? []).join(" ")} ${(meta.relatedFiles ?? []).join(" ")}`,
    ),
  );
  const body = new Set(searchTerms(record.entry.body.slice(0, 4_000)).filter((term) => !head.has(term)));
  const terms = { head, body };
  termCache.set(record, terms);
  return terms;
}

/** How many records hold each term, for rarity weights; cached per loaded store. */
const frequencyCache = new WeakMap<readonly MemoryRecord[], Map<string, number>>();

function documentFrequency(records: readonly MemoryRecord[]): Map<string, number> {
  const cached = frequencyCache.get(records);
  if (cached) return cached;
  const frequency = new Map<string, number>();
  for (const record of records) {
    const { head, body } = termsOf(record);
    for (const term of head) frequency.set(term, (frequency.get(term) ?? 0) + 1);
    for (const term of body) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  }
  frequencyCache.set(records, frequency);
  return frequency;
}

/**
 * The request's weighted terms: its own, plus the previous request's when it only carries that one on ("sí, hazlo",
 * "go ahead and fix it"). A short new request ("fix the login bug") is not a follow-up: its own words decide.
 */
function queryTerms(query: RetrievalQuery): Map<string, number> {
  const weights = new Map<string, number>();
  const own = searchTerms(query.text);
  for (const term of own) weights.set(term, 1);
  const carried = query.previous ? previousRequestWeight(query.text) : 0;
  if (query.previous && carried > 0) {
    for (const term of searchTerms(query.previous)) {
      if (!weights.has(term)) weights.set(term, carried);
    }
  }
  return weights;
}

function rarity(term: string, frequency: Map<string, number>, total: number): number {
  const count = frequency.get(term) ?? 0;
  return Math.log(1 + (total - count + 0.5) / (count + 0.5));
}

/**
 * Relevance in [0,1]: the rarity-weighted share of the request an entry matches, title/hook/tags counting more than
 * the body, normalized by the smaller side so a short, precise entry is not penalized against a long prompt.
 */
function relevanceOf(
  weights: Map<string, number>,
  record: MemoryRecord,
  frequency: Map<string, number>,
  total: number,
): { relevance: number; matched: string[]; expandable: boolean } {
  if (weights.size === 0) return { relevance: 0, matched: [], expandable: false };
  const { head, body } = termsOf(record);
  let matchedMass = 0;
  let queryMass = 0;
  const matched: Array<[string, number]> = [];
  for (const [term, weight] of weights) {
    const idf = rarity(term, frequency, total);
    queryMass += weight * idf;
    const hit = head.has(term) ? 1 : body.has(term) ? BODY_WEIGHT : 0;
    if (hit > 0) {
      matchedMass += weight * idf * hit;
      matched.push([term, weight * idf * hit]);
    }
  }
  if (matchedMass === 0) return { relevance: 0, matched: [], expandable: false };
  let entryMass = 0;
  for (const term of head) entryMass += rarity(term, frequency, total);
  let bodyTerms = 0;
  for (const term of body) {
    if (bodyTerms++ >= BODY_TERMS) break;
    entryMass += BODY_WEIGHT * rarity(term, frequency, total);
  }
  const floor = 3 * (queryMass / weights.size);
  const relevance = Math.min(1, matchedMass / Math.max(floor, Math.min(queryMass, entryMass)));
  // A word few entries share ("password", "clerk") is specific evidence; one most of the store shares is not.
  const rarest = rarity("", new Map(), total);
  const expandable =
    matched.length >= 2 ||
    matched.length * 2 >= weights.size ||
    matched.some(([term]) => /[/._\d]/u.test(term) || rarity(term, frequency, total) >= RARE_TERM * rarest);
  return {
    relevance,
    expandable,
    matched: matched
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([term]) => term),
  };
}

/** Current truth only: a superseded, invalidated or archived entry is history, never a match (doc 18 R7). */
function currentOnly(records: readonly MemoryRecord[]): readonly MemoryRecord[] {
  const isCurrent = (record: MemoryRecord) => {
    const status = record.entry.frontmatter.metadata.status;
    return status === undefined || status === "active";
  };
  return records.every(isCurrent) ? records : records.filter(isCurrent);
}

export function rankMemories(
  allRecords: readonly MemoryRecord[],
  query: RetrievalQuery,
  workspace: string,
): RankedMemory[] {
  const records = currentOnly(allRecords);
  const now = query.now ?? Date.now();
  const weights = queryTerms(query);
  const frequency = documentFrequency(records);
  const queryPaths = pathTokens(query.paths);
  for (const term of weights.keys()) if (term.includes("/") || /\.[a-z]{1,5}$/u.test(term)) queryPaths.add(term);

  const ranked: RankedMemory[] = [];
  for (const record of records) {
    const meta = record.entry.frontmatter.metadata;
    const { relevance, matched, expandable } = relevanceOf(weights, record, frequency, records.length);
    const related = pathTokens(meta.relatedFiles);
    const sharedPaths = (meta.relatedFiles ?? []).filter((file) =>
      [...pathTokens([file])].some((token) => queryPaths.has(token)),
    );
    let pathOverlap = 0;
    for (const token of related) if (queryPaths.has(token)) pathOverlap += 1;
    const pathBoost = Math.min(0.5, pathOverlap * 0.25);
    const confirmed = Date.parse(meta.lastConfirmed ?? meta.modified);
    const ageDays = Math.max(0, (now - confirmed) / DAY_MS);
    const recency = Number.isFinite(ageDays) ? Math.exp(-ageDays / 90) : 0.5;
    const trust = MEMORY_SOURCE_WEIGHT[meta.source ?? "inference"] * (meta.confidence ?? 0.7);
    // Staleness reads the disk; an entry that matched nothing scores zero whatever it says, and a rule is shown anyway.
    const staleness =
      relevance + pathBoost > 0 || isStandingRule(record)
        ? detectStaleness(workspace, record, now)
        : { stale: false, reason: undefined };
    // Entries that were there when checks passed rank a little higher, ones that were there when they
    // failed a little lower (audit doc 15, M3); bounded so relevance still decides.
    const usefulness = 1 + 0.08 * Math.max(-3, Math.min(5, meta.credit ?? 0));
    const score =
      (relevance + pathBoost) * (0.6 + 0.4 * trust) * (0.7 + 0.3 * recency) * (staleness.stale ? 0.7 : 1) * usefulness;
    const reasons = [
      ...(matched.length > 0 ? [`terms: ${matched.join(", ")}`] : []),
      ...(sharedPaths.length > 0 ? [`files: ${[...new Set(sharedPaths)].slice(0, 3).join(", ")}`] : []),
      `${meta.source ?? "inference"} ${Math.round((meta.confidence ?? 0.7) * 100)}%`,
      ...(meta.credit ? [`credit ${meta.credit > 0 ? "+" : ""}${meta.credit}`] : []),
      ...(staleness.stale && staleness.reason ? [`stale: ${staleness.reason}`] : []),
    ];
    ranked.push({
      record,
      score,
      relevance: relevance + pathBoost,
      stale: staleness.stale,
      staleReason: staleness.reason,
      reasons,
      expandable: expandable || pathBoost > 0,
    });
  }
  return ranked.sort((a, b) => b.score - a.score || a.record.slug.localeCompare(b.record.slug));
}

function clipBody(body: string, room: number, slug: string): string {
  const cut = body.slice(0, Math.max(0, room - 80)).replace(/\s+\S*$/u, "");
  return `${cut}\n… (clipped; memory_read ${slug} for the rest)`;
}

/**
 * Builds the memory section of a turn's system prompt: the standing rules, the most relevant entries expanded with
 * their body (within a budget), and the next ones as one-line pointers the model can load with memory_read.
 */
export function buildMemoryContext(
  records: readonly MemoryRecord[],
  query: RetrievalQuery,
  workspace: string,
  options: MemoryContextOptions = {},
): MemoryContext {
  if (records.length === 0) return { text: "", expanded: [], listed: [], rules: [], explain: [] };
  const budget = options.bodyBudgetChars ?? DEFAULT_BODY_BUDGET;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const minRelevance = options.minRelevance ?? DEFAULT_MIN_RELEVANCE;
  const rulesBudget = options.rulesBudgetChars ?? DEFAULT_RULES_BUDGET;
  const relativeCutoff = options.relativeCutoff ?? DEFAULT_RELATIVE_CUTOFF;
  const ranked = rankMemories(records, query, workspace);

  // Tier 1: standing rules, most relevant first, within their own budget.
  const rules: RankedMemory[] = [];
  const overflowRules: RankedMemory[] = [];
  let rulesUsed = 0;
  for (const item of ranked) {
    if (!isStandingRule(item.record)) continue;
    const cost = item.record.index.hook.length + 20;
    if (rulesUsed + cost > rulesBudget) {
      overflowRules.push(item);
      continue;
    }
    rules.push(item);
    rulesUsed += cost;
  }

  // Tier 2: knowledge ranked for this request.
  const expanded: Array<{ item: RankedMemory; body: string }> = [];
  let used = 0;
  for (const item of ranked) {
    if (isStandingRule(item.record)) continue;
    if (expanded.length >= maxEntries || item.relevance < minRelevance) break;
    if (!item.expandable) continue;
    const best = expanded[0]?.item.score;
    if (best !== undefined && item.score < best * relativeCutoff) break;
    const body = item.record.entry.body.trim();
    const cost = body.length + 120;
    if (used + cost <= budget) {
      expanded.push({ item, body });
      used += cost;
    } else if (budget - used >= MIN_CLIPPED_BODY) {
      const clipped = clipBody(body, budget - used - 120, item.record.slug);
      expanded.push({ item, body: clipped });
      used += clipped.length + 120;
    }
  }

  // Tier 3: pointers to what else might matter. A small store is listed whole, which costs little and tells the model
  // what exists; in a larger one an entry that shares nothing with the request is counted, not listed.
  const maxListed = options.maxListed ?? DEFAULT_MAX_LISTED;
  const shown = new Set([...rules, ...expanded.map(({ item }) => item)].map((item) => item.record.slug));
  const rest = ranked.filter((item) => !shown.has(item.record.slug) && !isStandingRule(item.record));
  const others = [...overflowRules, ...(rest.length <= maxListed ? rest : rest.filter((item) => item.relevance > 0))];
  const listed = others.slice(0, maxListed);
  const unlisted = ranked.length - shown.size - listed.length;

  const lines: string[] = [
    "PROJECT MEMORY:",
    "Saved findings from earlier work in this project. Entries below are ranked for this request; trust human and observed sources over inferences, and re-verify anything marked stale. Entries marked user-wide are the user's own preferences and hold in every project. Read others with memory_read before re-investigating from scratch.",
  ];
  if (rules.length > 0) {
    lines.push("", "Standing rules, in the user's own words (they hold for every request):");
    for (const item of rules) {
      lines.push(`- ${item.record.index.hook}${item.record.origin === "user" ? " [user-wide]" : ""}`);
    }
  }
  for (const { item, body } of expanded) {
    const meta = item.record.entry.frontmatter.metadata;
    const provenance = `${meta.source ?? "inference"}${meta.confidence !== undefined ? ` ${Math.round(meta.confidence * 100)}%` : ""}`;
    const stale = item.stale ? ` — MAY BE STALE: ${item.staleReason}` : "";
    lines.push(
      "",
      `### ${item.record.index.title} (${item.record.slug}; ${meta.type}; ${provenance}${item.record.origin === "user" ? "; user-wide" : ""}${stale})`,
      body,
    );
  }
  if (listed.length > 0 || unlisted > 0) {
    lines.push("", listed.length > 0 ? "Other saved entries:" : "Other saved entries: none related to this request.");
    for (const item of listed) {
      lines.push(
        `- ${item.record.index.title} (${item.record.index.file}) — ${item.record.index.hook}${item.record.origin === "user" ? " [user-wide]" : ""}${item.stale ? " [may be stale]" : ""}`,
      );
    }
    if (unlisted > 0) lines.push(`- … and ${unlisted} more; memory_list shows them all.`);
  }
  const explain = [
    ...rules.map((item) => ({ item, tier: "rule" as const })),
    ...expanded.map(({ item }) => ({ item, tier: "knowledge" as const })),
    ...listed.map((item) => ({ item, tier: "pointer" as const })),
  ].map(({ item, tier }) => ({
    slug: item.record.slug,
    tier,
    score: Math.round(item.score * 1_000) / 1_000,
    reasons: item.reasons,
  }));
  return {
    text: lines.join("\n"),
    expanded: expanded.map(({ item }) => item.record.slug),
    listed: listed.map((item) => item.record.slug),
    rules: rules.map((item) => item.record.slug),
    explain,
  };
}

/**
 * Adds past attempts at similar requests to a memory context, after the saved entries: lessons are what happened, not
 * instructions, and a model that sees "last time `npm test` failed, `bun test` worked" plans around it.
 */
export function appendEpisodeLessons(
  context: MemoryContext,
  lessons: ReadonlyArray<{ at: string; outcome: string; line: string; score: number; attempts: number }>,
): MemoryContext {
  if (lessons.length === 0) return context;
  const section = [
    "Past attempts at similar requests in this project (what happened then; check it still applies):",
    ...lessons.map((lesson) => lesson.line),
  ].join("\n");
  return {
    ...context,
    text: context.text ? `${context.text}\n\n${section}` : `PROJECT MEMORY:\n${section}`,
    episodes: lessons.map((lesson) => lesson.at),
    explain: [
      ...(context.explain ?? []),
      ...lessons.map((lesson) => ({
        slug: `episode ${lesson.at}`,
        tier: "episode" as const,
        score: Math.round(lesson.score * 1_000) / 1_000,
        reasons: [`${lesson.outcome}${lesson.attempts > 1 ? `, ${lesson.attempts} attempts` : ""}`],
      })),
    ],
  };
}
