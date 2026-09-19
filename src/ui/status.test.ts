import { describe, expect, it } from "vitest";
import type { KernelState } from "../agent/kernel";
import type { ChatEntry } from "../types/index";
import { explainError } from "./activity";
import {
  type CheckSummary,
  projectTranscript,
  summarizeChanges,
  summarizeChecks,
  turnSummaryGroups,
  workStatus,
} from "./observability";

function kernel(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "t",
    objective: "o",
    phase: "observe",
    scope: [],
    mutations: [],
    observations: [],
    attemptCount: 1,
    verificationPassed: false,
    reviewPassed: false,
    ...overrides,
  };
}

const passing: CheckSummary = { command: "bun test", label: "tests", tone: "success", meta: "5 pass · 1.1s" };
const failing: CheckSummary = { command: "bun test", label: "tests", tone: "danger", meta: "3 pass · 2 fail" };

describe("workStatus", () => {
  it("says Working while a turn runs, whatever else is true", () => {
    expect(
      workStatus({ kernel: kernel({ phase: "complete" }), isProcessing: true, changedCount: 0, checks: [] }),
    ).toMatchObject({
      tone: "active",
      label: "Working",
    });
  });

  it("never claims Verified for a turn that changed and ran nothing", () => {
    expect(
      workStatus({ kernel: kernel({ phase: "complete" }), isProcessing: false, changedCount: 0, checks: [] }).label,
    ).toBe("Ready");
  });

  it("reports Verified only with evidence of work", () => {
    expect(
      workStatus({ kernel: kernel({ phase: "complete" }), isProcessing: false, changedCount: 2, checks: [passing] })
        .label,
    ).toBe("Verified");
  });

  it("puts a failed request above everything the kernel believes", () => {
    expect(
      workStatus({
        kernel: kernel({ phase: "complete" }),
        isProcessing: false,
        changedCount: 2,
        checks: [passing],
        requestFailed: true,
      }),
    ).toMatchObject({ tone: "danger", label: "Request failed" });
  });

  it("separates a model-run check from host verification", () => {
    expect(workStatus({ kernel: kernel(), isProcessing: false, changedCount: 2, checks: [passing] })).toMatchObject({
      tone: "success",
      label: "Checks passed",
      hint: expect.stringContaining("/verify"),
    });
    expect(workStatus({ kernel: kernel(), isProcessing: false, changedCount: 2, checks: [failing] })).toMatchObject({
      tone: "danger",
      label: "Checks failing",
    });
    expect(workStatus({ kernel: kernel(), isProcessing: false, changedCount: 2, checks: [] })).toMatchObject({
      tone: "warning",
      label: "Unverified",
    });
  });

  it("surfaces the host's blocked reason", () => {
    expect(
      workStatus({
        kernel: kernel({ phase: "blocked", blockedReason: "Tests missing" }),
        isProcessing: false,
        changedCount: 1,
        checks: [],
      }),
    ).toMatchObject({ tone: "danger", label: "Blocked", hint: "Tests missing" });
  });
});

function toolEntry(
  name: string,
  input: Record<string, unknown>,
  result: ChatEntry["toolResult"],
  id: string,
): ChatEntry {
  return {
    type: "tool_result",
    content: "",
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
    toolCall: { id, type: "function", function: { name, arguments: JSON.stringify(input) } },
    toolResult: result,
  };
}

describe("summarizeChanges", () => {
  it("accumulates a diffstat per file and keeps a new file marked as added", () => {
    const entries: ChatEntry[] = [
      toolEntry(
        "write_file",
        { path: "src/a.ts" },
        { success: true, diff: { filePath: "src/a.ts", additions: 4, removals: 0, patch: "", isNew: true } },
        "1",
      ),
      toolEntry(
        "edit_file",
        { path: "src/a.ts" },
        { success: true, diff: { filePath: "src/a.ts", additions: 1, removals: 1, patch: "", isNew: false } },
        "2",
      ),
      toolEntry(
        "edit_file",
        { path: "src/b.ts" },
        { success: true, diff: { filePath: "src/b.ts", additions: 2, removals: 2, patch: "", isNew: false } },
        "3",
      ),
      toolEntry("edit_file", { path: "src/c.ts" }, { success: false, error: "not found" }, "4"),
    ];
    expect(summarizeChanges(entries)).toEqual([
      { path: "src/a.ts", additions: 5, removals: 1, kind: "added" },
      { path: "src/b.ts", additions: 2, removals: 2, kind: "modified" },
    ]);
  });

  it("marks deletions", () => {
    const entries = [
      toolEntry(
        "delete_file",
        { path: "src/old.ts" },
        { success: true, diff: { filePath: "src/old.ts", additions: 0, removals: 9, patch: "", isNew: false } },
        "1",
      ),
    ];
    expect(summarizeChanges(entries)[0]).toMatchObject({ kind: "deleted", removals: 9 });
  });
});

