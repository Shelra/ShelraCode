import { describe, expect, it } from "vitest";
import { type Block, parseBlocks, parseInline, plainText } from "./markdown-blocks";

const kinds = (blocks: Block[]) => blocks.map((block) => block.type);

describe("parseInline", () => {
  it("styles bold, italic, strike and code", () => {
    expect(parseInline("a **b** *c* ~~d~~ `e`")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " " },
      { text: "c", italic: true },
      { text: " " },
      { text: "d", strike: true },
      { text: " " },
      { text: "e", code: true },
    ]);
  });

  it("nests emphasis and keeps code untouched", () => {
    expect(parseInline("**bold *and italic***")).toEqual([
      { text: "bold ", bold: true },
      { text: "and italic", bold: true, italic: true },
    ]);
    expect(parseInline("`**not bold**` and `a_b_c`")).toEqual([
      { text: "**not bold**", code: true },
      { text: " and " },
      { text: "a_b_c", code: true },
    ]);
  });

  it("lets emphasis wrap code spans, the way models write bold identifiers", () => {
    expect(parseInline("**`isExpired`** — two cases")).toEqual([
      { text: "isExpired", bold: true, code: true },
      { text: " — two cases" },
    ]);
    expect(parseInline("see *`needsRefresh`* and **a `b` c**")).toEqual([
      { text: "see " },
      { text: "needsRefresh", italic: true, code: true },
      { text: " and " },
      { text: "a ", bold: true },
      { text: "b", bold: true, code: true },
      { text: " c", bold: true },
    ]);
  });

  it("does not turn identifiers, math or lone markers into emphasis", () => {
    expect(plainText(parseInline("use snake_case_name and 2 * 3 * 4 and a*b"))).toBe(
      "use snake_case_name and 2 * 3 * 4 and a*b",
    );
    expect(parseInline("snake_case_name")).toEqual([{ text: "snake_case_name" }]);
  });

  it("reads links and keeps their label styled", () => {
    expect(parseInline("see [the **spec**](https://example.com/x) now")).toEqual([
      { text: "see " },
      { text: "the ", link: "https://example.com/x" },
      { text: "spec", bold: true, link: "https://example.com/x" },
      { text: " now" },
    ]);
  });

  it("leaves half-typed markup as text while a message streams", () => {
    expect(plainText(parseInline("this is **bol"))).toBe("this is **bol");
    expect(plainText(parseInline("run `bun te"))).toBe("run `bun te");
  });

  it("never loses characters other than the markers", () => {
    const input = "Fixed `isExpired` in **src/auth.ts** and *rotated* the token.";
    expect(plainText(parseInline(input))).toBe("Fixed isExpired in src/auth.ts and rotated the token.");
  });
});

describe("parseBlocks", () => {
  it("separates headings, paragraphs and rules, mapping deep levels to three", () => {
    const blocks = parseBlocks("# One\n\nText\n\n## Two\n\n#### Four\n\n---\n\nEnd");
    expect(kinds(blocks)).toEqual(["heading", "paragraph", "heading", "heading", "rule", "paragraph"]);
    expect(
      blocks.filter((block) => block.type === "heading").map((block) => (block as { level: number }).level),
    ).toEqual([1, 2, 3]);
  });

  it("builds a list with depth, numbering and wrapped continuation lines", () => {
    const blocks = parseBlocks("- one\n  continued\n  - nested\n    - deeper\n- two\n\n1. first\n2. second");
    const first = blocks[0] as Extract<Block, { type: "list" }>;
    expect(first.items.map((item) => `${item.depth}${item.marker} ${item.text}`)).toEqual([
      "0• one continued",
      "1◦ nested",
      "2▪ deeper",
      "0• two",
    ]);
    const second = blocks[1] as Extract<Block, { type: "list" }>;
    expect(second.items.map((item) => `${item.marker} ${item.text}`)).toEqual(["1. first", "2. second"]);
  });

  it("keeps a loose list together across blank lines", () => {
    const blocks = parseBlocks("- a\n\n- b\n\nAfter");
    expect(kinds(blocks)).toEqual(["list", "paragraph"]);
    expect((blocks[0] as Extract<Block, { type: "list" }>).items).toHaveLength(2);
  });

  it("collects a block quote without its markers", () => {
    expect(parseBlocks("> line one\n> line two\n\nafter")).toEqual([
      { type: "quote", text: "line one\nline two" },
      { type: "paragraph", text: "after" },
    ]);
  });

  it("hands tables to the caller as raw text", () => {
    const blocks = parseBlocks("Before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter");
    expect(kinds(blocks)).toEqual(["paragraph", "table", "paragraph"]);
    expect((blocks[1] as Extract<Block, { type: "table" }>).raw).toContain("| 1 | 2 |");
  });

  it("keeps single newlines inside a paragraph as line breaks", () => {
    expect(parseBlocks("Files changed:\nsrc/a.ts\nsrc/b.ts")).toEqual([
      { type: "paragraph", text: "Files changed:\nsrc/a.ts\nsrc/b.ts" },
    ]);
  });

  it("ends a paragraph where a block starts, without needing a blank line", () => {
    expect(kinds(parseBlocks("Intro line\n- item\nOutro"))).toEqual(["paragraph", "list", "paragraph"]);
    expect(kinds(parseBlocks("Text\n## Heading\nMore"))).toEqual(["paragraph", "heading", "paragraph"]);
  });

  it("does not mistake emphasis or a lone asterisk for a list", () => {
    expect(kinds(parseBlocks("*italic* start of a line"))).toEqual(["paragraph"]);
    expect(kinds(parseBlocks("2 * 3 = 6"))).toEqual(["paragraph"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("\n\n  \n")).toEqual([]);
  });
});
