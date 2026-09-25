import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryCommand } from "./cli";
import { appendEpisode, episodeFrom } from "./episodes";
import { admitCandidates, extractUserDirectives } from "./reflection";
import { proposeProceduresAsSkills, skillPathFor } from "./skills";
import { creditMemoryUse, listMemoryRecords, projectMemoryScope, writeMemoryEntry } from "./store";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-memory-cli-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function seed(): void {
  const scope = projectMemoryScope(workspace);
  admitCandidates(scope, extractUserDirectives("Never touch the generated folder."));
  writeMemoryEntry(scope, {
    slug: "deploy-heroku",
    title: "Deploys go to Heroku",
    hook: "deploys run with git push heroku main",
    type: "procedure",
    description: "How to deploy",
    body: "Run `git push heroku main`; the release phase runs the migrations.",
    source: "observed",
    confidence: 0.9,
  });
  admitCandidates(scope, extractUserDirectives("We moved from Heroku to Fly.io."));
  writeMemoryEntry(scope, {
    slug: "test-preload",
    title: "Tests need the preload script",
    hook: "bun test needs --preload ./test/setup.ts or the fixtures are missing",
    type: "testing",
    description: "The test runner needs a preload script",
    body: "Run `bun test --preload ./test/setup.ts`; without it every fixture import fails with ENOENT.",
    source: "observed",
    confidence: 0.9,
  });
}

describe("shelra memory (doc 18 §4.5)", () => {
  it("lists the user's rules, what was learned, and counts what is no longer current", () => {
    expect(runMemoryCommand(workspace, "list").output).toContain("No memory saved yet");
    seed();
    const listed = runMemoryCommand(workspace, "list").output;
    expect(listed).toContain("Your rules for this project");
    expect(listed).toContain("Never touch the generated folder");
    expect(listed).toContain("What Shelra learned here (1):");
    expect(listed).toContain("test-preload");
    expect(listed).toContain("1 no longer current (superseded or archived): shelra memory list --all");
    expect(runMemoryCommand(workspace, "list", undefined, { all: true }).output).toMatch(
      /deploy-heroku[\s\S]*superseded until \d{4}-\d{2}-\d{2}, replaced by user-fix-/u,
    );
  });

  it("shows one entry with what replaced it, and says when there is none", () => {
    seed();
    const shown = runMemoryCommand(workspace, "show", "deploy-heroku");
    expect(shown.exitCode).toBe(0);
    expect(shown.output).toContain("procedure · observed 90% · superseded");
    expect(shown.output).toContain("replaced by: user-fix-");
    expect(shown.output).toContain("History:");
    expect(runMemoryCommand(workspace, "show", "no-such-entry")).toMatchObject({ exitCode: 1 });
    expect(runMemoryCommand(workspace, "show", "../escape")).toMatchObject({ exitCode: 2 });
  });

  it("explains what a request would be given, and why", () => {
    seed();
    appendEpisode(
      projectMemoryScope(workspace),
      episodeFrom(
        {
          userMessage: "Make the fixture tests pass",
          assistantText: "Done.",
          changedFiles: ["test/setup.ts"],
          commands: [
            { command: "bun test", success: false, output: "ENOENT fixtures" },
            { command: "bun test --preload ./test/setup.ts", success: true, output: "4 pass" },
          ],
          verified: true,
          toolCalls: 4,
        },
        "verified",
      ),
    );
    const explained = runMemoryCommand(workspace, "why", "the fixture tests fail again").output;
    expect(explained).toContain("Your rules, on every request:");
    expect(explained).toContain("Shown in full, most relevant first:");
    expect(explained).toMatch(/test-preload {2}\([\d.]+\) {2}terms: /u);
    expect(explained).toContain("Past attempts shown as lessons:");
    expect(runMemoryCommand(workspace, "why", "the fixture tests fail again", { full: true }).output).toContain(
      "PROJECT MEMORY:",
    );
    expect(runMemoryCommand(workspace, "why", "")).toMatchObject({ exitCode: 2 });
  });

  it("lists the skills waiting for approval and writes one only when the user promotes it", () => {
    const scope = projectMemoryScope(workspace);
    expect(runMemoryCommand(workspace, "skills").output).toContain("No skill waiting for approval");
    writeMemoryEntry(scope, {
      slug: "regenerate-client",
      title: "Regenerate the API client",
      hook: "after editing openapi.yaml run bun run codegen then bun test",
      type: "procedure",
      description: "Codegen",
      body: "1. Edit openapi.yaml\n2. Run `bun run codegen` (writes src/generated/)\n3. Run `bun test` and commit the generated client.",
      source: "observed",
      confidence: 0.9,
    });
    creditMemoryUse(scope, ["regenerate-client"], 1);
    creditMemoryUse(scope, ["regenerate-client"], 1);
    proposeProceduresAsSkills(scope, workspace, listMemoryRecords(scope));

    expect(runMemoryCommand(workspace, "skills").output).toContain("regenerate-client  Regenerate the API client");
    expect(runMemoryCommand(workspace, "stats").output).toContain("skills waiting for your approval: 1");
    expect(existsSync(skillPathFor(workspace, "regenerate-client"))).toBe(false);
    expect(runMemoryCommand(workspace, "promote", "regenerate-client")).toMatchObject({ exitCode: 0 });
    expect(existsSync(skillPathFor(workspace, "regenerate-client"))).toBe(true);
    expect(runMemoryCommand(workspace, "promote", "regenerate-client")).toMatchObject({ exitCode: 1 });
    expect(runMemoryCommand(workspace, "decline", "nothing-here")).toMatchObject({ exitCode: 1 });
  });

  it("counts the funnel from turns to entries", () => {
    seed();
    // A consolidation is not a reflection (review round 3).
    runMemoryCommand(workspace, "consolidate");
    const counted = runMemoryCommand(workspace, "stats").output;
    expect(counted).toContain("reflections: 0;");
    expect(counted).toContain("statements of yours kept: 2");
    expect(counted).toContain("no longer current: 1");
    expect(runMemoryCommand(workspace, "nonsense")).toMatchObject({ exitCode: 2 });
  });
});
