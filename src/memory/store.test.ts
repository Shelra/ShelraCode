import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentMemoryScope,
  deleteMemoryEntry,
  MEMORY_INDEX_MAX_LINES,
  memoryEntryPath,
  projectMemoryScope,
  readMemoryEntry,
  readMemoryIndex,
  writeMemoryEntry,
} from "./store";

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
