import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Decision } from "../ledger/types";
import {
  describeDoc,
  documentLines,
  rankDocs,
  readDocIndex,
  refreshDocIndex,
  replacementsFrom,
  staleness,
} from "./docs-index";
import { ensureMemoryDir, projectMemoryScope } from "./store";
import type { MemoryRecord } from "./types";

const dirs: string[] = [];
function repo(files: Record<string, string>, options: { git?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "shelra-docs-"));
  dirs.push(dir);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  if (options.git) spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FILES = {
  "README.md":
    "# Ledgerly\n\nAn offline expense tracker for freelancers. Nothing leaves your machine.\n\n## Storage\n\nOne JSON file per month under `data/`.\n",
  "CLAUDE.md": "# Working on Ledgerly\n\nRun `bun test` before you finish.\n",
  "docs/SECURITY.md":
    "# Security rules\n\nAPI tokens must never be written to logs. Redact the Authorization header before a request is logged.\n",
  "docs/ARCHITECTURE.md": "# Architecture\n\nStorage lives in `src/store.ts`, money in `src/money.ts`.\n",
  "docs/history/2025-plan.md": "# Old plan\n\nHistorical record of the first plan.\n",
  "docs/decisions/0001-x.md": "---\nid: D-0001\n---\nA decision.\n",
  "src/storage/store.ts": "export {};\n",
  "src/notes.md": "# Not a document place\n",
  "node_modules/pkg/README.md": "# Not ours\n",
};

const record = (title: string, hook: string, body = ""): MemoryRecord => ({
  slug: title.toLowerCase().replace(/\W+/gu, "-"),
  index: { title, hook, file: "x.md" },
  entry: {
    frontmatter: { name: "x", description: "", metadata: { type: "architecture", modified: "2026-07-06T12:00:00Z" } },
    body,
  },
});

const decision = (overrides: Partial<Decision>): Decision => ({
  id: "D-0001",
  title: "",
  status: "active",
  source: "agent",
  rule: "",
  scope: [],
  proposed: "2026-03-02",
  file: "docs/decisions/x.md",
  ...overrides,
});

