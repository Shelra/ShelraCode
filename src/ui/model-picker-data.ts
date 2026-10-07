import type { ModelInfo } from "../types/index";

/**
 * What the model picker shows, as plain data: which models, in which order, under which headings, and which rows fit
 * the screen. No rendering here, so it is tested without a terminal and stays cheap with thousands of models: the
 * ordering is done once per catalog and mode, a search is a substring test on a text cached per model, and only the
 * rows that fit are ever handed to the renderer.
 */

/** The virtual model Free mode runs on: the best free route of any provider, chosen per request. */
export const AUTO_FREE_ID = "shelra/free";

export type PickerMode = "free" | "mixed" | undefined;

/** How a model's price reads in the picker, from what Shelra can prove, not from a price field that is merely zero. */
export function priceLabel(model: ModelInfo): string {
  if (model.category === "local") return "local";
  switch (model.freeStatus) {
    case "free":
      return "free";
    case "free-plan":
      return "free plan, not declared";
    case "unproven":
      return "price not proven";
    case "router":
      return "router, price varies";
    case "paid":
      return `$${(model.inputPrice * 1_000_000).toFixed(2)}/M in · $${(model.outputPrice * 1_000_000).toFixed(2)}/M out`;
    default:
      break;
  }
  if (model.pricingKnown === false) return "price unavailable";
  if (model.inputPrice === 0 && model.outputPrice === 0) return "free";
  return `$${(model.inputPrice * 1_000_000).toFixed(2)}/M in · $${(model.outputPrice * 1_000_000).toFixed(2)}/M out`;
}

export function capabilityWords(model: ModelInfo): string[] {
  return [
    model.supportsClientTools ? "tools" : undefined,
    model.reasoning ? "reasoning" : undefined,
    model.supportsVision ? "vision" : undefined,
  ].filter((word): word is string => word !== undefined);
}

/*
 * Searching. A query is a list of words, and every word must hold. Most words match text (provider, model id, name);
 * a few are filters people reach for when choosing a model:
 *
 *   @groq  provider:groq     only that provider (a name or the start of one)
 *   free  paid  local        what Shelra can prove about the price
 *   tools  vision  reasoning what the model can do
 *   ctx>100k  >=128k  64k+   at least or at most that much context
 *   -paid  -vision  -groq    a leading minus excludes (a word, a filter or a provider with @)
 *
 * When a query has text words the results are ranked by how well they match (a provider named, a name that starts
 * with the word, then a match inside), and when nothing matches exactly the closest names are shown instead.
 */
type StatusWord = "free" | "paid" | "local";
type CapabilityWord = "tools" | "vision" | "reasoning";
type ContextOp = ">=" | "<=" | ">" | "<";

export type SearchClause = { negate: boolean } & (
  | { kind: "text"; term: string }
  | { kind: "provider"; value: string }
  | { kind: "status"; value: StatusWord }
  | { kind: "capability"; value: CapabilityWord }
  | { kind: "context"; op: ContextOp; tokens: number }
);

const STATUS_WORDS = new Set<string>(["free", "paid", "local"]);
const CAPABILITY_ALIASES: Record<string, CapabilityWord> = {
  tools: "tools",
  tool: "tools",
  vision: "vision",
  reasoning: "reasoning",
  reason: "reasoning",
};

function parseContext(word: string): { op: ContextOp; tokens: number } | null {
  const match = /^(ctx|context)?(>=|<=|>|<|=|:)?(\d+(?:\.\d+)?)([km])?(\+)?$/u.exec(word);
  if (!match) return null;
  const [, label, op, amount, unit, plus] = match;
  // A bare number or "70b" is text; it is a context filter only with a label, an operator, or a unit and a plus.
  if (!label && !op && !(unit && plus)) return null;
  const base = Number(amount);
  const tokens = unit === "m" ? base * 1_000_000 : unit === "k" ? base * 1_000 : base < 1_000 ? base * 1_000 : base;
  const comparison: ContextOp = op === "<" || op === "<=" || op === ">" ? op : op === ">=" ? ">=" : ">=";
  return { op: plus ? ">=" : comparison, tokens };
}

