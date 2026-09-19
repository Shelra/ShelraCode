import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectMemoryScope, userMemoryScope, writeMemoryEntry } from "../memory/store";
import { buildKnowledge, formatAge } from "./knowledge";

let home: string;
let workspace: string;
const previousRoot = process.env.SHELRA_USER_MEMORY_ROOT;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "shelra-know-home-"));
  workspace = mkdtempSync(join(tmpdir(), "shelra-know-project-"));
  process.env.SHELRA_USER_MEMORY_ROOT = home;
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.SHELRA_USER_MEMORY_ROOT;
  else process.env.SHELRA_USER_MEMORY_ROOT = previousRoot;
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe("buildKnowledge", () => {
  it("lists project memory grouped by type with provenance and usage", () => {
    writeMemoryEntry(projectMemoryScope(workspace), {
      slug: "run-tests-with-bun",
      title: "Run tests with bun",
      hook: "bun test is the test command",
      type: "testing",
      description: "How tests run here",
      body: "Use `bun test`; vitest is not installed.",
      source: "observed",
      confidence: 0.9,
    });
    writeMemoryEntry(projectMemoryScope(workspace), {
      slug: "no-default-exports",
      title: "No default exports",
      hook: "Named exports only",
      type: "conventions",
      description: "Code style",
      body: "Never use default exports.",
      source: "human",
      confidence: 1,
    });

    const { memory } = buildKnowledge(workspace);
    expect(memory.map((row) => row.type)).toEqual(["conventions", "testing"]);
    const tests = memory.find((row) => row.slug === "run-tests-with-bun");
    expect(tests).toMatchObject({ title: "Run tests with bun", scope: "project", stale: null });
    expect(tests?.facts).toContain("observed");
    expect(tests?.facts).toContain("90%");
    expect(tests?.facts).toContain("used 0×");
    expect(tests?.body).toContain("bun test");
  });

  it("flags a memory whose related file changed after it was confirmed", () => {
    writeFileSync(join(workspace, "auth.ts"), "export {};\n");
    writeMemoryEntry(projectMemoryScope(workspace), {
      slug: "auth-flow",
      title: "Auth flow",
      hook: "How auth works",
      type: "architecture",
      description: "d",
      body: "b",
      relatedFiles: ["auth.ts"],
    });
    const { memory } = buildKnowledge(workspace, Date.now() + 10_000);
    // Untouched since it was written: not stale.
    expect(memory[0]?.stale).toBeNull();
    rmSync(join(workspace, "auth.ts"));
    expect(buildKnowledge(workspace).memory[0]?.stale).toContain("no longer exists");
  });

  it("keeps user-wide memory separate from the project's", () => {
    writeMemoryEntry(userMemoryScope(), {
      slug: "answer-in-spanish",
      title: "Answer in Spanish",
      hook: "Answers in Spanish",
      type: "preference",
      description: "d",
      body: "b",
      source: "human",
    });
    const knowledge = buildKnowledge(workspace);
    expect(knowledge.user.map((row) => row.slug)).toEqual(["answer-in-spanish"]);
    expect(knowledge.memory).toEqual([]);
  });

  it("discovers project skills with their location", () => {
    const dir = join(workspace, ".agents", "skills", "release-notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      "---\nname: release-notes\ndescription: Drafts release notes from merged pull requests and tags.\n---\nBody\n",
    );
    const skill = buildKnowledge(workspace).skills.find((row) => row.name === "release-notes");
    expect(skill).toMatchObject({ scope: "project" });
    expect(skill?.location).toContain("release-notes");
  });
});

describe("formatAge", () => {
  it("speaks in days, months and years", () => {
    const now = Date.parse("2026-09-19T12:00:00Z");
    expect(formatAge("2026-09-19T01:00:00Z", now)).toBe("today");
    expect(formatAge("2026-09-18T01:00:00Z", now)).toBe("yesterday");
    expect(formatAge("2026-09-09T01:00:00Z", now)).toBe("10d ago");
    expect(formatAge("2026-05-19T01:00:00Z", now)).toBe("4mo ago");
    expect(formatAge("2024-05-19T01:00:00Z", now)).toBe("2y ago");
    expect(formatAge(undefined, now)).toBeNull();
  });
});
