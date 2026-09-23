/**
 * Loose list inputs for `generate_plan`.
 *
 * Mid-tier models hand list parameters in whatever shape their training favors: a JSON array, a
 * newline-separated string, `<item id="AC1">…</item>` markup inside a JSON string (seen live
 * 2026-09-17 from qwen3-coder-30b, twice in one turn, after which the model gave up on planning),
 * or the whole JSON array encoded as a string (2026-09-23, openrouter/free). The host accepts all
 * four and normalizes them; rejecting the call cost the plan entirely.
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

/** A criterion the host built from loose input. */
export interface LooseCriterion {
  id?: string;
  description: string;
  verification?: string;
  command?: string;
}

/** A step the host built from loose input. */
export interface LooseStep {
  title: string;
  description?: string;
  filePaths?: string[];
  satisfies?: string[];
}

/** A list sent as a JSON array inside a string (seen live 2026-09-23 from openrouter/free), or null. */
function jsonArray(value: string): unknown[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function field(item: unknown, key: string): string | undefined {
  const value = typeof item === "object" && item !== null ? (item as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringsField(item: unknown, key: string): string[] | undefined {
  const value = typeof item === "object" && item !== null ? (item as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

/** A string list that may have arrived as one string. */
export function looseStringList(value: readonly string[] | string | undefined): string[] {
  if (value === undefined) return [];
  if (typeof value === "string") {
    const array = jsonArray(value);
    if (array) {
      return array.flatMap((item) => {
        const text = typeof item === "string" ? item.trim() : (field(item, "description") ?? field(item, "text"));
        return text ? [text] : [];
      });
    }
    return parseLooseItems(value).map((item) => item.text);
  }
  return [...value];
}

/** Criteria that may have arrived as one string; `<item id>` becomes the criterion id. */
export function looseCriteriaList<T>(value: readonly (T | string)[] | string): Array<T | string | LooseCriterion> {
  if (typeof value === "string") {
    const array = jsonArray(value);
    if (array) {
      return array.flatMap((item): Array<string | LooseCriterion> => {
        if (typeof item === "string") return item.trim() ? [item] : [];
        const description = field(item, "description");
        if (!description) return [];
        const id = field(item, "id");
        const verification = field(item, "verification");
        const command = field(item, "command");
        return [
          {
            ...(id ? { id } : {}),
            description,
            ...(verification ? { verification } : {}),
            ...(command ? { command } : {}),
          },
        ];
      });
    }
    return parseLooseItems(value).map((item) => (item.id ? { id: item.id, description: item.text } : item.text));
  }
  return [...value];
}

/** Steps that may have arrived as one string; each item becomes a one-line step. */
export function looseStepList<T>(value: readonly (T | string)[] | string): Array<T | string | LooseStep> {
  if (typeof value === "string") {
    const array = jsonArray(value);
    if (array) {
      return array.flatMap((item): Array<string | LooseStep> => {
        if (typeof item === "string") return item.trim() ? [item] : [];
        const title = field(item, "title") ?? field(item, "description");
        if (!title) return [];
        const description = field(item, "description");
        const filePaths = stringsField(item, "filePaths");
        const satisfies = stringsField(item, "satisfies");
        return [
          {
            title,
            ...(description && description !== title ? { description } : {}),
            ...(filePaths ? { filePaths } : {}),
            ...(satisfies ? { satisfies } : {}),
          },
        ];
      });
    }
    return parseLooseItems(value).map((item) => item.text);
  }
  return [...value];
}
