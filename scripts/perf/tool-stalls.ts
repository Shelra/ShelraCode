/**
 * How long the real file tools hold the event loop on large inputs: while one runs, the terminal cannot redraw,
 * take a key or cancel. Each case reports the longest gap in a 2 ms timer while the tool ran.
 *
 *   bun run scripts/perf/tool-stalls.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "shelra-tool-stalls-"));
const home = join(scratch, "home");
const cwd = join(scratch, "project");
mkdirSync(home, { recursive: true });
mkdirSync(cwd, { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.SHELRA_TRACE = "off";

const { readFile, writeFile, editFile } = await import("../../src/tools/file");
const { executeGrep } = await import("../../src/tools/grep");

const lines = (count: number, make: (i: number) => string) =>
  Array.from({ length: count }, (_, i) => make(i)).join("\n");

async function measure<T>(
  name: string,
  fn: () => T | Promise<T>,
): Promise<{ name: string; wallMs: number; maxGapMs: number }> {
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last - 2);
    last = now;
  }, 2);
  await new Promise((r) => setTimeout(r, 20));
  maxGap = 0;
  last = performance.now();
  const started = performance.now();
  await fn();
  const wallMs = performance.now() - started;
  await new Promise((r) => setTimeout(r, 10));
  clearInterval(timer);
  return { name, wallMs: Math.round(wallMs), maxGapMs: Math.round(maxGap) };
}

const rows = [];
// A repository-sized tree: the model greps it.
for (let d = 0; d < 60; d += 1) {
  const dir = join(cwd, "tree", `dir${d}`);
  mkdirSync(dir, { recursive: true });
  for (let f = 0; f < 50; f += 1)
    writeFileSync(
      join(dir, `file${f}.ts`),
      lines(60, (i) => `export const v${i} = "needle ${d}-${f}-${i}";`),
    );
}
rows.push(await measure("grep: 3,000 files, 180,000 matching lines", () => executeGrep({ pattern: "needle" }, cwd)));
rows.push(await measure("grep: 3,000 files, one match", () => executeGrep({ pattern: "needle 59-49-59" }, cwd)));

// A 32 MiB log: the model reads one page of it.
const huge = join(cwd, "huge.log");
writeFileSync(
  huge,
  lines(400_000, (i) => `2026-10-06T12:00:00Z INFO request ${i} handled in ${i % 97} ms by worker ${i % 13}`),
);
rows.push(await measure("read_file: first page of a 32 MiB file", () => readFile("huge.log", cwd, 1, 200)));
rows.push(await measure("read_file: page near the end of it", () => readFile("huge.log", cwd, 399_000, 399_200)));

// Rewriting a big source file: the diff the transcript shows is computed in-line.
const before = lines(8_000, (i) => `export const value${i} = ${i}; // line ${i}`);
const afterFew = lines(8_000, (i) =>
  i % 400 === 0 ? `export const value${i} = -1;` : `export const value${i} = ${i}; // line ${i}`,
);
const afterMost = lines(8_000, (i) =>
  i % 2 === 0 ? `export const changed${i} = ${i * 3};` : `export const value${i} = ${i}; // line ${i}`,
);
writeFileSync(join(cwd, "big.ts"), before);
rows.push(await measure("write_file: 8,000 lines, 20 lines changed", () => writeFile("big.ts", afterFew, cwd)));
writeFileSync(join(cwd, "big.ts"), before);
rows.push(await measure("write_file: 8,000 lines, half of them changed", () => writeFile("big.ts", afterMost, cwd)));
writeFileSync(join(cwd, "big2.ts"), before);
rows.push(
  await measure("edit_file: one line of an 8,000-line file", () =>
    editFile("big2.ts", "export const value4000 = 4000;", "export const value4000 = 1;", cwd),
  ),
);

console.log(JSON.stringify(rows, null, 2));
try {
  rmSync(scratch, { recursive: true, force: true });
} catch {
  /* nothing to do */
}
process.exit(0);