describe("the document index (doc 21, Phase C)", () => {
  it("indexes the project's documents with title, summary and kind, and skips dependencies, other folders and the ledger", () => {
    for (const git of [false, true]) {
      const root = repo(FILES, { git });
      const index = refreshDocIndex(projectMemoryScope(root), root, { force: true });
      const byPath = new Map(index.entries.map((entry) => [entry.path, entry]));
      expect([...byPath.keys()].sort()).toEqual([
        "CLAUDE.md",
        "README.md",
        "docs/ARCHITECTURE.md",
        "docs/SECURITY.md",
        "docs/history/2025-plan.md",
      ]);
      expect(byPath.get("docs/SECURITY.md")).toMatchObject({
        title: "Security rules",
        kind: "guide",
        summary: expect.stringContaining("API tokens must never be written to logs"),
      });
      expect(byPath.get("CLAUDE.md")?.kind).toBe("instructions");
      expect(byPath.get("docs/history/2025-plan.md")?.kind).toBe("history");
      expect(byPath.get("docs/ARCHITECTURE.md")?.missingPaths).toEqual(["src/store.ts", "src/money.ts"]);
    }
  });

  it("leaves out what git ignores", () => {
    const root = repo(
      { ...FILES, ".gitignore": "docs/private/\n", "docs/private/notes.md": "# Private\n" },
      { git: true },
    );
    const index = refreshDocIndex(projectMemoryScope(root), root, { force: true });
    expect(index.entries.map((entry) => entry.path)).not.toContain("docs/private/notes.md");
  });

  it("does not read a document again when its size and time did not change, and saves only where memory exists", () => {
    const root = repo(FILES);
    const scope = projectMemoryScope(root);
    refreshDocIndex(scope, root, { force: true });
    expect(readDocIndex(scope).entries).toEqual([]);
    ensureMemoryDir(scope);
    refreshDocIndex(scope, root, { force: true });
    const first = readDocIndex(scope).entries.find((entry) => entry.path === "README.md");
    writeFileSync(join(root, "README.md"), "# Ledgerly\n\nChanged.\n");
    const later = new Date(Date.now() + 5_000);
    utimesSync(join(root, "README.md"), later, later);
    const second = refreshDocIndex(scope, root, { force: true }).entries.find((entry) => entry.path === "README.md");
    expect(first?.summary).toContain("offline expense tracker");
    expect(second?.summary).toBe("Changed.");
  });

  it("points a request to the document that holds its rule, with what it says, after the project's own description", () => {
    const root = repo(FILES);
    const index = refreshDocIndex(projectMemoryScope(root), root, { force: true });
    const ranked = rankDocs(index, "Add request logging to the HTTP client.", root, []);
    expect(ranked[0]?.entry.path).toBe("docs/SECURITY.md");
    const lines = documentLines(index, "Add request logging to the HTTP client.", root, []);
    expect(lines[0]).toBe(
      "- README.md: Ledgerly — An offline expense tracker for freelancers. Nothing leaves your machine.",
    );
    expect(lines).toContain(describeDoc(ranked[0] as (typeof ranked)[number]));
    expect(lines.join("\n")).toContain("docs/SECURITY.md: Security rules — API tokens must never be written to logs");
    // Pointed to, never loaded.
    expect(lines.at(-1)).toBe("- CLAUDE.md: instructions written for another agent; AGENTS.md wins where they differ.");
  });

  it("flags a document that still states a term a superseded decision or a replaced entry used", () => {
    const root = repo(FILES);
    const index = refreshDocIndex(projectMemoryScope(root), root, { force: true });
    const readme = index.entries.find((entry) => entry.path === "README.md");
    if (!readme) throw new Error("no README");
    readme.mtimeMs = Date.parse("2026-01-05T12:00:00Z");
    // The memory chain JSON → SQLite → DuckDB: the current entry's note names SQLite; the JSON note is one link back.
    const current = record(
      "Storage is DuckDB",
      "src/storage/store.ts saves data/ledger.duckdb",
      "DuckDB.\n\nReplaces: src/store.ts saves data/ledger.db through bun:sqlite (true until 2026-07-06).",
    );
    current.entry.frontmatter.metadata.supersedes = "storage-sqlite";
    const sqlite = record(
      "Storage is SQLite",
      "",
      "SQLite.\n\nReplaces: src/store.ts saves data/YYYY-MM.json; no database yet (true until 2026-03-02).",
    ).entry;
    sqlite.frontmatter.metadata.supersedes = "storage-json-files";
    const read = (slug: string) => (slug === "storage-sqlite" ? sqlite : null);
    expect(staleness(readme, root, replacementsFrom([current], []))).toBeNull();
    expect(staleness(readme, root, replacementsFrom([current], [], read))).toBe(
      'still says "json", replaced on 2026-03-02 (now: Storage is DuckDB)',
    );
    // When two replacements dropped the word, the document is stale since the first one.
    current.entry.body = current.entry.body.replace("bun:sqlite", "bun:sqlite, no JSON files");
    expect(staleness(readme, root, replacementsFrom([current], [], read))).toMatch(/replaced on 2026-03-02/u);
    // The ledger chain: SQLite was superseded by DuckDB; a document that says SQLite and never DuckDB is stale.
    writeFileSync(join(root, "docs/STORAGE.md"), "# Storage\n\nThe ledger is a SQLite file.\n");
    const storage = { ...readme, path: "docs/STORAGE.md", kind: "guide" as const };
    const fromLedger = replacementsFrom(
      [],
      [
        decision({
          id: "D-0001",
          title: "Storage uses SQLite through bun:sqlite",
          status: "superseded",
          supersededBy: "D-0002",
        }),
        decision({ id: "D-0002", title: "Storage uses DuckDB", approved: "2026-07-06", supersedes: "D-0001" }),
      ],
    );
    expect(staleness(storage, root, fromLedger)).toMatch(/^still says "sqlite", replaced on 2026-07-06/u);
    // A word the project still uses is not a dropped one.
    expect(fromLedger[0]?.dropped).not.toContain("storage");
  });

  it("does not flag a document edited after the replacement, one that names the new term, or history", () => {
    const root = repo({ ...FILES, "docs/MIGRATION.md": "# Migration\n\nWe moved from JSON files to DuckDB.\n" });
    const index = refreshDocIndex(projectMemoryScope(root), root, { force: true });
    const replaced = replacementsFrom(
      [record("Storage is DuckDB", "data/ledger.duckdb", "Replaces: one JSON file per month (true until 2020-01-01).")],
      [],
    );
    const readme = index.entries.find((entry) => entry.path === "README.md");
    expect(readme && staleness(readme, root, replaced)).toBeNull();
    const migration = index.entries.find((entry) => entry.path === "docs/MIGRATION.md");
    if (!migration) throw new Error("no migration doc");
    expect(staleness({ ...migration, mtimeMs: 0 }, root, replaced)).toBeNull();
    const history = index.entries.find((entry) => entry.kind === "history");
    expect(history && staleness({ ...history, mtimeMs: 0 }, root, replaced)).toBeNull();
  });

  it("flags missing paths only when a document names two or more in backticks, a third or more of those it names", () => {
    const current = ["a", "b", "c", "d", "e", "f"].map((name) => `src/${name}.ts`);
    const root = repo({
      ...FILES,
      ...Object.fromEntries(current.map((file) => [file, "export {};\n"])),
      "docs/ONE.md": "# One\n\nSee `src/gone.ts`, and src/also-gone.ts without backticks.\n",
      "docs/LOG.md": `# Log\n\n${current.map((file) => `\`${file}\``).join(", ")}; removed: \`src/old1.ts\`, \`src/old2.ts\`.\n`,
    });
    const log = refreshDocIndex(projectMemoryScope(root), root, { force: true }).entries.find(
      (entry) => entry.path === "docs/LOG.md",
    );
    expect(log && staleness(log, root, [])).toBeNull();
    const index = refreshDocIndex(projectMemoryScope(root), root, { force: true });
    const one = index.entries.find((entry) => entry.path === "docs/ONE.md");
    expect(one && staleness(one, root, [])).toBeNull();
    const architecture = index.entries.find((entry) => entry.path === "docs/ARCHITECTURE.md");
    expect(architecture && staleness(architecture, root, [])).toBe(
      "names paths that no longer exist (src/store.ts, src/money.ts)",
    );
  });
});
