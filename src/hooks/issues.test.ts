import { afterEach, describe, expect, it } from "vitest";
import { type HookIssue, reportHookIssues, setHookIssueListener } from "./index";
import type { AggregatedHookResult, HookResult } from "./types";

const result = (hooks: HookResult[]): AggregatedHookResult => ({
  blocked: hooks.some((hook) => hook.outcome === "blocking"),
  blockingErrors: [],
  preventContinuation: false,
  additionalContexts: [],
  results: hooks,
});

describe("hook issues", () => {
  afterEach(() => setHookIssueListener(null));

  it("stays silent for hooks that succeed", () => {
    const seen: HookIssue[] = [];
    setHookIssueListener((issue) => seen.push(issue));
    reportHookIssues("PostToolUse", result([{ outcome: "success", exitCode: 0, command: "prettier" }]));
    expect(seen).toEqual([]);
  });

  it("reports a block with the first useful line of why", () => {
    const seen: HookIssue[] = [];
    setHookIssueListener((issue) => seen.push(issue));
    reportHookIssues(
      "PreToolUse",
      result([
        { outcome: "blocking", exitCode: 2, command: "guard.sh", stderr: "\nrm -rf is not allowed\nsecond line" },
      ]),
    );
    expect(seen).toEqual([{ event: "PreToolUse", outcome: "blocking", message: "rm -rf is not allowed" }]);
  });

  it("reports a failure that did not stop the action, falling back to the command", () => {
    const seen: HookIssue[] = [];
    setHookIssueListener((issue) => seen.push(issue));
    reportHookIssues("Stop", result([{ outcome: "non_blocking_error", exitCode: 1, command: "notify.sh" }]));
    expect(seen).toEqual([{ event: "Stop", outcome: "non_blocking_error", message: "notify.sh" }]);
  });

  it("ignores cancelled hooks and never lets a broken listener escape", () => {
    setHookIssueListener(() => {
      throw new Error("boom");
    });
    expect(() =>
      reportHookIssues(
        "Stop",
        result([
          { outcome: "blocking", exitCode: 2, command: "x" },
          { outcome: "cancelled", exitCode: null, command: "y" },
        ]),
      ),
    ).not.toThrow();
  });
});
