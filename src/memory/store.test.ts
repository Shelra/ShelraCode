import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectStaleness } from "./retrieval";
import {
  agentMemoryScope,
  deleteMemoryEntry,
  listMemoryRecords,
  MEMORY_INDEX_MAX_LINES,
  memoryEntryPath,
  projectMemoryScope,
  readMemoryEntry,
  readMemoryHistory,
  readMemoryIndex,
  readMemoryVersions,
  reconfirmByPassingCommands,
  recordMemoryUse,
  supersedeMemoryEntry,
  writeMemoryEntry,
} from "./store";
import type { MemoryRecord } from "./types";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-memory-test-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("memory store: reads on an empty project", () => {
  it("returns an empty index instead of throwing", () => {
    const result = readMemoryIndex(projectMemoryScope(workspace));
    expect(result).toEqual({ entries: [], raw: "", exists: false });
  });

  it("returns a missing entry instead of throwing", () => {
    const result = readMemoryEntry(projectMemoryScope(workspace), "nonexistent");
    expect(result).toEqual({ entry: null, exists: false });
  });
});

describe("memory store: write then read round-trip", () => {
  it("upserts a topic file and its index pointer", () => {
    const scope = projectMemoryScope(workspace);
    const result = writeMemoryEntry(scope, {
      slug: "flaky-sqlite-lock",
      title: "Flaky SQLite lock in CI",
      hook: "tool_results insert can deadlock under --pool=forks; see workaround",
      type: "known-problems",
      description: "Root cause and workaround for the intermittent SQLite lock error seen in CI.",
      body: "The lock only reproduces with --pool=forks. Workaround: --no-file-parallelism for that suite.",
    });

    expect(result.ok).toBe(true);

    const index = readMemoryIndex(scope);
    expect(index.exists).toBe(true);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]).toEqual({
      title: "Flaky SQLite lock in CI",
      file: "flaky-sqlite-lock.md",
      hook: "tool_results insert can deadlock under --pool=forks; see workaround",
    });

    const entry = readMemoryEntry(scope, "flaky-sqlite-lock");
    expect(entry.exists).toBe(true);
    expect(entry.entry?.frontmatter.name).toBe("flaky-sqlite-lock");
    expect(entry.entry?.frontmatter.metadata.type).toBe("known-problems");
    expect(entry.entry?.frontmatter.description).toBe(
      "Root cause and workaround for the intermittent SQLite lock error seen in CI.",
    );
    expect(typeof entry.entry?.frontmatter.metadata.modified).toBe("string");
    expect(entry.entry?.body).toContain("--no-file-parallelism");
  });

  it("re-writing the same slug replaces its index entry rather than duplicating it", () => {
    const scope = projectMemoryScope(workspace);
    writeMemoryEntry(scope, {
      slug: "build-note",
      title: "Build note",
      hook: "first version",
      type: "build",
      description: "first",
      body: "first body",
    });
    writeMemoryEntry(scope, {
      slug: "build-note",
      title: "Build note",
      hook: "second version",
      type: "build",
      description: "second",
      body: "second body",
    });

    const index = readMemoryIndex(scope);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].hook).toBe("second version");
    expect(readMemoryEntry(scope, "build-note").entry?.body.trim()).toBe("second body");
  });

  it("does not write a frontmatter `modified` value supplied by the caller", () => {
    const scope = projectMemoryScope(workspace);
    writeMemoryEntry(scope, {
      slug: "decision-one",
      title: "Decision one",
      hook: "why we picked X",
      type: "decisions",
      description: "desc",
      body: "body",
    });
    const modified = readMemoryEntry(scope, "decision-one").entry?.frontmatter.metadata.modified;
    expect(modified).toBeDefined();
    expect(() => new Date(modified as string).toISOString()).not.toThrow();
  });
});

