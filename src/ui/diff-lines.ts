import { type CodeToken, normalizeLang, tokenizeLine } from "./code-highlight";

/** One line of a unified patch, with the line number it has in the file it belongs to. */
export type DiffRow =
  | { kind: "context"; oldNum: number; newNum: number; text: string }
  | { kind: "added"; newNum: number; text: string }
  | { kind: "removed"; oldNum: number; text: string }
  | { kind: "separator"; count: number };

/** Parses the unified patch the file tools return (`diff`'s `createPatch`: Index, ---/+++, @@ hunks). */
export function parsePatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let prevOldEnd = 0;

  for (const raw of patch.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLine = Number.parseInt(hunkMatch[1] ?? "0", 10);
      newLine = Number.parseInt(hunkMatch[2] ?? "0", 10);
      const skipped = oldLine - prevOldEnd - 1;
      if (skipped > 0 && rows.length > 0) rows.push({ kind: "separator", count: skipped });
      continue;
    }

    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("\\")) continue;
    if (line.startsWith("Index:") || line.startsWith("====")) continue;

    if (line.startsWith("-")) {
      rows.push({ kind: "removed", oldNum: oldLine, text: line.slice(1) });
      oldLine++;
      prevOldEnd = oldLine - 1;
    } else if (line.startsWith("+")) {
      rows.push({ kind: "added", newNum: newLine, text: line.slice(1) });
      newLine++;
    } else if (line.length > 0 || (oldLine > 0 && newLine > 0)) {
      const content = line.startsWith(" ") ? line.slice(1) : line;
      rows.push({ kind: "context", oldNum: oldLine, newNum: newLine, text: content });
      oldLine++;
      newLine++;
      prevOldEnd = oldLine - 1;
    }
  }

  // A patch ends with a newline, which reads as one empty context line after the last hunk.
  while (rows.at(-1)?.kind === "context" && (rows.at(-1) as { text: string }).text === "") rows.pop();
  return rows;
}

/** One row as drawn: a line of the diff, or the continuation of a line too long for the width. */
export interface DiffLine {
  kind: "added" | "removed" | "context" | "separator";
  /** The line number on a line's first row; null on its continuation rows and on a separator. */
  number: number | null;
  tokens: CodeToken[];
  /** The rows a separator stands for. */
  skipped?: number;
}

const TAB = "    ";
/** East Asian wide characters and emoji, as code point ranges: each takes two terminal cells. */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
];

/** Terminal cells a character takes: two for East Asian wide characters and emoji, one otherwise. */
function cellWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  return WIDE_RANGES.some(([from, to]) => code >= from && code <= to) ? 2 : 1;
}

/** Cuts a highlighted line into rows of at most `first` cells, then `rest` cells, keeping each token's kind. */
function wrapTokens(tokens: readonly CodeToken[], first: number, rest: number): CodeToken[][] {
  const rows: CodeToken[][] = [[]];
  let room = Math.max(1, first);
  for (const token of tokens) {
    let text = "";
    for (const char of token.text) {
      const width = cellWidth(char);
      if (width > room) {
        if (text) rows.at(-1)?.push({ text, kind: token.kind });
        rows.push([]);
        text = "";
        room = Math.max(1, rest);
      }
      text += char;
      room -= width;
    }
    if (text) rows.at(-1)?.push({ text, kind: token.kind });
  }
  return rows;
}

export interface DiffLayout {
  lines: DiffLine[];
  /** Cells the line numbers take, right-aligned: the widest number shown. */
  numberWidth: number;
}

/**
 * Lays a patch out for `width` cells: line number, a space, the marker (`-`, `+` or a space), then the
 * highlighted code, cut at the width as a terminal would. A changed line's continuation rows repeat its
 * marker, so a long removed or added line stays readable as one; a context line's continue from the
 * marker column. Removed lines carry the old file's number, added and context lines the new one's.
 */
export function layoutDiff(rows: readonly DiffRow[], { width, path }: { width: number; path: string }): DiffLayout {
  const lang = normalizeLang(path.split(".").pop() ?? "");
  const numbers = rows.flatMap((row) =>
    row.kind === "removed" ? [row.oldNum] : row.kind === "separator" ? [] : [row.newNum],
  );
  const numberWidth = Math.max(1, ...numbers.map((value) => String(value).length));
  // The number, a space and the marker come first.
  const code = Math.max(8, width - numberWidth - 2);
  const state = { block: false };
  const lines: DiffLine[] = [];

  for (const row of rows) {
    if (row.kind === "separator") {
      lines.push({ kind: "separator", number: null, tokens: [], skipped: row.count });
      continue;
    }
    const text = row.text.replaceAll("\t", TAB);
    const tokens = tokenizeLine(text, lang, state);
    const number = row.kind === "removed" ? row.oldNum : row.newNum;
    const wrapped = wrapTokens(tokens, code, row.kind === "context" ? code + 1 : code);
    wrapped.forEach((segment, index) => {
      lines.push({ kind: row.kind, number: index === 0 ? number : null, tokens: segment });
    });
  }
  return { lines, numberWidth };
}

/**
 * The rows to show when at most `maxRows` fit: cut at the end of a line, never between the rows of a
 * wrapped one, and count what is left in the file's lines (a wrapped line is one line, not two rows).
 */
export function cutDiff(lines: readonly DiffLine[], maxRows: number): { visible: DiffLine[]; hiddenLines: number } {
  const startsLine = (line: DiffLine) => line.number !== null || line.kind === "separator";
  let shown = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!startsLine(lines[index] as DiffLine)) continue;
    let end = index + 1;
    while (end < lines.length && !startsLine(lines[end] as DiffLine)) end += 1;
    if (shown > 0 && shown + (end - index) > maxRows) {
      const rest = lines.slice(index);
      return { visible: lines.slice(0, index), hiddenLines: rest.filter((line) => line.number !== null).length };
    }
    shown += end - index;
  }
  return { visible: [...lines], hiddenLines: 0 };
}

/** A part of the summary line: the counts carry the colour of what they count. */
export interface SummaryPart {
  text: string;
  tone: "added" | "removed" | "plain";
}

/** "Added 12 lines, removed 3 lines", the way a person says what an edit did, in parts. */
export function changeSummaryParts({
  additions,
  removals,
  isNew,
}: {
  additions: number;
  removals: number;
  isNew?: boolean;
}): SummaryPart[] {
  const lines = (count: number) => `${count} line${count === 1 ? "" : "s"}`;
  if (isNew)
    return [
      { text: "Wrote ", tone: "plain" },
      { text: lines(additions), tone: "added" },
    ];
  if (additions === 0 && removals === 0) return [{ text: "No changes", tone: "plain" }];
  if (removals === 0)
    return [
      { text: "Added ", tone: "plain" },
      { text: lines(additions), tone: "added" },
    ];
  if (additions === 0)
    return [
      { text: "Removed ", tone: "plain" },
      { text: lines(removals), tone: "removed" },
    ];
  return [
    { text: "Added ", tone: "plain" },
    { text: lines(additions), tone: "added" },
    { text: ", removed ", tone: "plain" },
    { text: lines(removals), tone: "removed" },
  ];
}

export function changeSummary(diff: { additions: number; removals: number; isNew?: boolean }): string {
  return changeSummaryParts(diff)
    .map((part) => part.text)
    .join("");
}
