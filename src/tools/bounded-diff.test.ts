import { createTwoFilesPatch } from "diff";
import { describe, expect, it } from "vitest";
import { parsePatch } from "../ui/diff-lines";
import { boundedPatch } from "./bounded-diff";
import { writeFile } from "./file";

const lines = (count: number, make: (i: number) => string) =>
  Array.from({ length: count }, (_, i) => make(i)).join("\n");

describe("boundedPatch", () => {
  it("gives exactly the patch the diff library gives for an ordinary edit", () => {
    const before = lines(200, (i) => `const a${i} = ${i};`);
    const after = before.replace("const a100 = 100;", "const a100 = 101;\nconst extra = 1;");
    const bounded = boundedPatch("src/a.ts", before, after);
    expect(bounded.exact).toBe(true);
    expect(bounded.patch).toBe(createTwoFilesPatch("src/a.ts", "src/a.ts", before, after, "", "", { context: 3 }));
    expect(bounded.additions).toBe(2);
    expect(bounded.removals).toBe(1);
  });

  it("does not hold the event loop when half of a big file changes, and still says how much changed", () => {
    const before = lines(8_000, (i) => `export const value${i} = ${i};`);
    const after = lines(8_000, (i) =>
      i % 2 === 0 ? `export const changed${i} = ${i * 3};` : `export const value${i} = ${i};`,
    );
    const started = performance.now();
    const bounded = boundedPatch("src/big.ts", before, after, 100);
    const tookMs = performance.now() - started;
    // It used to take 15 seconds; the budget is 100 ms, so allow for a slow machine without hiding a regression.
    expect(tookMs).toBeLessThan(1_500);
    expect(bounded.exact).toBe(false);
    expect(bounded.additions).toBe(4_000);
    expect(bounded.removals).toBe(4_000);
    expect(bounded.patch).toContain("changed too much to show line by line");
  });

  it("returns a patch the transcript can still read when it falls back", () => {
    const before = lines(6_000, (i) => `line ${i}`);
    const after = lines(6_000, (i) => (i % 2 === 0 ? `different ${i}` : `line ${i}`));
    const rows = parsePatch(boundedPatch("a.txt", before, after, 50).patch);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("context");
  });

  it("counts a file created from nothing and a file emptied", () => {
    expect(boundedPatch("new.ts", "", "a\nb\nc", 100)).toMatchObject({ additions: 3, removals: 0, exact: true });
    expect(boundedPatch("old.ts", "a\nb", "", 100)).toMatchObject({ additions: 0, removals: 2, exact: true });
  });
});

describe("writeFile on a large rewrite", () => {
  it("returns promptly with the size of the change instead of freezing on the diff", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = mkdtempSync(join(tmpdir(), "shelra-bounded-diff-"));
    try {
      const before = lines(8_000, (i) => `export const value${i} = ${i};`);
      writeFileSync(join(cwd, "big.ts"), before);
      const after = lines(8_000, (i) =>
        i % 2 === 0 ? `export const changed${i} = ${i * 3};` : `export const value${i} = ${i};`,
      );
      const started = performance.now();
      const result = await writeFile("big.ts", after, cwd);
      expect(performance.now() - started).toBeLessThan(3_000);
      expect(result.success).toBe(true);
      expect(result.diff?.additions).toBe(4_000);
      expect(result.diff?.removals).toBe(4_000);
      expect(result.output).toContain("+4000 -4000");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