describe("memory store: index cap", () => {
  it("refuses a write that would push the index past the line cap, without corrupting it", () => {
    const scope = projectMemoryScope(workspace);
    for (let i = 0; i < MEMORY_INDEX_MAX_LINES; i++) {
      const result = writeMemoryEntry(scope, {
        slug: `topic-${i}`,
        title: `Topic ${i}`,
        hook: "filler entry for the cap test",
        type: "conventions",
        description: "filler",
        body: "filler",
      });
      expect(result.ok).toBe(true);
    }

    const beforeOverflow = readMemoryIndex(scope);
    expect(beforeOverflow.entries).toHaveLength(MEMORY_INDEX_MAX_LINES);

    const overflow = writeMemoryEntry(scope, {
      slug: "one-too-many",
      title: "One too many",
      hook: "should be refused",
      type: "conventions",
      description: "filler",
      body: "filler",
    });

    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.reason).toBe("index_cap_exceeded");
      expect(overflow.capLines).toBe(MEMORY_INDEX_MAX_LINES);
    }

    // The refused write must not have touched the index or created the topic file.
    const afterOverflow = readMemoryIndex(scope);
    expect(afterOverflow.entries).toHaveLength(MEMORY_INDEX_MAX_LINES);
    expect(readMemoryEntry(scope, "one-too-many").exists).toBe(false);
  });
});

describe("memory store: agent scope isolation", () => {
  it("keeps agent-scoped memory out of the project index and out of other agents' indexes", () => {
    const project = projectMemoryScope(workspace);
    const explore = agentMemoryScope(workspace, "explore");
    const plan = agentMemoryScope(workspace, "plan");

    writeMemoryEntry(project, {
      slug: "project-fact",
      title: "Project fact",
      hook: "shared across agents",
      type: "architecture",
      description: "desc",
      body: "body",
    });
    writeMemoryEntry(explore, {
      slug: "explore-fact",
      title: "Explore fact",
      hook: "only for the explore agent",
      type: "important-codepaths",
      description: "desc",
      body: "body",
    });
    writeMemoryEntry(plan, {
      slug: "plan-fact",
      title: "Plan fact",
      hook: "only for the plan agent",
      type: "decisions",
      description: "desc",
      body: "body",
    });

    expect(readMemoryIndex(project).entries.map((e) => e.file)).toEqual(["project-fact.md"]);
    expect(readMemoryIndex(explore).entries.map((e) => e.file)).toEqual(["explore-fact.md"]);
    expect(readMemoryIndex(plan).entries.map((e) => e.file)).toEqual(["plan-fact.md"]);

    expect(readMemoryEntry(project, "explore-fact").exists).toBe(false);
    expect(readMemoryEntry(explore, "plan-fact").exists).toBe(false);
    expect(readMemoryEntry(plan, "project-fact").exists).toBe(false);
  });
});

