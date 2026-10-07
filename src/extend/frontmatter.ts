/**
 * Front matter for SKILL.md, agent files and rule files: the YAML subset those files actually use, parsed without a
 * dependency and without ever throwing. Supported: `key: scalar` (quoted or not), `key: [a, b]`, a block list
 * (`key:` then `- item` lines), a one-level map (`key:` then indented `sub: value` lines), and `|` / `>` block
 * scalars. Anything else becomes a diagnostic, never an exception, because a malformed file must degrade into a
 * report (AGENTS.md, resilience rule), not end a turn.
 */

export type FrontmatterValue = string | boolean | string[] | Record<string, string>;

export interface ParsedFrontmatter {
  /** The recognised keys, in file order. */
  data: Record<string, FrontmatterValue>;
  /** Everything after the closing `---`, without the leading blank line. */
  body: string;
  /** Whether the file opened with a well-formed front matter block. */
  hasFrontmatter: boolean;
  /** Lines that could not be read; the file is still usable without them. */
  problems: string[];
}

export const MAX_FRONTMATTER_BYTES = 16 * 1024;

function stripQuotes(value: string): string {
  const text = value.trim();
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
  ) {
    const inner = text.slice(1, -1);
    return text.startsWith('"') ? inner.replace(/\\n/gu, "\n").replace(/\\"/gu, '"').replace(/\\\\/gu, "\\") : inner;
  }
  return text;
}

function scalar(value: string): string | boolean {
  const text = stripQuotes(value);
  if (/^(true|yes|on)$/iu.test(value.trim())) return true;
  if (/^(false|no|off)$/iu.test(value.trim())) return false;
  return text;
}

function inlineList(value: string): string[] | null {
  const text = value.trim();
  if (!text.startsWith("[") || !text.endsWith("]")) return null;
  const inner = text.slice(1, -1).trim();
  if (!inner) return [];
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ",") {
      items.push(stripQuotes(current));
      current = "";
    } else {
      current += char;
    }
  }
  items.push(stripQuotes(current));
  return items.filter((item) => item.length > 0);
}

/** Splits a file into its front matter text and body. A file without a closing `---` has no front matter. */
export function splitFrontmatter(text: string): { raw: string; body: string; ok: boolean } {
  const source = text.replace(/^﻿/u, "");
  const lines = source.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") return { raw: "", body: source, ok: false };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return { raw: "", body: source, ok: false };
  const raw = lines.slice(1, end).join("\n");
  if (Buffer.byteLength(raw, "utf8") > MAX_FRONTMATTER_BYTES) return { raw: "", body: source, ok: false };
  const body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\s*\n/u, "");
  return { raw, body, ok: true };
}

export function parseFrontmatter(text: string): ParsedFrontmatter {
  const split = splitFrontmatter(text);
  const result: ParsedFrontmatter = { data: {}, body: split.body, hasFrontmatter: split.ok, problems: [] };
  if (!split.ok) {
    if (text.trimStart().startsWith("---")) result.problems.push("front matter is not closed with a line of ---");
    return result;
  }
  const lines = split.raw.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\s/u.test(line)) {
      result.problems.push(`line ${index + 2}: unexpected indentation`);
      continue;
    }
    const match = /^([A-Za-z0-9_.-]+):(?:\s+(.*)|\s*)$/u.exec(line);
    if (!match) {
      result.problems.push(`line ${index + 2}: not a "key: value" line`);
      continue;
    }
    const key = match[1] as string;
    const rest = (match[2] ?? "").trim();
    if (rest === "|" || rest === ">" || rest === "|-" || rest === ">-") {
      const block: string[] = [];
      while (index + 1 < lines.length && (/^\s/u.test(lines[index + 1] ?? "") || !(lines[index + 1] ?? "").trim())) {
        block.push((lines[index + 1] ?? "").replace(/^\s{1,4}/u, ""));
        index++;
      }
      const folded = rest.startsWith(">");
      const joined = folded ? block.join(" ").replace(/\s+/gu, " ") : block.join("\n");
      result.data[key] = joined.trim();
      continue;
    }
    if (rest === "") {
      const items: string[] = [];
      const map: Record<string, string> = {};
      let kind: "list" | "map" | null = null;
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? "";
        if (!next.trim() || next.trim().startsWith("#")) {
          index++;
          continue;
        }
        if (!/^\s/u.test(next) && !/^-\s/u.test(next)) break;
        const item = /^\s*-\s+(.*)$/u.exec(next);
        const pair = /^\s+([A-Za-z0-9_.-]+):\s*(.*)$/u.exec(next);
        if (item && kind !== "map") {
          kind = "list";
          items.push(stripQuotes(item[1] ?? ""));
        } else if (pair && kind !== "list") {
          kind = "map";
          map[pair[1] as string] = stripQuotes(pair[2] ?? "");
        } else {
          result.problems.push(`line ${index + 3}: nested structure is not supported`);
        }
        index++;
      }
      result.data[key] = kind === "map" ? map : items;
      continue;
    }
    const list = inlineList(rest);
    result.data[key] = list ?? scalar(rest);
  }
  return result;
}

/** The text value of a key, or undefined when absent or not a string. */
export function stringOf(value: FrontmatterValue | undefined): string | undefined {
  if (typeof value === "string") return value;
  return undefined;
}

/** A list from a YAML list, an inline list or a comma/space separated string. */
export function listOf(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[\s,]+/u).filter(Boolean);
  return [];
}

/**
 * A list of tool names or rules, split on commas and spaces that are outside parentheses, so `Bash(git add *)` stays one
 * entry. YAML lists and inline lists are already split and are returned as they are.
 */
export function toolListOf(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  const items: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === "," || /\s/u.test(char))) {
      if (current.trim()) items.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

export function boolOf(value: FrontmatterValue | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function needsQuotes(value: string): boolean {
  return (
    value === "" ||
    /^[\s'"[\]{}>|*&!%@`#-]/u.test(value) ||
    /:\s|\s#|^(true|false|yes|no|on|off|null|~)$/iu.test(value) ||
    value.includes("\n")
  );
}

function quote(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\n/gu, "\\n")}"`;
}

/** Writes front matter in a stable key order, so an unchanged definition always hashes the same. */
export function serializeFrontmatter(
  data: Record<string, FrontmatterValue | undefined>,
  body: string,
  order: readonly string[] = [],
): string {
  const keys = [
    ...order.filter((key) => data[key] !== undefined),
    ...Object.keys(data).filter((key) => !order.includes(key) && data[key] !== undefined),
  ];
  const out: string[] = ["---"];
  for (const key of keys) {
    const value = data[key];
    if (value === undefined) continue;
    if (typeof value === "boolean") out.push(`${key}: ${value}`);
    else if (typeof value === "string") out.push(`${key}: ${needsQuotes(value) ? quote(value) : value}`);
    else if (Array.isArray(value)) {
      if (value.length === 0) out.push(`${key}: []`);
      else {
        out.push(`${key}:`);
        for (const item of value) out.push(`  - ${needsQuotes(item) ? quote(item) : item}`);
      }
    } else {
      out.push(`${key}:`);
      for (const [name, item] of Object.entries(value))
        out.push(`  ${name}: ${needsQuotes(item) ? quote(item) : item}`);
    }
  }
  out.push("---", "");
  const trimmed = body.replace(/^\s*\n/u, "").replace(/\s+$/u, "");
  return `${out.join("\n")}\n${trimmed}\n`;
}
