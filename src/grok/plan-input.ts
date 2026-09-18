/**
 * Loose list inputs for `generate_plan`.
 *
 * Mid-tier models hand list parameters in whatever shape their training favors: a JSON array, a
 * newline-separated string, or `<item id="AC1">…</item>` markup inside a JSON string (seen live
 * 2026-09-17 from qwen3-coder-30b, twice in one turn, after which the model gave up on planning).
 * The host accepts all three and normalizes them; rejecting the call cost the plan entirely.
 */

export interface LooseItem {
  id?: string;
  text: string;
}

const ITEM_RE = /<item\b([^>]*)>([\s\S]*?)<\/item>/giu;
const ID_ATTR_RE = /\bid\s*=\s*["']([^"']+)["']/iu;
const BULLET_RE = /^\s*(?:[-*•]|\d+[.)]|[A-Z]{1,3}\d+[:.)])\s*/u;

/** Split a loose string into items: `<item>` markup when present, otherwise non-empty lines. */
export function parseLooseItems(value: string): LooseItem[] {
  const items: LooseItem[] = [];
  let matched = false;
  for (const match of value.matchAll(ITEM_RE)) {
    matched = true;
    const text = match[2].trim();
    if (!text) continue;
    const id = ID_ATTR_RE.exec(match[1] ?? "")?.[1]?.trim();
    items.push(id ? { id, text } : { text });
  }
  if (matched) return items;
  for (const line of value.split(/\r?\n/u)) {
    const text = line.replace(BULLET_RE, "").trim();
    if (text) items.push({ text });
  }
  return items;
}

/** A string list that may have arrived as one string. */
export function looseStringList(value: readonly string[] | string | undefined): string[] {
  if (value === undefined) return [];
  if (typeof value === "string") return parseLooseItems(value).map((item) => item.text);
  return [...value];
}

/** Criteria that may have arrived as one string; `<item id>` becomes the criterion id. */
export function looseCriteriaList<T>(
  value: readonly (T | string)[] | string,
): Array<T | string | { id: string; description: string; verification?: string }> {
  if (typeof value === "string") {
    return parseLooseItems(value).map((item) => (item.id ? { id: item.id, description: item.text } : item.text));
  }
  return [...value];
}

/** Steps that may have arrived as one string; each item becomes a one-line step. */
export function looseStepList<T>(value: readonly (T | string)[] | string): Array<T | string> {
  if (typeof value === "string") return parseLooseItems(value).map((item) => item.text);
  return [...value];
}