/** The query as clauses. Cheap enough to redo on every key. */
export function parseSearch(query: string): SearchClause[] {
  const clauses: SearchClause[] = [];
  for (const raw of query.toLowerCase().split(/\s+/u)) {
    if (!raw) continue;
    const negate = raw.length > 1 && raw.startsWith("-");
    const word = negate ? raw.slice(1) : raw;
    const provider = /^(?:@|provider:|p:)(.+)$/u.exec(word);
    if (provider?.[1]) {
      clauses.push({ negate, kind: "provider", value: provider[1] });
      continue;
    }
    if (word === "@") continue;
    if (STATUS_WORDS.has(word)) {
      clauses.push({ negate, kind: "status", value: word as StatusWord });
      continue;
    }
    const capability = CAPABILITY_ALIASES[word];
    if (capability) {
      clauses.push({ negate, kind: "capability", value: capability });
      continue;
    }
    const context = parseContext(word);
    if (context) {
      clauses.push({ negate, kind: "context", ...context });
      continue;
    }
    clauses.push({ negate, kind: "text", term: word });
  }
  return clauses;
}

interface Haystack {
  providerId: string;
  providerName: string;
  /** Lowercase display name without a "Provider: " prefix. */
  name: string;
  id: string;
  /** Everything a text word may match, for the cheap first test. */
  text: string;
}

const haystackCache = new WeakMap<ModelInfo, Haystack>();

function haystackOf(model: ModelInfo, providerName: (providerId: string) => string): Haystack {
  const cached = haystackCache.get(model);
  if (cached) return cached;
  const providerId = (model.provider ?? "").toLowerCase();
  const display = providerId ? providerName(model.provider ?? "").toLowerCase() : "";
  const name = model.name.replace(/^[^:]+:\s+/u, "").toLowerCase();
  const id = model.id.toLowerCase();
  const haystack = { providerId, providerName: display, name, id, text: `${providerId} ${display} ${id} ${name}` };
  haystackCache.set(model, haystack);
  return haystack;
}

const BOUNDARY = /[\s/\-_:.]/u;

/** True when `term` starts a word in `text` (after a separator), not merely appears inside one. */
function startsWord(text: string, term: string): boolean {
  let at = text.indexOf(term);
  while (at !== -1) {
    if (at === 0 || BOUNDARY.test(text[at - 1] as string)) return true;
    at = text.indexOf(term, at + 1);
  }
  return false;
}

/** The characters of `term` appear in `text` in order, which forgives a missed or doubled letter. */
function isSubsequence(term: string, text: string): boolean {
  let at = 0;
  for (const char of text) {
    if (char === term[at]) at += 1;
    if (at === term.length) return true;
  }
  return false;
}

function isFree(model: ModelInfo, haystack: Haystack): boolean {
  if (model.freeStatus === "free") return true;
  if (model.freeStatus) return /(^|[\s/:])free($|[\s/:])/u.test(haystack.id);
  return model.inputPrice === 0 && model.outputPrice === 0;
}

function isPaid(model: ModelInfo): boolean {
  if (model.freeStatus) return model.freeStatus === "paid";
  return model.inputPrice > 0 || model.outputPrice > 0;
}

function providerMatches(haystack: Haystack, value: string): boolean {
  return (
    haystack.providerId === value ||
    haystack.providerId.startsWith(value) ||
    haystack.providerName.split(/\s+/u).some((word) => word.startsWith(value))
  );
}

/** How well a text word matches: 0 is no match; a provider named beats a name that starts with it beats a match inside. */
function textScore(term: string, haystack: Haystack, fuzzy: boolean): number {
  if (haystack.providerId === term || haystack.providerName === term) return 6;
  if (haystack.providerId.startsWith(term) || haystack.providerName.startsWith(term)) return 5;
  if (haystack.name.startsWith(term)) return 4.5;
  if (startsWord(haystack.name, term)) return 4;
  if (startsWord(haystack.id, term)) return 3;
  if (haystack.name.includes(term)) return 2;
  if (haystack.text.includes(term)) return 1;
  if (fuzzy && term.length >= 3 && (isSubsequence(term, haystack.name) || isSubsequence(term, haystack.id))) return 0.5;
  return 0;
}

/** The score of a model against the clauses, or null when one of them does not hold. */
function scoreModel(
  model: ModelInfo,
  clauses: readonly SearchClause[],
  haystack: Haystack,
  fuzzy: boolean,
): number | null {
  let score = 0;
  for (const clause of clauses) {
    let holds: boolean;
    switch (clause.kind) {
      case "text": {
        const value = textScore(clause.term, haystack, fuzzy && !clause.negate);
        holds = value > 0;
        if (holds && !clause.negate) score += value;
        break;
      }
      case "provider":
        holds = providerMatches(haystack, clause.value);
        break;
      case "status":
        holds =
          clause.value === "local"
            ? model.category === "local"
            : clause.value === "free"
              ? isFree(model, haystack)
              : isPaid(model);
        break;
      case "capability":
        holds =
          clause.value === "tools"
            ? Boolean(model.supportsClientTools)
            : clause.value === "vision"
              ? Boolean(model.supportsVision)
              : Boolean(model.reasoning);
        break;
      case "context":
        holds =
          clause.op === ">"
            ? model.contextWindow > clause.tokens
            : clause.op === "<"
              ? model.contextWindow < clause.tokens
              : clause.op === "<="
                ? model.contextWindow <= clause.tokens
                : model.contextWindow >= clause.tokens;
        break;
    }
    if (holds === clause.negate) return null;
  }
  return score;
}

