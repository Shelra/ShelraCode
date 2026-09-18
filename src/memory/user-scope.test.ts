import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMemoryForChat } from "./report";
import { buildMemoryContext } from "./retrieval";
import {
  listMemoryRecords,
  listUserMemoryRecords,
  projectMemoryScope,
  userMemoryScope,
  writeMemoryEntry,
} from "./store";

let home: string;
let workspace: string;
const previousRoot = process.env.SHELRA_USER_MEMORY_ROOT;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "shelra-user-memory-"));
  workspace = mkdtempSync(join(tmpdir(), "shelra-project-"));
  process.env.SHELRA_USER_MEMORY_ROOT = home;
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.SHELRA_USER_MEMORY_ROOT;
  else process.env.SHELRA_USER_MEMORY_ROOT = previousRoot;
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

function writeUserPreference() {
  const result = writeMemoryEntry(userMemoryScope(), {
    slug: "answer-in-spanish",
    title: "Answer in Spanish",
    hook: "The user wants every answer written in Spanish",
    type: "conventions",
    description: "Standing preference stated by the user; applies in every project",
    body: "Write all answers in Spanish; code identifiers stay in English.",
    confidence: 1,
    source: "human",
  });
  expect(result.ok).toBe(true);
}

describe("user-wide memory scope", () => {
  it("stores under the overridden home and lists records marked as user-wide", () => {
    writeUserPreference();
    expect(userMemoryScope().workspace).toBe(home);
    const records = listUserMemoryRecords();
    expect(records.map((record) => record.slug)).toEqual(["answer-in-spanish"]);
    expect(records[0]?.origin).toBe("user");
    // The project store is untouched.
    expect(listMemoryRecords(projectMemoryScope(workspace))).toEqual([]);
  });

  it("is retrieved into a turn's memory context and labelled", () => {
    writeUserPreference();
    const context = buildMemoryContext(
      listUserMemoryRecords(),
      { text: "answer the question in spanish", paths: [] },
      workspace,
    );
    expect(context.expanded).toEqual(["answer-in-spanish"]);
    expect(context.text).toContain("user-wide");
  });

  it("appears in the /memory report even when the project has no memory", () => {
    writeUserPreference();
    const report = formatMemoryForChat(workspace);
    expect(report).toContain("User-wide memory (1 entry)");
    expect(report).toContain("answer-in-spanish");
  });
});
