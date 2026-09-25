import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consolidateMemory } from "./consolidate";
import { appendEpisode, episodeFrom } from "./episodes";
import { buildMemoryContext } from "./retrieval";
import {
  listArchivedEntries,
  listMemoryRecords,
  projectMemoryScope,
  readMemoryEntry,
  recallArchivedEntry,
  writeMemoryEntry,
} from "./store";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-memory-consolidate-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60_000;

function failingTurn(request: string, at: string) {
  return {
    ...episodeFrom(
      {
        userMessage: request,
        assistantText: "Done.",
        changedFiles: ["src/app.ts"],
        commands: [
          { command: "npm test", success: false, output: 'npm ERR! Missing script: "test"' },
          { command: "bun test", success: true, output: "4 pass" },
        ],
        verified: true,
        toolCalls: 6,
      },
      "verified",
    ),
    at,
  };
}

describe("memory consolidation, like sleep (doc 18 §4.6)", () => {
  it("turns a failure repeated across turns into one lesson, stronger the more it happened", () => {
    const scope = projectMemoryScope(workspace);
    appendEpisode(scope, failingTurn("Add the export button", "2026-09-20T10:00:00.000Z"));
    appendEpisode(scope, failingTurn("Fix the date picker", "2026-09-22T10:00:00.000Z"));
    appendEpisode(scope, failingTurn("Rename the settings page", "2026-09-24T10:00:00.000Z"));

    const report = consolidateMemory(scope, { force: true });

    expect(report.ran).toBe(true);
    expect(report.lessons).toHaveLength(1);
    const lesson = listMemoryRecords(scope)[0];
    expect(lesson?.index.hook).toBe("`npm test` failed in 3 turns; what worked: `bun test`");
    expect(lesson?.entry.frontmatter.metadata).toMatchObject({ type: "failure", source: "observed" });
    expect(lesson?.entry.frontmatter.metadata.importance).toBeCloseTo(0.65);
    // Once a day at most.
    expect(consolidateMemory(scope).ran).toBe(false);
  });

  it("lets an unused inference fade into the archive, and a matching request bring it back", () => {
    const scope = projectMemoryScope(workspace);
    const note = (slug: string, hook: string, source: "inference" | "human" = "inference") =>
      writeMemoryEntry(scope, {
        slug,
        title: hook,
        hook,
        type: "conventions",
        description: hook,
        body: `${hook}. Seen while working on the reports module.`,
        source,
        confidence: 0.6,
      });
    note("reports-csv-bom", "the reports CSV export writes a UTF-8 BOM for Excel");
    note("user-rule-never-touch-generated", "Never touch the generated folder", "human");
    const later = Date.now() + 200 * DAY;

    const report = consolidateMemory(scope, { force: true, now: later });

    expect(report.archived).toEqual(["reports-csv-bom"]);
    expect(listMemoryRecords(scope).map((record) => record.slug)).toEqual(["user-rule-never-touch-generated"]);
    const archived = listArchivedEntries(scope);
    expect(archived.map((item) => item.slug)).toEqual(["reports-csv-bom"]);

    // A request that matches it is offered it back; reading it restores it.
    const context = buildMemoryContext(
      listMemoryRecords(scope),
      { text: "the CSV export for Excel is broken" },
      workspace,
      {
        archived,
      },
    );
    expect(context.faded).toEqual(["reports-csv-bom"]);
    expect(context.text).toContain("Faded from disuse but matching this request");
    expect(recallArchivedEntry(scope, "reports-csv-bom")).toBe(true);
    expect(listMemoryRecords(scope).map((record) => record.slug)).toContain("reports-csv-bom");
    expect(readMemoryEntry(scope, "reports-csv-bom").entry?.frontmatter.metadata.status ?? "active").toBe("active");
    expect(listArchivedEntries(scope)).toEqual([]);
  });
});

describe("what consolidation must not learn (review round 3)", () => {
  it("does not turn a test that went red then green into a failure lesson", () => {
    const scope = projectMemoryScope(workspace);
    const redGreen = (request: string, at: string) => ({
      ...episodeFrom(
        {
          userMessage: request,
          assistantText: "Fixed.",
          changedFiles: ["src/a.ts"],
          commands: [
            { command: "bun test src/a.test.ts", success: false, output: "1 fail" },
            { command: "bun test src/a.test.ts", success: true, output: "3 pass" },
          ],
          verified: true,
          toolCalls: 5,
        },
        "verified",
      ),
      at,
    });
    appendEpisode(scope, redGreen("Fix the parser", "2026-09-20T10:00:00.000Z"));
    appendEpisode(scope, redGreen("Fix the lexer", "2026-09-22T10:00:00.000Z"));
    expect(consolidateMemory(scope, { force: true }).lessons).toEqual([]);
  });
});
