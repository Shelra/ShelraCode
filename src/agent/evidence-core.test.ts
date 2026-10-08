import { describe, expect, it } from "vitest";
import {
  type CheckReceiptContext,
  createHostTurnResult,
  type HostCheckResult,
  type HostTurnStatus,
  observedCheckRuns,
  serializeCheckReceipts,
  summarizeCheckReceipts,
  type WorkspaceCheckReceipt,
} from "./evidence-core";
import type { WorkspaceState } from "./workspace-state";

const workspace = "project";
const state = (content: string): WorkspaceState => ({ kind: "walk", files: new Map([["src/billing.ts", content]]) });
const oldState = state("old-content");
const finalState = state("fixed-content");
const context: CheckReceiptContext = { workspace, startState: oldState, currentState: finalState, mutationEvents: 1 };

function receipt(overrides: Partial<WorkspaceCheckReceipt> = {}): WorkspaceCheckReceipt {
  return {
    command: "bun test src/billing.test.ts",
    passed: true,
    detail: "1 pass",
    mutationEvents: 1,
    state: finalState,
    beforeState: finalState,
    cwd: workspace,
    finished: true,
    source: "host",
    ...overrides,
  };
}

describe("the contract's projection of check receipts", () => {
  it("reuses only a check of the final candidate and preserves the original failure before any edits", () => {
    const checks = observedCheckRuns(
      [
        receipt({ passed: false, detail: "wrong total", mutationEvents: 0, state: oldState, beforeState: oldState }),
        receipt(),
      ],
      context,
    );
    expect(checks[0]).toMatchObject({ passed: false, detail: "wrong total", fresh: false, beforeFirstChange: true });
    expect(checks[1]).toMatchObject({ passed: true, fresh: true, beforeFirstChange: false });
  });

  it("invalidates a pass after a shell edit even without a recorded file-tool mutation", () => {
    const checks = observedCheckRuns([receipt({ state: oldState, beforeState: oldState })], context);
    expect(checks[0].fresh).toBe(false);
  });

  it("does not reuse a pass after an edit event even when the final content was restored", () => {
    expect(observedCheckRuns([receipt({ mutationEvents: 0 })], context)[0].fresh).toBe(false);
  });

  it("does not let a later check's candidate replace the candidate an earlier check tested", () => {
    const checks = observedCheckRuns(
      [
        receipt({ command: "bun run test", state: oldState, beforeState: oldState }),
        receipt({ command: "bun run lint", beforeState: oldState }),
      ],
      context,
    );
    expect(checks.map((check) => check.fresh)).toEqual([false, false]);
  });

  it("does not reuse a check from another working directory", () => {
    const checks = observedCheckRuns([receipt({ cwd: "project/tools", mutationEvents: 0 })], context);
    expect(checks[0]).toMatchObject({ fresh: false, beforeFirstChange: false });
  });

  it("fails closed for null, unknown and incomparable candidates", () => {
    const unknown: WorkspaceState = { kind: "unknown", files: new Map() };
    const git: WorkspaceState = { kind: "git", files: new Map(finalState.files) };
    for (const candidate of [null, unknown, git]) {
      expect(observedCheckRuns([receipt({ state: candidate })], context)[0].fresh).toBe(false);
      expect(observedCheckRuns([receipt()], { ...context, currentState: candidate })[0].fresh).toBe(false);
    }
    expect(observedCheckRuns([receipt({ beforeState: null })], context)[0].fresh).toBe(false);
    expect(observedCheckRuns([receipt({ beforeState: unknown })], context)[0].fresh).toBe(false);
    expect(
      observedCheckRuns([receipt({ mutationEvents: 0 })], { ...context, startState: unknown })[0].beforeFirstChange,
    ).toBe(false);
  });

  it("retains explicit unfinished and unavailable outcomes for the existing evaluator", () => {
    const checks = observedCheckRuns(
      [receipt({ passed: false, finished: false, unrunnable: "timed out", detail: "partial output" })],
      context,
    );
    expect(checks[0]).toMatchObject({
      passed: false,
      finished: false,
      unrunnable: "timed out",
      detail: "partial output",
    });
  });
});