describe("summarizeChecks", () => {
  it("keeps the latest result of each distinct check, oldest first", () => {
    const entries: ChatEntry[] = [
      toolEntry("bash", { command: "bun test" }, { success: false, error: " 3 pass\n 2 fail" }, "1"),
      toolEntry("bash", { command: "bun run typecheck" }, { success: true, output: "" }, "2"),
      toolEntry("bash", { command: "bun test" }, { success: true, output: " 5 pass\n 0 fail" }, "3"),
    ];
    // Interleave a change so the two verify runs land in separate items.
    entries.splice(
      1,
      0,
      toolEntry(
        "edit_file",
        { path: "a.ts" },
        { success: true, diff: { filePath: "a.ts", additions: 1, removals: 0, patch: "", isNew: false } },
        "e",
      ),
    );
    const checks = summarizeChecks(projectTranscript(entries));
    expect(checks.map((check) => `${check.command}:${check.tone}`)).toEqual([
      "bun run typecheck:success",
      "bun test:success",
    ]);
  });
});

describe("explainError", () => {
  it("names the failure and gives a next step", () => {
    expect(explainError("429 Too Many Requests: limit reached")).toMatchObject({ title: "Rate limited" });
    expect(explainError("401 Unauthorized")).toMatchObject({ title: "Authentication failed" });
    expect(explainError("The model timed out after 180s")).toMatchObject({ title: "The model timed out" });
    expect(explainError("fetch failed: ENOTFOUND openrouter.ai")).toMatchObject({ title: "Can't reach the provider" });
    expect(explainError("maximum context length exceeded")).toMatchObject({ title: "The context is full" });
    expect(explainError("something odd")).toMatchObject({ title: "Request failed" });
    for (const message of ["429", "timeout", "nope"]) expect(explainError(message).hint.length).toBeGreaterThan(10);
  });
});

describe("projectTranscript turn summaries", () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 8, 19, 12, 0, seconds));
  const user = (text: string, seconds: number): ChatEntry => ({ type: "user", content: text, timestamp: at(seconds) });
  const assistant = (text: string, seconds: number): ChatEntry => ({
    type: "assistant",
    content: text,
    timestamp: at(seconds),
  });
  const edit = (id: string, seconds: number): ChatEntry => ({
    ...toolEntry(
      "edit_file",
      { path: "src/auth.ts" },
      { success: true, diff: { filePath: "src/auth.ts", additions: 4, removals: 1, patch: "", isNew: false } },
      id,
    ),
    timestamp: at(seconds),
  });
  const test = (id: string, seconds: number): ChatEntry => ({
    ...toolEntry("bash", { command: "bun test" }, { success: true, output: " 5 pass\n 0 fail" }, id),
    timestamp: at(seconds),
  });

  it("ends a turn that changed files and ran a check with one summary", () => {
    const items = projectTranscript([user("fix it", 0), edit("e", 10), test("t", 30), assistant("Done.", 42)]);
    const summary = items.at(-1);
    expect(summary).toMatchObject({ kind: "summary", durationMs: 42_000 });
    expect(summary?.kind === "summary" && summary.changes).toEqual([
      { path: "src/auth.ts", additions: 4, removals: 1, kind: "modified" },
    ]);
    expect(summary?.kind === "summary" && summary.checks.map((check) => check.label)).toEqual(["tests"]);
    expect(turnSummaryGroups(summary as never).map((group) => group.map((part) => part.text).join(""))).toEqual([
      "1 file +4 -1",
      "tests ✓",
      "42s",
    ]);
  });

  it("says nothing about a turn that only talked", () => {
    const items = projectTranscript([user("what is this?", 0), assistant("A CLI.", 3)]);
    expect(items.some((item) => item.kind === "summary")).toBe(false);
  });

  it("does not summarise the turn that is still running", () => {
    const entries = [user("fix it", 0), edit("e", 10)];
    expect(projectTranscript(entries, { live: true }).some((item) => item.kind === "summary")).toBe(false);
    expect(projectTranscript(entries).some((item) => item.kind === "summary")).toBe(true);
  });

  it("keeps each turn's summary to that turn", () => {
    const items = projectTranscript([
      user("first", 0),
      edit("e1", 5),
      assistant("one", 6),
      user("second", 10),
      test("t2", 12),
      assistant("two", 14),
    ]);
    const summaries = items.filter((item) => item.kind === "summary");
    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.kind === "summary" && summaries[0].checks).toHaveLength(0);
    expect(summaries[1]?.kind === "summary" && summaries[1].changes).toHaveLength(0);
  });

  it("marks a failing check with its count", () => {
    const failing = {
      ...toolEntry("bash", { command: "bun test" }, { success: false, error: " 3 pass\n 2 fail" }, "f"),
      timestamp: at(5),
    };
    const summary = projectTranscript([user("run", 0), failing]).at(-1);
    expect(turnSummaryGroups(summary as never).map((group) => group.map((part) => part.text).join(""))).toContain(
      "tests × 2 failed",
    );
  });

  it("puts what memory recalled at the start of the turn, in the same line as skill loads", () => {
    const skill = {
      ...toolEntry("read_file", { path: ".agents/skills/terminal-ui/SKILL.md" }, { success: true, output: "x" }, "s"),
      timestamp: at(2),
    };
    const items = projectTranscript([user("go", 0), skill, assistant("ok", 3)], { recalls: [2] });
    const loads = items.filter((item) => item.kind === "activity" && item.group === "load");
    expect(loads).toHaveLength(1);
    expect(loads[0]?.kind === "activity" && loads[0].rows.map((row) => `${row.verb} ${row.object}`)).toEqual([
      "Recalled 2 memories",
      "Loaded skill terminal-ui",
    ]);
  });
});
