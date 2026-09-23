import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Acceptance checks for the Achilles visual line (docs/ui/audit/2026-09-22-achilles), run on the
 * source of `src/ui` so a regression fails before anyone captures a screen: colours come only from
 * `theme.ts`, nothing blends colours, every glyph is in the allowed set, no border is rounded or
 * doubled, and a bordered panel has no fill. They read the source, not what is drawn: a colour chosen
 * at run time needs a render test (see `app.test.tsx`), and the audit captures check the drawn cells.
 */
const UI = fileURLToPath(new URL(".", import.meta.url));
const ALLOWED = new Set("─│┌┐└┘├┤●○▸▪✓✗›·→█░");
/** Punctuation in prose, not UI glyphs: the ellipsis, the en dash of a range, the em dash, the minus sign. */
const TYPOGRAPHIC = new Set("…–—−");

/** Lines that read other programs' output or data saved by older versions; they draw nothing. */
const EXEMPT: ReadonlyArray<{ file: string; pattern: RegExp }> = [
  { file: "activity.ts", pattern: /FAIL\|×\|✗\|✕/ }, // test-runner failure lines
  { file: "activity.ts", pattern: /✖\\s\+/ }, // ESLint's summary line
  { file: "app.tsx", pattern: /\.replace\("▣/ }, // a marker older versions wrote into tool output
];

/**
 * Bordered panels that still have a fill of their own, per file. Changing how they look waits for the
 * owner's decision (code review 2026-09-23); when one is fixed, lower its count here.
 */
const KNOWN_FILLED_PANELS: Record<string, number> = {
  "agents-modal.tsx": 2,
  "bench-modal.tsx": 1,
  "schedule-modal.tsx": 1,
};

/** A fill the same colour as what is behind every panel (the page, a dialog's backdrop) draws nothing. */
const BASE_FILL = /^t\.(background|overlay)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

function codeLines(): Array<{ file: string; line: number; text: string }> {
  return sourceFiles(UI).flatMap((path) => {
    const file = relative(UI, path).replaceAll("\\", "/");
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((text, index) => ({ file, line: index + 1, text }))
      .filter(({ text }) => !/^\s*(\/\/|\*|\/\*)/.test(text))
      .filter(({ file: name, text }) => !EXEMPT.some((rule) => name.endsWith(rule.file) && rule.pattern.test(text)));
  });
}

/** Each JSX attribute of a `<box>` with its `{…}` expression; a string or bare attribute has none. */
function boxAttributes(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, source: ts.SourceFile) {
  const attributes = new Map<string, ts.Expression | undefined>();
  for (const property of node.attributes.properties) {
    if (!ts.isJsxAttribute(property)) continue;
    const initializer = property.initializer;
    const value = initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined;
    attributes.set(property.name.getText(source), value);
  }
  return attributes;
}

/**
 * The fills a box draws while it has a border. A fill and a border that switch on the same condition
 * (a primary button: filled, no border) pair up branch by branch.
 */
function fillsUnderBorder(fill: ts.Expression, border: ts.Expression | undefined, source: ts.SourceFile): string[] {
  const noBorder = (value: ts.Expression | undefined) =>
    value !== undefined && /^(false|undefined|null)$/.test(value.getText(source));
  if (
    ts.isConditionalExpression(fill) &&
    border &&
    ts.isConditionalExpression(border) &&
    fill.condition.getText(source) === border.condition.getText(source)
  ) {
    return [
      ...(noBorder(border.whenTrue) ? [] : [fill.whenTrue.getText(source)]),
      ...(noBorder(border.whenFalse) ? [] : [fill.whenFalse.getText(source)]),
    ];
  }
  if (ts.isConditionalExpression(fill)) return [fill.whenTrue.getText(source), fill.whenFalse.getText(source)];
  return [fill.getText(source)];
}

function filledPanels(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const path of sourceFiles(UI).filter((name) => name.endsWith(".tsx"))) {
    const file = relative(UI, path).replaceAll("\\", "/");
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node) => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(source) === "box"
      ) {
        const attributes = boxAttributes(node, source);
        const fill = attributes.get("backgroundColor");
        const border = attributes.get("border") ?? attributes.get("borderStyle");
        const bordered = attributes.has("border") || attributes.has("borderStyle");
        if (fill && bordered) {
          const drawn = fillsUnderBorder(fill, border, source).filter(
            (value) => !BASE_FILL.test(value) && value !== "undefined",
          );
          if (drawn.length > 0) counts[file] = (counts[file] ?? 0) + 1;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return counts;
}

describe("Achilles visual line", () => {
  it("takes every colour from theme.ts", () => {
    const raw = codeLines().filter(({ file, text }) => file !== "theme.ts" && /["'`]#[0-9A-Fa-f]{6}/.test(text));
    expect(raw.map(({ file, line, text }) => `${file}:${line} ${text.trim()}`)).toEqual([]);
  });

  it("never blends colours: no gradients, ramps or alpha fades", () => {
    const blends = codeLines().filter(({ text }) =>
      /gradient|lerp|interpolat|blend|withAlpha|ramp\(|aurora/i.test(text),
    );
    expect(blends.map(({ file, line, text }) => `${file}:${line} ${text.trim()}`)).toEqual([]);
  });

  it("uses only the allowed glyphs", () => {
    const offenders = codeLines().flatMap(({ file, line, text }) =>
      [...text]
        .filter((char) => char.codePointAt(0)! > 127 && !ALLOWED.has(char) && !TYPOGRAPHIC.has(char))
        .map((char) => `${file}:${line} ${char} U+${char.codePointAt(0)!.toString(16).toUpperCase()}`),
    );
    expect(offenders).toEqual([]);
  });

  it("draws no rounded, double or heavy borders", () => {
    const borders = codeLines().filter(({ text }) => /borderStyle[=:]\s*\{?["'](rounded|double|heavy)["']/.test(text));
    expect(borders.map(({ file, line }) => `${file}:${line}`)).toEqual([]);
  });

  it("gives a bordered panel no fill: a terminal paints the fill under the border, a half-cell band", () => {
    expect(filledPanels()).toEqual(KNOWN_FILLED_PANELS);
  });
});