export interface PickerOptions {
  mode: PickerMode;
  query: string;
  providerName: (providerId: string) => string;
  /** Providers in the order their groups appear; one not listed goes after, by name. */
  providerOrder: readonly string[];
  /** Only this provider's models (a provider tab); `local` for the local ones. Absent: every provider. */
  provider?: string;
  /** Providers the person configured that list no models right now, and why: they still get a tab. */
  problems?: readonly ProviderProblem[];
}

export interface ProviderProblem {
  id: string;
  name: string;
  /** Why it lists nothing ("refused the key (HTTP 401)"). Never holds a key. */
  reason: string;
  /** The provider still lists models, but from its last good answer: the newest refresh failed. */
  stale?: boolean;
}

const orderCache = new WeakMap<readonly ModelInfo[], { key: string; ordered: ModelInfo[] }>();

/** The catalog in picker order: Auto Free first, then each provider's models, free before paid, local last. */
function orderModels(models: readonly ModelInfo[], options: PickerOptions): ModelInfo[] {
  const key = `${options.providerOrder.join(",")}`;
  const cached = orderCache.get(models);
  if (cached && cached.key === key) return cached.ordered;
  const rank = new Map(options.providerOrder.map((id, index) => [id, index]));
  const groupOf = (model: ModelInfo): number => {
    if (model.id === AUTO_FREE_ID) return -1;
    if (model.category === "local") return 10_000;
    return rank.get(model.provider ?? "") ?? 1_000;
  };
  const freeFirst = (model: ModelInfo): number => (model.freeStatus === "free" ? 0 : 1);
  const ordered = [...models].sort(
    (a, b) =>
      groupOf(a) - groupOf(b) ||
      (a.provider ?? "").localeCompare(b.provider ?? "") ||
      freeFirst(a) - freeFirst(b) ||
      a.name.localeCompare(b.name),
  );
  orderCache.set(models, { key, ordered });
  return ordered;
}

/** The key of the group a model is listed under: its provider, `local`, or Shelra's own Auto Free. */
export function groupKeyOf(model: ModelInfo): string {
  if (model.id === AUTO_FREE_ID) return "shelra";
  return model.category === "local" ? "local" : (model.provider ?? "other");
}

export interface PickerSearch {
  models: ModelInfo[];
  /** Nothing matched exactly, so these are the closest names. */
  fuzzy: boolean;
  /** How many models the catalog holds that Mixed can list (Auto Free aside). */
  total: number;
}

/**
 * The models the picker lists. Free mode is automatic, so it lists Auto Free alone: choosing a model is what Mixed is
 * for. Mixed lists every model of every provider that satisfies the search (see above), ranked by match when the
 * search has text words, and in provider order otherwise.
 */
export function pickerSearch(models: readonly ModelInfo[], options: PickerOptions): PickerSearch {
  const ordered = orderModels(models, options);
  const total = ordered.filter((model) => model.id !== AUTO_FREE_ID).length;
  if (options.mode === "free") {
    return { models: ordered.filter((model) => model.id === AUTO_FREE_ID), fuzzy: false, total };
  }
  const clauses = parseSearch(options.query);
  const pool = options.provider ? ordered.filter((model) => groupKeyOf(model) === options.provider) : ordered;
  if (clauses.length === 0) return { models: pool, fuzzy: false, total };

  const run = (fuzzy: boolean) => {
    const hits: { model: ModelInfo; score: number; index: number }[] = [];
    pool.forEach((model, index) => {
      const score = scoreModel(model, clauses, haystackOf(model, options.providerName), fuzzy);
      if (score !== null) hits.push({ model, score, index });
    });
    return hits;
  };
  let hits = run(false);
  let fuzzy = false;
  if (hits.length === 0 && clauses.some((clause) => clause.kind === "text" && !clause.negate)) {
    hits = run(true);
    fuzzy = hits.length > 0;
  }
  const ranked = clauses.some((clause) => clause.kind === "text" && !clause.negate);
  if (!ranked) return { models: hits.map((hit) => hit.model), fuzzy, total };

  // Best match first, but a provider's models stay together under their heading: groups ordered by their best hit,
  // models inside a group by their own score (Auto Free, when it matches, leads).
  const bestOfGroup = new Map<string, number>();
  const firstOfGroup = new Map<string, number>();
  for (const hit of hits) {
    const key = groupKeyOf(hit.model);
    bestOfGroup.set(key, Math.max(bestOfGroup.get(key) ?? 0, hit.score));
    firstOfGroup.set(key, Math.min(firstOfGroup.get(key) ?? hit.index, hit.index));
  }
  hits.sort((a, b) => {
    const groupA = groupKeyOf(a.model);
    const groupB = groupKeyOf(b.model);
    return (
      (bestOfGroup.get(groupB) ?? 0) - (bestOfGroup.get(groupA) ?? 0) ||
      (firstOfGroup.get(groupA) ?? 0) - (firstOfGroup.get(groupB) ?? 0) ||
      (groupA === groupB ? 0 : groupA.localeCompare(groupB)) ||
      b.score - a.score ||
      a.index - b.index
    );
  });
  return { models: hits.map((hit) => hit.model), fuzzy, total };
}

