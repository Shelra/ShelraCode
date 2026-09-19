/**
 * A small Markdown block and inline parser for the terminal transcript.
 *
 * OpenTUI's own renderer wraps list items without a hanging indent, leaks the ">" of block quotes,
 * draws "---" literally and gives every heading level the same look. Parsing here lets the view lay
 * each block out as a real object. Tables stay with OpenTUI's renderer, which lays them out well.
 *
 * Deliberately not CommonMark: a single newline inside a paragraph is kept as a line break, because
 * models write chat-style ("Files changed:\nsrc/a.ts\nsrc/b.ts") and joining those would flatten them.
 */

export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** The link target when the span is a link label. */
  link?: string;
}

export interface ListItem {
  depth: number;
  ordered: boolean;
  /** "•" family for bullets, "1." for numbered items. */
  marker: string;
  text: string;
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: ListItem[] }
  | { type: "quote"; text: string }
  | { type: "rule" }
  | { type: "table"; raw: string };

/* ── Inline ──────────────────────────────────────────────────────── */

type Style = Pick<InlineSpan, "bold" | "italic" | "strike">;

const EMPHASIS: ReadonlyArray<readonly [RegExp, keyof Style]> = [
  [/\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)/, "bold"],
  [/(?<![\w_])__(?=\S)([\s\S]*?\S)__(?![\w_])/, "bold"],
  [/~~(?=\S)([\s\S]*?\S)~~/, "strike"],
  [/(?<![*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/, "italic"],
  [/(?<![\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/, "italic"],
];

function styled(text: string, style: Style): InlineSpan[] {
  for (const [pattern, flag] of EMPHASIS) {
    const match = pattern.exec(text);
    if (!match || match[1] === undefined) continue;
    return [
      ...styled(text.slice(0, match.index), style),
      ...styled(match[1], { ...style, [flag]: true }),
      ...styled(text.slice(match.index + match[0].length), style),
    ];
  }
  return text ? [{ text, ...style }] : [];
}

const LINK = /\[([^\]\n]+)\]\((\S+?)\)/;

function withLinks(text: string): InlineSpan[] {
  const match = LINK.exec(text);
  if (!match || match[1] === undefined || match[2] === undefined) return styled(text, {});
  return [
    ...styled(text.slice(0, match.index), {}),
    ...styled(match[1], {}).map((span) => ({ ...span, link: match[2] })),
    ...withLinks(text.slice(match.index + match[0].length)),
  ];
}

const CODE_OPEN = "\uE000";
const CODE_CLOSE = "\uE001";
const PLACEHOLDER = /\uE000(\d+)\uE001/;

/**
 * Code spans are masked before emphasis and links are resolved, then restored: nothing inside them is
 * treated as markup, yet `**`code`**` (bold around code, common in model output) still bolds the code.
 */
export function parseInline(input: string): InlineSpan[] {
  const codes: string[] = [];
  const masked = input.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_match, _ticks, body: string) => {
    codes.push(body.replace(/^ (.*) $/s, "$1"));
    return `${CODE_OPEN}${codes.length - 1}${CODE_CLOSE}`;
  });
  if (codes.length === 0) return withLinks(masked);

  return withLinks(masked).flatMap<InlineSpan>((span) => {
    const pieces = span.text.split(new RegExp(PLACEHOLDER.source, "g"));
    return pieces.flatMap<InlineSpan>((piece, index) => {
      if (index % 2 === 0) return piece ? [{ ...span, text: piece }] : [];
      return [{ ...span, text: codes[Number(piece)] ?? "", code: true }];
    });
  });
}

/** The text with all markup removed: what a reader would copy. */
export function plainText(spans: readonly InlineSpan[]): string {
  return spans.map((span) => span.text).join("");
}

/* ── Blocks ──────────────────────────────────────────────────────── */

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const BULLETS = ["•", "◦", "▪"] as const;

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    ITEM.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEPARATOR.test(next))
  );
}

/** Parses prose (no fenced code) into blocks. Unknown or half-typed markup degrades to a paragraph. */
export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    const joined = paragraph.join("\n").trim();
    if (joined) blocks.push({ type: "paragraph", text: joined });
    paragraph = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const next = lines[index + 1];

    if (line.trim() === "") {
      flush();
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = Math.min(3, (heading[1] ?? "#").length) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, text: heading[2] ?? "" });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (line.includes("|") && next !== undefined && TABLE_SEPARATOR.test(next)) {
      flush();
      const rows: string[] = [];
      while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim() !== "") {
        rows.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({ type: "table", raw: rows.join("\n") });
      continue;
    }

    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      while (index < lines.length) {
        const match = QUOTE.exec(lines[index] ?? "");
        if (!match) break;
        quoted.push(match[1] ?? "");
        index += 1;
      }
      blocks.push({ type: "quote", text: quoted.join("\n").trim() });
      continue;
    }

    if (ITEM.test(line)) {
      flush();
      const items: ListItem[] = [];
      const indents: number[] = [];
      let current: ListItem | null = null;
      while (index < lines.length) {
        const row = lines[index] ?? "";
        const match = ITEM.exec(row);
        if (match) {
          const indent = (match[1] ?? "").replace(/\t/g, "    ").length;
          const isOrdered = /\d/.test(match[2] ?? "");
          if (items.length > 0 && indent <= (indents[0] ?? 0) && isOrdered !== items[0]?.ordered) break;
          while (indents.length > 0 && (indents.at(-1) ?? 0) > indent) indents.pop();
          if (indents.at(-1) !== indent) indents.push(indent);
          const depth = indents.length - 1;
          const ordered = /\d/.test(match[2] ?? "");
          current = {
            depth,
            ordered,
            marker: ordered ? (match[2] ?? "1.") : (BULLETS[Math.min(depth, BULLETS.length - 1)] ?? "•"),
            text: (match[3] ?? "").trim(),
          };
          items.push(current);
          index += 1;
          continue;
        }
        if (row.trim() === "") {
          let ahead = index + 1;
          while (ahead < lines.length && (lines[ahead] ?? "").trim() === "") ahead += 1;
          if (ahead < lines.length && ITEM.test(lines[ahead] ?? "")) {
            index = ahead;
            continue;
          }
          break;
        }
        if (current && /^\s{2,}\S/.test(row) && !HEADING.test(row) && !QUOTE.test(row)) {
          current.text += ` ${row.trim()}`;
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    paragraph.push(line);
    index += 1;
    if (startsBlock(lines[index] ?? "", lines[index + 1])) flush();
  }
  flush();
  return blocks;
}
