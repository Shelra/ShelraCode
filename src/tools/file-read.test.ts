import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { READ_DEFAULT_LINES, READ_MAX_CHARS, READ_MAX_LINE_CHARS, readFile } from "./file";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "shelra-read-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fileOf(name: string, lines: string[]): Promise<string> {
  await writeFile(path.join(dir, name), lines.join("\n"));
  return name;
}

const numbered = (count: number, text = "const value = 1;") => Array.from({ length: count }, () => text);

describe("readFile", () => {
  it("returns a small file whole, with its header", async () => {
    const name = await fileOf("small.ts", ["a", "b", "c"]);
    const result = readFile(name, dir);
    expect(result.success).toBe(true);
    expect(result.output).toBe(`[${name}: lines 1-3 of 3]\n1 | a\n2 | b\n3 | c`);
  });

  it("stops a read without a range after the default line count and says where to go on", async () => {
    const name = await fileOf("long.ts", numbered(READ_DEFAULT_LINES + 500));
    const result = readFile(name, dir);
    expect(result.output.startsWith(`[${name}: lines 1-${READ_DEFAULT_LINES} of ${READ_DEFAULT_LINES + 500}]`)).toBe(
      true,
    );
    expect(result.output).toContain(`${READ_DEFAULT_LINES} | const value = 1;`);
    expect(result.output).not.toContain(`${READ_DEFAULT_LINES + 1} | `);
    expect(result.output).toContain(`500 more lines not shown: read on with start_line=${READ_DEFAULT_LINES + 1}`);
  });

  it("keeps any read within the character budget, even a requested range", async () => {
    // 1,000 lines of 200 characters: about 200,000 characters, four times the budget.
    const name = await fileOf("wide.md", numbered(1_000, "x".repeat(200)));
    const result = readFile(name, dir, 1, 1_000);
    expect(result.output.length).toBeLessThan(READ_MAX_CHARS + 500);
    const shown = Number(/lines 1-(\d+) of 1000/.exec(result.output)?.[1]);
    expect(shown).toBeGreaterThan(100);
    expect(shown).toBeLessThan(1_000);
    expect(result.output).toContain(`read on with start_line=${shown + 1}`);
  });

  it("cuts a single overlong line instead of spending the budget on it", async () => {
    const name = await fileOf("min.js", ["y".repeat(READ_MAX_LINE_CHARS * 3), "next"]);
    const result = readFile(name, dir);
    expect(result.output).toContain(`[line cut at ${READ_MAX_LINE_CHARS} characters]`);
    expect(result.output).toContain("2 | next");
    expect(result.output.length).toBeLessThan(READ_MAX_LINE_CHARS + 200);
  });

  it("returns exactly the requested range when it fits", async () => {
    const name = await fileOf("range.ts", ["one", "two", "three", "four", "five"]);
    expect(readFile(name, dir, 2, 3).output).toBe(`[${name}: lines 2-3 of 5]\n2 | two\n3 | three`);
  });

  it("says when the requested start is past the end", async () => {
    const name = await fileOf("short.ts", ["one", "two"]);
    const result = readFile(name, dir, 9);
    expect(result.success).toBe(true);
    expect(result.output).toBe(`[${name}: 2 lines; line 9 is past the end]`);
  });
});
