import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Acceptance checks for the Achilles visual line (docs/ui/audit/2026-09-22-achilles), run on the
 * source so a regression fails before anyone captures a screen: colours come only from `theme.ts`,
 * every glyph is in the allowed set, and no border is rounded or doubled. The rendered screens are
 * checked cell by cell by the audit captures.
 */
const UI = fileURLToPath(new URL(".", import.meta.url));
const ALLOWED = new Set("─│┌┐└┘├┤●○▸▪✓✗›·→█░");
/** Punctuation in prose, not UI glyphs; the site itself writes `Planning...` and `−23`. */
const TYPOGRAPHIC = new Set("…–—−’‘“”");

/** Lines that read other programs' output or data saved by older versions; they draw nothing. */
const EXEMPT: ReadonlyArray<{ file: string; pattern: RegExp }> = [
  { file: "activity.ts", pattern: /FAIL\|×\|✗\|✕/ }, // test-runner failure lines
  { file: "activity.ts", pattern: /✖\\s\+/ }, // ESLint's summary line
  { file: "app.tsx", pattern: /\.replace\("▣/ }, // a marker older versions wrote into tool output
];

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

describe("Achilles visual line", () => {
  it("takes every colour from theme.ts", () => {
    const raw = codeLines().filter(({ file, text }) => file !== "theme.ts" && /["'`]#[0-9A-Fa-f]{6}/.test(text));
    expect(raw.map(({ file, line, text }) => `${file}:${line} ${text.trim()}`)).toEqual([]);
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
});