describe("memory store: delete (the 'forget' operation)", () => {
  it("removes both the index entry and the topic file", () => {
    const scope = projectMemoryScope(workspace);
    writeMemoryEntry(scope, {
      slug: "wrong-assumption",
      title: "Wrong assumption",
      hook: "Turned out to be false",
      type: "decisions",
      description: "desc",
      body: "body",
    });

    const result = deleteMemoryEntry(scope, "wrong-assumption");

    expect(result).toEqual({ ok: true });
    expect(readMemoryIndex(scope).entries).toHaveLength(0);
    expect(readMemoryEntry(scope, "wrong-assumption")).toEqual({ entry: null, exists: false });
    expect(existsSync(memoryEntryPath(scope, "wrong-assumption"))).toBe(false);
  });

  it("removes only the targeted entry, leaving siblings in the index intact", () => {
    const scope = projectMemoryScope(workspace);
    writeMemoryEntry(scope, {
      slug: "keep-me",
      title: "Keep me",
      hook: "still valid",
      type: "conventions",
      description: "desc",
      body: "body",
    });
    writeMemoryEntry(scope, {
      slug: "remove-me",
      title: "Remove me",
      hook: "no longer valid",
      type: "conventions",
      description: "desc",
      body: "body",
    });

    deleteMemoryEntry(scope, "remove-me");

    const index = readMemoryIndex(scope);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].file).toBe("keep-me.md");
    expect(readMemoryEntry(scope, "keep-me").exists).toBe(true);
  });

  it("returns not_found instead of throwing for a slug that was never saved", () => {
    const scope = projectMemoryScope(workspace);
    const result = deleteMemoryEntry(scope, "never-existed");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("is self-healing: cleans up an index line even if its topic file was already removed by hand", () => {
    const scope = projectMemoryScope(workspace);
    writeMemoryEntry(scope, {
      slug: "half-corrupted",
      title: "Half corrupted",
      hook: "hook",
      type: "known-problems",
      description: "desc",
      body: "body",
    });
    // Simulate the topic file having been deleted outside the store's own API.
    rmSync(memoryEntryPath(scope, "half-corrupted"), { force: true });
    expect(readMemoryIndex(scope).entries).toHaveLength(1);

    const result = deleteMemoryEntry(scope, "half-corrupted");

    expect(result).toEqual({ ok: true });
    expect(readMemoryIndex(scope).entries).toHaveLength(0);
  });

  it("does not touch other scopes' memory", () => {
    const project = projectMemoryScope(workspace);
    const explore = agentMemoryScope(workspace, "explore");
    writeMemoryEntry(project, {
      slug: "shared-name",
      title: "Project entry",
      hook: "hook",
      type: "architecture",
      description: "desc",
      body: "body",
    });
    writeMemoryEntry(explore, {
      slug: "shared-name",
      title: "Explore entry",
      hook: "hook",
      type: "important-codepaths",
      description: "desc",
      body: "body",
    });

    deleteMemoryEntry(project, "shared-name");

    expect(readMemoryEntry(project, "shared-name").exists).toBe(false);
    expect(readMemoryEntry(explore, "shared-name").exists).toBe(true);
  });
});

describe("memory store: re-confirmation by a passing command (audit doc 15, M2)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-confirms only entries that name the exact command, which clears staleness from a later file change", () => {
    const scope = projectMemoryScope(workspace);
    const write = (slug: string, body: string) =>
      writeMemoryEntry(scope, {
        slug,
        title: slug,
        hook: `hook for ${slug}`,
        type: "testing",
        description: "d",
        body,
        relatedFiles: ["test/setup.ts"],
      });
    write("preload-tests", "Run `bun test --preload ./test/setup.ts`; without it fixture imports fail with ENOENT.");
    write("plain-tests", "The suite runs with `bun test` from the repository root, nothing else is needed.");
    write("no-command", "The fixtures live under test/fixtures and are regenerated by hand when schemas change.");
    // The related file changes after the entries were written: all three read as stale.
    mkdirSync(join(workspace, "test"), { recursive: true });
    writeFileSync(join(workspace, "test", "setup.ts"), "export {};\n");
    const later = new Date(Date.now() + 30_000);
    utimesSync(join(workspace, "test", "setup.ts"), later, later);
    const record = () => listMemoryRecords(scope).find((item) => item.slug === "preload-tests");
    const afterChange = new Date(Date.now() + 60_000);
    expect(detectStaleness(workspace, record() as MemoryRecord, afterChange.getTime()).stale).toBe(true);

    vi.useFakeTimers();
    vi.setSystemTime(afterChange);
    const confirmed = reconfirmByPassingCommands(scope, ["bun  test --preload ./test/setup.ts", "ls -la"]);

    expect(confirmed).toEqual(["preload-tests"]);
    expect(detectStaleness(workspace, record() as MemoryRecord, afterChange.getTime()).stale).toBe(false);
    // `bun test` passing says nothing for the entry that insists on the preload flag, and the reverse.
    expect(reconfirmByPassingCommands(scope, ["bun test"])).toEqual(["plain-tests"]);
    expect(reconfirmByPassingCommands(scope, [])).toEqual([]);
  });
});