export function pickerModels(models: readonly ModelInfo[], options: PickerOptions): ModelInfo[] {
  return pickerSearch(models, options).models;
}

export interface ProviderTab {
  /** The group key: a provider id, `local`, or "" for every provider. */
  id: string;
  label: string;
  count: number;
  /** Set when the provider is configured but lists no models; the tab shows this instead of a count. */
  problem?: string;
  /** Set when the provider lists models from its last good answer because the newest refresh failed. */
  warning?: string;
}

/**
 * The provider tabs for the picker: "All" and each provider with what the search finds in it, in group order. The
 * provider chosen stays listed even when the search finds nothing there, so the person can see where they are.
 */
export function providerTabs(models: readonly ModelInfo[], options: PickerOptions): ProviderTab[] {
  const withoutTab = pickerSearch(models, {
    ...options,
    mode: "mixed",
    ...(options.provider ? { provider: undefined } : {}),
  });
  const counts = new Map<string, number>();
  for (const model of withoutTab.models) {
    if (model.id === AUTO_FREE_ID) continue;
    const key = groupKeyOf(model);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (options.provider && !counts.has(options.provider)) counts.set(options.provider, 0);
  const problems = new Map(
    (options.problems ?? []).filter((item) => !item.stale && !counts.get(item.id)).map((item) => [item.id, item]),
  );
  const warnings = new Map((options.problems ?? []).filter((item) => item.stale).map((item) => [item.id, item.reason]));
  // Tabs keep the catalog's provider order whatever the ranking is, so Tab does not jump around while typing.
  const baseOrder = [...new Set(orderModels(models, options).map(groupKeyOf))];
  // A provider that lists nothing is not in the catalog at all, so its tab goes after the ones that do, in the
  // registry's order.
  for (const id of options.providerOrder) if (problems.has(id) && !baseOrder.includes(id)) baseOrder.push(id);
  for (const id of problems.keys()) if (!baseOrder.includes(id)) baseOrder.push(id);
  const tabs: ProviderTab[] = baseOrder
    .filter((id) => counts.has(id) || problems.has(id))
    .map((id) => ({
      id,
      label: id === "local" ? "Local" : (problems.get(id)?.name ?? options.providerName(id)),
      count: counts.get(id) ?? 0,
      ...(problems.has(id) ? { problem: problems.get(id)?.reason as string } : {}),
      ...(warnings.has(id) && counts.get(id) ? { warning: warnings.get(id) as string } : {}),
    }));
  const all = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return [{ id: "", label: "All", count: all }, ...tabs];
}

/** The tab after (or before) the active one that has models, wrapping around: what Tab and Shift+Tab choose. */
export function nextProviderTab(tabs: readonly ProviderTab[], active: string, step: 1 | -1): string {
  // A provider that lists nothing can be chosen too: its tab is where the reason is shown.
  const usable = tabs.filter((tab) => tab.id === "" || tab.count > 0 || tab.problem !== undefined || tab.id === active);
  if (usable.length <= 1) return "";
  const at = Math.max(
    0,
    usable.findIndex((tab) => tab.id === active),
  );
  return (usable[(at + step + usable.length) % usable.length] as ProviderTab).id;
}

/** One line of tabs that fits `room` cells with the active one always in view; the rest are summarised as "+N". */
export function formatProviderTabs(tabs: readonly ProviderTab[], active: string, room: number): string {
  const cell = (tab: ProviderTab) => {
    const detail = tab.problem !== undefined ? "✗" : tab.warning !== undefined ? `${tab.count} !` : `${tab.count}`;
    return tab.id === active ? `[${tab.label} ${detail}]` : `${tab.label} ${detail}`;
  };
  const activeAt = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === active),
  );
  let from = 0;
  const widthOf = (start: number, end: number) =>
    tabs.slice(start, end).reduce((sum, tab, index) => sum + cell(tab).length + (index > 0 ? 2 : 0), 0);
  // Slide the window right until the active tab fits, then take as many following tabs as the line has room for.
  while (from < activeAt && widthOf(from, activeAt + 1) > room - 4) from += 1;
  let to = activeAt + 1;
  while (to < tabs.length && widthOf(from, to + 1) <= room - 5) to += 1;
  const hiddenAfter = tabs.length - to;
  const text = tabs.slice(from, to).map(cell).join("  ");
  return `${from > 0 ? "… " : ""}${text}${hiddenAfter > 0 ? `  +${hiddenAfter}` : ""}`;
}

