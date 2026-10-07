import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileIndex } from "./file-index";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("FileIndex", () => {
  it("finds a project file by name and leaves the event loop free while it lists the project", async () => {
    const root = mkdtempSync(join(tmpdir(), "shelra-file-index-"));
    roots.push(root);
    spawnSync("git", ["init", "-q"], { cwd: root, windowsHide: true });
    mkdirSync(join(root, "src"));
    for (let i = 0; i < 200; i += 1) writeFileSync(join(root, "src", `file-${i}.ts`), "x");
    writeFileSync(join(root, "src", "needle.ts"), "x");
    writeFileSync(join(root, "logo.png"), "x");
    const previousCeiling = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = tmpdir();
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 1);
    try {
      const index = new FileIndex(root);
      expect(await index.match("needle", 5)).toEqual(["src/needle.ts"]);
      // Binary files never reach the suggestions.
      expect(await index.match("logo", 5)).toEqual([]);
    } finally {
      clearInterval(timer);
      if (previousCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
      else process.env.GIT_CEILING_DIRECTORIES = previousCeiling;
    }
    expect(ticks).toBeGreaterThan(0);
  });

  it("lists the project once for many concurrent matches", async () => {
    const root = mkdtempSync(join(tmpdir(), "shelra-file-index-"));
    roots.push(root);
    spawnSync("git", ["init", "-q"], { cwd: root, windowsHide: true });
    writeFileSync(join(root, "alpha.ts"), "x");
    const index = new FileIndex(root);
    const first = index.refresh();
    const second = index.refresh();
    expect(second).toBe(first);
    const results = await Promise.all(["a", "al", "alp", "alph"].map((query) => index.match(query)));
    for (const found of results) expect(found).toContain("alpha.ts");
  });
});