describe("memory store: time (doc 18 §4.4)", () => {
  const fact = (slug: string, hook: string, body = `${hook}. Checked against the repository.`) => ({
    slug,
    title: hook,
    hook,
    type: "architecture" as const,
    description: hook,
    body,
    source: "observed" as const,
  });

  it("retires a superseded fact from the index and keeps it readable, with what replaced it and when", () => {
    const scope = projectMemoryScope(workspace);
    writeMemoryEntry(scope, fact("deploy-heroku", "Deploys go to Heroku with git push heroku main"));
    writeMemoryEntry(scope, fact("deploy-fly", "Deploys go to Fly.io with fly deploy"));

    expect(supersedeMemoryEntry(scope, "deploy-heroku", "deploy-fly", "the user: we moved from Heroku to Fly.io")).toBe(
      true,
    );

    expect(listMemoryRecords(scope).map((record) => record.slug)).toEqual(["deploy-fly"]);
    const old = readMemoryEntry(scope, "deploy-heroku").entry;
    expect(old?.frontmatter.metadata).toMatchObject({ status: "superseded", supersededBy: "deploy-fly" });
    expect(old?.frontmatter.metadata.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const next = readMemoryEntry(scope, "deploy-fly").entry;
    expect(next?.frontmatter.metadata.supersedes).toBe("deploy-heroku");
    expect(next?.body).toContain("Replaces: Deploys go to Heroku with git push heroku main (true until ");
    expect(readMemoryHistory(scope).at(-1)).toMatchObject({ event: "superseded", slug: "deploy-heroku" });
    // Twice is once; a missing entry is refused.
    expect(supersedeMemoryEntry(scope, "deploy-heroku", "deploy-fly")).toBe(true);
    expect(readMemoryEntry(scope, "deploy-fly").entry?.body.match(/Replaces:/gu)).toHaveLength(1);
    expect(supersedeMemoryEntry(scope, "nope", "deploy-fly")).toBe(false);
  });

  it("keeps what an entry said before each rewrite", () => {
    const scope = projectMemoryScope(workspace);
    writeMemoryEntry(scope, fact("auth", "Auth uses Firebase", "Login goes through Firebase Auth, see src/auth.ts."));
    writeMemoryEntry(scope, fact("auth", "Auth uses Supabase", "Login goes through Supabase Auth, see src/auth.ts."));
    writeMemoryEntry(scope, fact("auth", "Auth uses Supabase", "Login goes through Supabase Auth, see src/auth.ts."));

    const versions = readMemoryVersions(scope, "auth");
    expect(versions.map((version) => version.body.trim())).toEqual([
      "Login goes through Firebase Auth, see src/auth.ts.",
    ]);
    expect(readMemoryEntry(scope, "auth").entry?.body).toContain("Supabase");
  });
});

describe("memory store: what strengthens a memory (review round 3)", () => {
  it("counts being shown as exposure, and using what an entry says as a recall", () => {
    const scope = projectMemoryScope(workspace);
    writeMemoryEntry(scope, {
      slug: "seed-first",
      title: "Seed before the tests",
      hook: "run `make seed` before `bun test`",
      type: "procedure",
      description: "Seed first",
      body: "Run `make seed` before `bun test`; the tests read the seeded rows.",
      source: "observed",
    });
    recordMemoryUse(scope, ["seed-first"]);
    expect(readMemoryEntry(scope, "seed-first").entry?.frontmatter.metadata).toMatchObject({ uses: 1 });
    expect(readMemoryEntry(scope, "seed-first").entry?.frontmatter.metadata.recalls).toBeUndefined();
    expect(reconfirmByPassingCommands(scope, ["make seed"])).toEqual(["seed-first"]);
    expect(readMemoryEntry(scope, "seed-first").entry?.frontmatter.metadata.recalls).toHaveLength(1);
  });
});
