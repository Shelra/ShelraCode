import { describe, expect, it } from "vitest";
import { changeSummary, changeSummaryParts, cutDiff, type DiffLine, layoutDiff, parsePatch } from "./diff-lines";

const PATCH = [
  "Index: src/auth.ts",
  "===================================================================",
  "--- src/auth.ts",
  "+++ src/auth.ts",
  "@@ -11,4 +11,4 @@",
  " export function isExpired(session: Session, now = Date.now()): boolean {",
  "-  return session.expiresAt < now;",
  "+  return session.expiresAt <= now;",
  " }",
  "",
].join("\n");

const text = (line: DiffLine) => line.tokens.map((token) => token.text).join("");

describe("diff layout", () => {
  it("numbers removed lines from the old file and added and context lines from the new one", () => {
    const rows = parsePatch(["@@ -5,3 +5,4 @@", " a", "-b", "+c", "+d", " e", ""].join("\n"));
    const { lines } = layoutDiff(rows, { width: 80, path: "x.txt" });
    expect(lines.map((line) => [line.kind, line.number, text(line)])).toEqual([
      ["context", 5, "a"],
      ["removed", 6, "b"],
      ["added", 6, "c"],
      ["added", 7, "d"],
      ["context", 8, "e"],
    ]);
  });

  it("reads the patch the file tools write, CRLF included, without the trailing empty line", () => {
    const rows = parsePatch(PATCH.replaceAll("\n", "\r\n"));
    expect(rows.map((row) => row.kind)).toEqual(["context", "removed", "added", "context"]);
    expect(rows[1]).toMatchObject({ kind: "removed", oldNum: 12, text: "  return session.expiresAt < now;" });
  });

  it("cuts a long line at the width and keeps a changed line's marker on every row", () => {
    const long = `  it("keeps the model when switching to Mixed, and leaves a paid one for the best free model", () => {`;
    const rows = parsePatch(["@@ -76,1 +76,1 @@", `-${long}`, `+${long}`, ""].join("\n"));
    const { lines, numberWidth } = layoutDiff(rows, { width: 40, path: "src/models/routing.test.ts" });
    expect(numberWidth).toBe(2);
    const removed = lines.filter((line) => line.kind === "removed");
    // 40 cells: two for the number, one space, one marker, 36 for the code.
    expect(removed.length).toBe(Math.ceil(long.length / 36));
    expect(removed[0]?.number).toBe(76);
    expect(removed.slice(1).every((line) => line.number === null)).toBe(true);
    expect(removed.map(text).join("")).toBe(long);
    expect(removed.every((line) => text(line).length <= 36)).toBe(true);
  });

  it("highlights the code by the file's language", () => {
    const rows = parsePatch(["@@ -1,1 +1,1 @@", "-const a = 1;", "+const a = 2;", ""].join("\n"));
    const { lines } = layoutDiff(rows, { width: 80, path: "src/a.ts" });
    expect(lines[0]?.tokens.find((token) => token.text === "const")?.kind).toBe("keyword");
    expect(lines[1]?.tokens.find((token) => token.text === "2")?.kind).toBe("number");
  });

  it("marks the lines a later hunk skips", () => {
    const rows = parsePatch(["@@ -1,1 +1,1 @@", "-a", "+b", "@@ -20,1 +20,1 @@", "-c", "+d", ""].join("\n"));
    const { lines } = layoutDiff(rows, { width: 80, path: "a.txt" });
    expect(lines.map((line) => line.kind)).toEqual(["removed", "added", "separator", "removed", "added"]);
    expect(lines[2]?.skipped).toBe(18);
  });

  it("cuts a long diff at the end of a line and counts what is left in lines, not rows", () => {
    const long = `+${"x".repeat(70)}`;
    const rows = parsePatch(["@@ -0,0 +1,5 @@", "+a", long, "+b", "+c", "+d", ""].join("\n"));
    const { lines } = layoutDiff(rows, { width: 40, path: "a.txt" });
    // The long line takes two rows; a cut at three rows keeps it whole or leaves it out.
    expect(lines).toHaveLength(6);
    const { visible, hiddenLines } = cutDiff(lines, 3);
    expect(visible.map((line) => line.number)).toEqual([1, 2, null]);
    expect(hiddenLines).toBe(3);
    expect(cutDiff(lines, 2).visible.map((line) => line.number)).toEqual([1]);
    expect(cutDiff(lines, 2).hiddenLines).toBe(4);
    expect(cutDiff(lines, 40).hiddenLines).toBe(0);
  });

  it("says what an edit did in words", () => {
    expect(changeSummary({ additions: 12, removals: 3 })).toBe("Added 12 lines, removed 3 lines");
    expect(changeSummary({ additions: 1, removals: 1 })).toBe("Added 1 line, removed 1 line");
    expect(changeSummary({ additions: 2, removals: 0 })).toBe("Added 2 lines");
    expect(changeSummary({ additions: 0, removals: 4 })).toBe("Removed 4 lines");
    expect(changeSummary({ additions: 5, removals: 0, isNew: true })).toBe("Wrote 5 lines");
    // The counts carry the colour of what they count.
    expect(changeSummaryParts({ additions: 12, removals: 3 }).filter((part) => part.tone !== "plain")).toEqual([
      { text: "12 lines", tone: "added" },
      { text: "3 lines", tone: "removed" },
    ]);
  });
});