export type PickerItem =
  | { kind: "header"; key: string; label: string; count: number }
  | { kind: "model"; key: string; model: ModelInfo };

/** The models with a heading above each provider's group. A single group needs no heading. */
export function pickerItems(models: readonly ModelInfo[], providerName: (providerId: string) => string): PickerItem[] {
  const groups = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const group =
      model.id === AUTO_FREE_ID ? "shelra" : model.category === "local" ? "local" : (model.provider ?? "other");
    groups.set(group, [...(groups.get(group) ?? []), model]);
  }
  const items: PickerItem[] = [];
  const showHeadings = groups.size > 1 || (groups.size === 1 && !groups.has("shelra"));
  for (const [group, members] of groups) {
    if (showHeadings && group !== "shelra") {
      const label = group === "local" ? "Local" : providerName(group);
      items.push({ kind: "header", key: `header-${group}`, label, count: members.length });
    }
    for (const model of members) items.push({ kind: "model", key: `model-${model.id}`, model });
  }
  return items;
}

export const MODEL_ROW_LINES = 2;
export const HEADER_ROW_LINES = 1;

export interface PickerWindow {
  items: PickerItem[];
  /** Rows above and below the window, for the "more" marks. */
  above: number;
  below: number;
}

/**
 * The rows that fit in `capacityLines` with the selected one in view, taking whole rows only. Only these are
 * rendered, whatever the size of the catalog.
 */
export function windowItems(
  items: readonly PickerItem[],
  selectedKey: string | undefined,
  capacityLines: number,
): PickerWindow {
  const heights = items.map((item) => (item.kind === "header" ? HEADER_ROW_LINES : MODEL_ROW_LINES));
  const total = heights.reduce((sum, height) => sum + height, 0);
  if (total <= capacityLines) return { items: [...items], above: 0, below: 0 };
  const selected = Math.max(
    0,
    items.findIndex((item) => item.key === selectedKey),
  );
  // Grow the window around the selection: rows below first, then above, until the lines are used.
  let start = selected;
  let end = selected + 1;
  let used = heights[selected] ?? MODEL_ROW_LINES;
  // Keep the heading of the selected group with it when it fits.
  const before = items[selected - 1];
  if (before?.kind === "header" && used + HEADER_ROW_LINES <= capacityLines) {
    start -= 1;
    used += HEADER_ROW_LINES;
  }
  let preferBelow = true;
  while (used < capacityLines) {
    const canBelow = end < items.length && used + (heights[end] ?? 0) <= capacityLines;
    const canAbove = start > 0 && used + (heights[start - 1] ?? 0) <= capacityLines;
    if (!canBelow && !canAbove) break;
    // A little more room above than below keeps the selection from sitting on the bottom edge while it moves down.
    if ((preferBelow && canBelow) || !canAbove) {
      used += heights[end] ?? 0;
      end += 1;
    } else {
      start -= 1;
      used += heights[start] ?? 0;
    }
    preferBelow = !preferBelow;
  }
  return { items: items.slice(start, end), above: start, below: items.length - end };
}

/** "20 OpenRouter · 3 Groq": where Free mode's routes come from, for the line under Auto Free. */
export function describeFreeSources(
  models: readonly ModelInfo[],
  providerName: (providerId: string) => string,
): string {
  const counts = new Map<string, number>();
  for (const model of models) {
    if (model.id === AUTO_FREE_ID || model.freeStatus !== "free" || !model.provider) continue;
    counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
  }
  const parts = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([provider, count]) => `${count} ${providerName(provider)}`);
  return parts.length === 0 ? "no free model is available yet" : parts.join(" · ");
}