describe("the host's receipt summary", () => {
  it("preserves execution provenance through the public result without upgrading a caller runner to OS isolation", () => {
    const observations = (["caller-runner", "private-copy", "windows-appcontainer"] as const).map((execution) =>
      receipt({ source: "host", execution, candidateFingerprint: `sha256:${"a".repeat(64)}` }),
    );
    const result = createHostTurnResult({
      taskId: "private-check",
      status: "verified",
      changedFiles: [],
      limitations: [],
      checks: serializeCheckReceipts(observations, context),
    });
    expect(result.checks.map((check) => check.execution)).toEqual([
      "caller-runner",
      "private-copy",
      "windows-appcontainer",
    ]);
    expect(result.checks.every((check) => check.candidateFingerprint === `sha256:${"a".repeat(64)}`)).toBe(true);
    expect(Object.isFrozen(result.checks[0])).toBe(true);
  });

  it("reports exact scope and origin without turning a targeted check into the entire suite", () => {
    const checks = serializeCheckReceipts([receipt({ source: "agent" })], context);
    expect(checks).toEqual([
      {
        command: "bun test src/billing.test.ts",
        cwd: workspace,
        source: "agent",
        passed: true,
        fresh: true,
        finished: true,
        detail: "1 pass",
      },
    ]);
    const summary = summarizeCheckReceipts([receipt({ source: "agent" })], context);
    expect(summary).toContain("agent: `bun test src/billing.test.ts` in `project`: passed");
    expect(summary).not.toMatch(/all tests|entire suite|task verified/iu);
    expect(JSON.stringify(checks)).not.toMatch(/mutationEvents|files|beforeState/u);
  });

  it("keeps stale passes, failures and unavailable checks visible without endorsing their final candidate", () => {
    const summary = summarizeCheckReceipts(
      [
        receipt({ state: oldState, beforeState: oldState }),
        receipt({ command: "bun run lint", passed: false, detail: "unused import" }),
        receipt({ command: "bun run typecheck", passed: false, finished: false, unrunnable: "tsc is missing" }),
      ],
      context,
    );
    expect(summary).toContain("passed; not evidence for the final local workspace (stale or unknown candidate)");
    expect(summary).toContain("`bun run lint` in `project`: failed");
    expect(summary).toContain("`bun run typecheck` in `project`: unavailable: tsc is missing");
  });

  it("does not display an unfinished check as a pass and emits nothing when no check ran", () => {
    expect(summarizeCheckReceipts([receipt({ passed: false, finished: false })], context)).toContain("did not finish");
    expect(summarizeCheckReceipts([], context)).toBe("");
  });

  it("redacts public receipt fields without changing the raw observations used for matching", () => {
    const key = "sk-or-v1-1234567890abcdefghijklmnop";
    const check = receipt({
      command: `curl -H 'Authorization: Bearer ${key}' http://localhost:3000/`,
      detail: `The provider refused ${key}`,
      unrunnable: `No quota for ${key}`,
      cwd: `${workspace}/${key}`,
    });
    const scopedContext = { ...context, workspace: check.cwd };
    const raw = observedCheckRuns([check], scopedContext)[0];
    const exposed = serializeCheckReceipts([check], scopedContext)[0];

    expect(raw).toMatchObject({
      command: check.command,
      detail: check.detail,
      unrunnable: check.unrunnable,
      fresh: true,
    });
    expect(raw.command).toContain(key);
    expect(JSON.stringify(exposed)).not.toContain(key);
    for (const field of [exposed.command, exposed.detail, exposed.unrunnable, exposed.cwd]) {
      expect(field).toContain("***");
    }
    expect(exposed).toMatchObject({ passed: true, fresh: true, source: "host" });
    expect(summarizeCheckReceipts([check], scopedContext)).not.toContain(key);
    expect(check.command).toContain(key);
  });
});

describe("the structured result of the existing completion gate", () => {
  it("derives verified solely from the gate's final status", () => {
    const statuses: HostTurnStatus[] = [
      "verified",
      "answered",
      "unverified",
      "blocked",
      "limited",
      "paused",
      "cancelled",
    ];
    for (const status of statuses) {
      const result = createHostTurnResult({ taskId: "task-1", status, changedFiles: [], checks: [], limitations: [] });
      expect(result.verified).toBe(status === "verified");
    }
  });

  it("keeps a result independent of mutable caller arrays and receipts", () => {
    const changedFiles = ["src/billing.ts"];
    const checks: HostCheckResult[] = serializeCheckReceipts([receipt()], context);
    const limitations = ["external provider not checked"];
    const result = createHostTurnResult({ taskId: "task-1", status: "unverified", changedFiles, checks, limitations });
    changedFiles.push("unrelated.ts");
    checks[0].passed = false;
    checks.push({ ...checks[0], command: "bun run test" });
    limitations.length = 0;
    expect(result.changedFiles).toEqual(["src/billing.ts"]);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].passed).toBe(true);
    expect(result.limitations).toEqual(["external provider not checked"]);
    expect(result.verified).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.checks)).toBe(true);
    expect(Object.isFrozen(result.checks[0])).toBe(true);
  });

  it("redacts every public text field even when the caller supplies unsanitized checks directly", () => {
    const key = "sk-or-v1-1234567890abcdefghijklmnop";
    const rawCheck: HostCheckResult = {
      command: `curl -H 'Authorization: Bearer ${key}' http://localhost:3000/`,
      cwd: `${workspace}/${key}`,
      source: "host",
      passed: false,
      fresh: true,
      detail: `Denied key ${key}`,
      unrunnable: `Quota for ${key} exhausted`,
    };
    const result = createHostTurnResult({
      taskId: `task-${key}`,
      status: "limited",
      changedFiles: [`src/${key}/billing.ts`],
      checks: [rawCheck],
      limitations: [`The provider refused ${key}`],
    });

    expect(JSON.stringify(result)).not.toContain(key);
    for (const field of [
      result.taskId,
      ...result.changedFiles,
      result.checks[0].command,
      result.checks[0].cwd,
      result.checks[0].detail,
      result.checks[0].unrunnable,
      ...result.limitations,
    ]) {
      expect(field).toContain("***");
    }
    expect(result).toMatchObject({ status: "limited", verified: false });
    expect(rawCheck.command).toContain(key);
    expect(createHostTurnResult(result)).toEqual(result);
  });
});
