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

const searchCache = new WeakMap<ModelInfo, string>();

/** The lowercase text a search looks in: provider, model, what it can do, and whether it is free. */
function searchText(model: ModelInfo, providerName: (providerId: string) => string): string {
  const cached = searchCache.get(model);
  if (cached !== undefined) return cached;
  const providerId = model.provider ?? "";
  const status = model.freeStatus === "free" ? "free" : model.freeStatus === "paid" ? "paid" : "";
  const text = [
    providerId,
    providerId ? providerName(providerId) : "",
    model.id,
    model.name,
    ...capabilityWords(model),
    status,
  ]
    .join(" ")
    .toLowerCase();
  searchCache.set(model, text);
  return text;
}

function queryTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/u).filter(Boolean);
}

export interface PickerOptions {
  mode: PickerMode;
  query: string;
  providerName: (providerId: string) => string;
  /** Providers in the order their groups appear; one not listed goes after, by name. */
  providerOrder: readonly string[];
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

/**
 * The models the picker lists. Free mode is automatic, so it lists Auto Free alone: choosing a model is what Mixed is
 * for. Mixed lists every model of every provider that matches the search; each search word must appear in the model's
 * provider, id, name or capabilities.
 */
export function pickerModels(models: readonly ModelInfo[], options: PickerOptions): ModelInfo[] {
  const ordered = orderModels(models, options);
  const tokens = queryTokens(options.query);
  const pool = options.mode === "free" ? ordered.filter((model) => model.id === AUTO_FREE_ID) : ordered;
  if (tokens.length === 0) return pool;
  return pool.filter((model) => {
    const text = searchText(model, options.providerName);
    return tokens.every((token) => text.includes(token));
  });
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
