import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tokenize } from "./gate";
import { MEMORY_SOURCE_WEIGHT, type MemoryRecord } from "./types";

/**
 * Deterministic, lexical retrieval over the memory store — no embeddings, on purpose. Production
 * practice for code converged on lexical/agentic retrieval (research/lanes/13 §1), the store is
 * small (index-capped at 200 entries), and the score must be explainable. The ranking follows the
 * Generative Agents shape (relevance + recency + importance) with the provenance weight standing in
 * for importance, plus two code-specific signals: overlap between the entry's `relatedFiles` and the
 * paths the request mentions, and a staleness penalty when one of those files changed after the
 * entry was last confirmed.
 */

export interface RetrievalQuery {
  /** The user's request (and, optionally, recent context) as free text. */
  text: string;
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
}

export interface MemoryContextOptions {
  /** Maximum characters of injected entry bodies. */
  bodyBudgetChars?: number;
  /** Maximum number of bodies to inject. */
  maxEntries?: number;
  /** Below this relevance an entry is listed in the index only, never expanded. */
  minRelevance?: number;
}

const DEFAULT_BODY_BUDGET = 3_000;
const DEFAULT_MAX_ENTRIES = 4;
const DEFAULT_MIN_RELEVANCE = 0.08;
const DAY_MS = 24 * 60 * 60_000;

function pathTokens(paths: readonly string[] | undefined): Set<string> {
  const tokens = new Set<string>();
  for (const path of paths ?? []) {
    const normalized = path.replaceAll("\\", "/").toLowerCase();
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

/** Token-overlap relevance in [0,1], weighting title/hook/tags more than the body. */
export function relevanceScore(queryTokens: readonly string[], record: MemoryRecord): number {
  if (queryTokens.length === 0) return 0;
  const meta = record.entry.frontmatter.metadata;
  const head = new Set(
    tokenize(
      `${record.index.title} ${record.index.hook} ${record.entry.frontmatter.description} ${(meta.tags ?? []).join(" ")}`,
    ),
  );
  const body = new Set(tokenize(record.entry.body.slice(0, 4_000)));
  const query = new Set(queryTokens);
  let headHits = 0;
  let bodyHits = 0;
  for (const token of query) {
    if (head.has(token)) headHits += 1;
    else if (body.has(token)) bodyHits += 1;
  }
  const weighted = headHits * 1 + bodyHits * 0.4;
  // Normalize by the smaller side so short, precise entries are not penalized against long prompts.
  const denominator = Math.max(3, Math.min(query.size, head.size + Math.min(body.size, 40)));
  return Math.min(1, weighted / denominator);
}

export function rankMemories(
  records: readonly MemoryRecord[],
  query: RetrievalQuery,
  workspace: string,
): RankedMemory[] {
  const now = query.now ?? Date.now();
  const queryTokens = tokenize(query.text);
  const queryPaths = pathTokens(query.paths);
  for (const token of queryTokens) if (token.includes("/") || /\.[a-z]{1,5}$/u.test(token)) queryPaths.add(token);

  const ranked: RankedMemory[] = [];
  for (const record of records) {
    const meta = record.entry.frontmatter.metadata;
    const relevance = relevanceScore(queryTokens, record);
    const related = pathTokens(meta.relatedFiles);
    let pathOverlap = 0;
    for (const token of related) if (queryPaths.has(token)) pathOverlap += 1;
    const pathBoost = Math.min(0.5, pathOverlap * 0.25);
    const ageDays = Math.max(0, (now - Date.parse(meta.modified)) / DAY_MS);
    const recency = Number.isFinite(ageDays) ? Math.exp(-ageDays / 90) : 0.5;
    const trust = MEMORY_SOURCE_WEIGHT[meta.source ?? "inference"] * (meta.confidence ?? 0.7);
    const staleness = detectStaleness(workspace, record, now);
    const score = (relevance + pathBoost) * (0.6 + 0.4 * trust) * (0.7 + 0.3 * recency) * (staleness.stale ? 0.7 : 1);
    ranked.push({
      record,
      score,
      relevance: relevance + pathBoost,
      stale: staleness.stale,
      staleReason: staleness.reason,
    });
  }
  return ranked.sort((a, b) => b.score - a.score || a.record.slug.localeCompare(b.record.slug));
}

export interface MemoryContext {
  /** Prompt section, or an empty string when the project has no memory. */
  text: string;
  /** Slugs whose bodies were injected — retrieval "used" them. */
  expanded: string[];
  /** Slugs that were listed as index lines only. */
  listed: string[];
}

/**
 * Builds the memory section of a turn's system prompt: the most relevant entries expanded with their
 * body (within a budget) and the rest as one-line index pointers the model can load with memory_read.
 */
export function buildMemoryContext(
  records: readonly MemoryRecord[],
  query: RetrievalQuery,
  workspace: string,
  options: MemoryContextOptions = {},
): MemoryContext {
  if (records.length === 0) return { text: "", expanded: [], listed: [] };
  const budget = options.bodyBudgetChars ?? DEFAULT_BODY_BUDGET;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const minRelevance = options.minRelevance ?? DEFAULT_MIN_RELEVANCE;
  const ranked = rankMemories(records, query, workspace);

  const expanded: RankedMemory[] = [];
  let used = 0;
  for (const item of ranked) {
    if (expanded.length >= maxEntries || item.relevance < minRelevance) break;
    const body = item.record.entry.body.trim();
    const cost = body.length + 120;
    if (used + cost > budget) continue;
    expanded.push(item);
    used += cost;
  }
  const expandedSlugs = new Set(expanded.map((item) => item.record.slug));
  const listed = ranked.filter((item) => !expandedSlugs.has(item.record.slug));

  const lines: string[] = [
    "PROJECT MEMORY:",
    "Saved findings from earlier work in this project. Entries below are ranked for this request; trust human and observed sources over inferences, and re-verify anything marked stale. Read others with memory_read before re-investigating from scratch.",
  ];
  for (const item of expanded) {
    const meta = item.record.entry.frontmatter.metadata;
    const provenance = `${meta.source ?? "inference"}${meta.confidence !== undefined ? ` ${Math.round(meta.confidence * 100)}%` : ""}`;
    const stale = item.stale ? ` — MAY BE STALE: ${item.staleReason}` : "";
    lines.push(
      "",
      `### ${item.record.index.title} (${item.record.slug}; ${meta.type}; ${provenance}${stale})`,
      item.record.entry.body.trim(),
    );
  }
  if (listed.length > 0) {
    lines.push("", "Other saved entries:");
    for (const item of listed) {
      lines.push(
        `- ${item.record.index.title} (${item.record.index.file}) — ${item.record.index.hook}${item.stale ? " [may be stale]" : ""}`,
      );
    }
  }
  return {
    text: lines.join("\n"),
    expanded: expanded.map((item) => item.record.slug),
    listed: listed.map((item) => item.record.slug),
  };
}
