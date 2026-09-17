import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMemoryContext, detectStaleness, rankMemories } from "./retrieval";
import { listMemoryRecords, projectMemoryScope, writeMemoryEntry } from "./store";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-memory-retrieval-"));
  mkdirSync(join(workspace, "src"), { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function seed(): void {
  const scope = projectMemoryScope(workspace);
  writeMemoryEntry(scope, {
    slug: "bun-test-preload",
    title: "Tests need the preload script",
    hook: "bun test needs --preload ./test/setup.ts or fixtures fail",
    type: "testing",
    description: "The test runner requires a preload script",
    body: "Run `bun test --preload ./test/setup.ts`; without it every fixture import fails with ENOENT.",
    source: "observed",
    confidence: 0.9,
    relatedFiles: ["test/setup.ts"],
    tags: ["bun", "tests"],
  });
  writeMemoryEntry(scope, {
    slug: "config-loader-normalizes-host",
    title: "Config loader trims HOST",
    hook: "loadConfig in src/config.ts trims HOST and falls back to 127.0.0.1",
    type: "important-codepaths",
    description: "Where host normalization lives",
    body: "src/config.ts `loadConfig` trims HOST; a blank HOST falls back to the default. Do not duplicate this in callers.",
    source: "inference",
    confidence: 0.7,
    relatedFiles: ["src/config.ts"],
  });
  writeMemoryEntry(scope, {
    slug: "user-prefers-spanish",
    title: "User prefers Spanish replies",
    hook: "Answer in Spanish when the user writes in Spanish",
    type: "preference",
    description: "Language preference",
    body: "The user instructed: answer in Spanish when they write in Spanish. Keep code and identifiers unchanged.",
    source: "human",
    confidence: 1,
  });
}

describe("memory retrieval", () => {
  it("ranks by lexical relevance, path overlap, and provenance", () => {
    seed();
    const records = listMemoryRecords(projectMemoryScope(workspace));
    const ranked = rankMemories(
      records,
      { text: "Fix the failing tests: bun test cannot find fixtures", paths: ["test/setup.ts"] },
      workspace,
    );
    expect(ranked[0]?.record.slug).toBe("bun-test-preload");
    expect(ranked[0]?.relevance).toBeGreaterThan(ranked[1]?.relevance ?? 0);
  });

  it("expands the relevant bodies within budget and lists the rest as pointers", () => {
    seed();
    const records = listMemoryRecords(projectMemoryScope(workspace));
    const context = buildMemoryContext(records, { text: "Change how HOST is parsed in src/config.ts" }, workspace, {
      maxEntries: 1,
    });
    expect(context.text).toContain("PROJECT MEMORY:");
    expect(context.expanded).toEqual(["config-loader-normalizes-host"]);
    expect(context.text).toContain("### Config loader trims HOST");
    expect(context.text).toContain("Other saved entries:");
    expect(context.listed).toEqual(expect.arrayContaining(["bun-test-preload", "user-prefers-spanish"]));
    expect(context.text).toContain("(user-prefers-spanish.md)");
  });

  it("flags an entry as stale when a related file changed after it was confirmed", () => {
    seed();
    const configPath = join(workspace, "src", "config.ts");
    writeFileSync(configPath, "export const x = 1;\n");
    const future = new Date(Date.now() + 60 * 60_000);
    utimesSync(configPath, future, future);
    const records = listMemoryRecords(projectMemoryScope(workspace));
    const config = records.find((record) => record.slug === "config-loader-normalizes-host");
    expect(config && detectStaleness(workspace, config)).toMatchObject({ stale: true });
    const context = buildMemoryContext(records, { text: "src/config.ts loadConfig HOST" }, workspace);
    expect(context.text).toContain("MAY BE STALE");
  });

  it("returns nothing for an empty store", () => {
    expect(buildMemoryContext([], { text: "anything" }, workspace)).toEqual({ text: "", expanded: [], listed: [] });
  });
});
