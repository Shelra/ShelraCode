import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listMemoryRecords, projectMemoryScope, readMemoryHistory, readMemoryIndex } from "./store";

let scratch: string | undefined;
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe("concurrent project memory", () => {
  it("preserves every topic and index entry from five independent processes", () => {
    scratch = mkdtempSync(join(tmpdir(), "shelra-memory-writers-"));
    const store = new URL("./store.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1");
    const worker = join(scratch, "worker.ts");
    writeFileSync(
      worker,
      [
        `import { writeMemoryEntry, projectMemoryScope } from ${JSON.stringify(store)};`,
        "const [root, worker, start] = process.argv.slice(2);",
        "await Bun.sleep(Math.max(0, Number(start) - Date.now()));",
        "for (let i=0; i<20; i++) writeMemoryEntry(projectMemoryScope(root),",
        '{slug: "worker-"+worker+"-entry-"+i, title:"Architecture", hook:"An important project fact",',
        'type:"architecture", source:"human", description:"Fixture fact", body:"Uses explicit API boundaries."});',
      ].join("\n"),
      "utf8",
    );
    const runner = join(scratch, "runner.ts");
    writeFileSync(
      runner,
      [
        "const [worker, root] = process.argv.slice(2); const start = String(Date.now()+300);",
        "const children = Array.from({length:5}, (_, i) => Bun.spawn([process.execPath, worker, root, String(i), start],",
        '{stdout:"ignore", stderr:"inherit", env:{...process.env, SHELRA_DIAGNOSTICS_LOG:"off"}}));',
        "const codes = await Promise.all(children.map(x=>x.exited)); process.exit(codes.some(x=>x!==0)?1:0);",
      ].join("\n"),
      "utf8",
    );
    const result = spawnSync(process.versions.bun ? process.execPath : "bun", [runner, worker, scratch], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const scope = projectMemoryScope(scratch);
    expect(readMemoryIndex(scope).entries).toHaveLength(100);
    expect(listMemoryRecords(scope)).toHaveLength(100);
    const history = readMemoryHistory(scope);
    let lastWriter = "",
      burst = 0,
      largestBurst = 0;
    for (const event of history) {
      const writer = event.slug.split("-entry-")[0] ?? "";
      burst = writer === lastWriter ? burst + 1 : 1;
      lastWriter = writer;
      largestBurst = Math.max(largestBurst, burst);
    }
    // All five workers start together. A writer must yield to already waiting sessions between admissions.
    expect(largestBurst).toBeLessThan(20);
  }, 40_000);
});
