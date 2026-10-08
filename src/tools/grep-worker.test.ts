import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// The counters are read when the probe module loads: switch them on before anything imports it.
process.env.SHELRA_PERF_PROBE = "1";
const { executeGrep } = await import("./grep");
const { stopRipgrepWorker } = await import("./ripgrep-client");
const { perfSnapshot } = await import("../utils/perf-probe");

const root = mkdtempSync(join(tmpdir(), "shelra-grep-worker-"));
afterAll(() => {
  stopRipgrepWorker();
  rmSync(root, { recursive: true, force: true });
});

describe("grep on a worker thread", () => {
  it("searches off the main thread, so the terminal keeps running during the search", async () => {
    const eol = String.fromCharCode(10);
    for (let d = 0; d < 30; d += 1) {
      const dir = join(root, `dir${d}`);
      mkdirSync(dir);
      for (let f = 0; f < 40; f += 1) {
        writeFileSync(
          join(dir, `file${f}.ts`),
          Array.from({ length: 80 }, (_, i) => `export const v${i} = "needle ${d}-${f}-${i}";`).join(eol),
        );
      }
    }
    // The first search starts the worker and compiles ripgrep once.
    await executeGrep({ pattern: "needle 29-39-79" }, root);
    let last = performance.now();
    let longestGap = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      longestGap = Math.max(longestGap, now - last - 2);
      last = now;
    }, 2);
    const result = await executeGrep({ pattern: "needle" }, root);
    await new Promise((resolve) => setTimeout(resolve, 10));
    clearInterval(timer);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Found 96000 matches (showing first 100)");
    expect(perfSnapshot()["grep.offThread"]?.calls).toBeGreaterThanOrEqual(2);
    expect(perfSnapshot()["grep.inProcess"]).toBeUndefined();
    // Searching in-process held the loop for the whole search (hundreds of milliseconds here).
    expect(longestGap).toBeLessThan(100);
  });

  it("answers no match, and says so when the pattern itself cannot be read", async () => {
    expect((await executeGrep({ pattern: "zzz-not-there-zzz" }, root)).output).toBe("No matches found.");
    // An unreadable pattern used to be answered as "no matches", and the model concluded the code was absent (review
    // 2026-10-07): it is an error that names the pattern problem.
    const bad = await executeGrep({ pattern: "(" }, root);
    expect(bad.success).toBe(false);
    expect(bad.error).toContain("could not run this pattern");
  });
});
