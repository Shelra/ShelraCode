import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDecisions, runDecisionsCli, runDecisionsCommand } from "./cli";
import { approveDecision, listDecisions, proposeDecision } from "./store";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-ledger-cli-"));
});

afterEach(() => {
  // A check killed for its timeout may still hold the folder for a moment.
  rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const propose = (title: string) =>
  proposeDecision(workspace, {
    title,
    rule: `${title}, always.`,
    scope: ["src/**"],
    check: "bun test",
    source: "agent",
  });

describe("shelra decisions", () => {
  it("lists what waits for approval apart from what is active", () => {
    expect(runDecisionsCommand(workspace).output).toBe("No decisions recorded in docs/decisions yet.");
    propose("Money is integer cents");
    propose("Dates are UTC");
    approveDecision(workspace, "D-0001");

    const { exitCode, output } = runDecisionsCommand(workspace, "list");
    expect(exitCode).toBe(0);
    expect(output).toBe(
      [
        "Waiting for your approval:",
        "  D-0002  Dates are UTC  covers: src/**  check: bun test",
        "",
        "Active:",
        "  D-0001  Money is integer cents  covers: src/**  check: bun test",
      ].join("\n"),
    );
  });

  it("approves, rejects and shows by id, and says why when it cannot", () => {
    propose("Money is integer cents");
    propose("Dates are UTC");

    expect(runDecisionsCommand(workspace, "approve", "d-0001")).toMatchObject({
      exitCode: 0,
      output: expect.stringContaining("Approved D-0001"),
    });
    expect(runDecisionsCommand(workspace, "reject", "D-0002")).toMatchObject({ exitCode: 0 });
    expect(listDecisions(workspace).map((decision) => `${decision.id} ${decision.status}`)).toEqual(["D-0001 active"]);
    expect(runDecisionsCommand(workspace, "show", "D-0001").output).toContain("Money is integer cents, always.");

    expect(runDecisionsCommand(workspace, "approve", "D-0001")).toMatchObject({ exitCode: 1 });
    expect(runDecisionsCommand(workspace, "show", "D-0009")).toMatchObject({ exitCode: 1 });
    expect(runDecisionsCommand(workspace, "approve")).toMatchObject({ exitCode: 1 });
    expect(runDecisionsCommand(workspace, "delete", "D-0001")).toMatchObject({
      exitCode: 1,
      output: expect.stringContaining("list, show, approve, reject"),
    });
  });
});

describe("shelra decisions check", () => {
  /** An active decision over `scope` whose check is `check`. */
  const decide = (title: string, scope: string[], check?: string) => {
    const proposed = proposeDecision(workspace, {
      title,
      rule: `${title}, always.`,
      scope,
      ...(check ? { check } : {}),
      source: "user",
    });
    if (!proposed.ok) throw new Error(proposed.reason);
    approveDecision(workspace, proposed.decision.id);
  };
  const holds = "bun --version";
  /** A check that runs and fails: the rule is broken. */
  const fails = () => {
    mkdirSync(join(workspace, "scripts"), { recursive: true });
    writeFileSync(join(workspace, "scripts", "fail.ts"), "process.exit(1);\n");
    return "bun scripts/fail.ts";
  };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: workspace, stdio: "ignore" });

  it("runs every active decision's check and fails when one is broken", async () => {
    expect(await checkDecisions(workspace)).toMatchObject({
      exitCode: 0,
      output: "No active decision in docs/decisions has a check.",
    });
    decide("SQL is parameterized", ["src/**"], holds);
    decide("Logs hold no emails", ["src/**"], fails());
    decide("Prefer small modules", []);

    const result = await checkDecisions(workspace);
    expect(result).toMatchObject({ exitCode: 1, stream: "stderr" });
    expect(result.output).toMatch(/^D-0001 SQL is parameterized: holds \(`bun --version`, [\d.]+ s\)$/mu);
    expect(result.output).toContain("D-0002 Logs hold no emails: BROKEN (`bun scripts/fail.ts`)");
    expect(result.output).toContain("Checked 2 decisions: 1 holds, 1 broken. 1 active decision has no check.");
  });

  it("tells a check that could not run, or would do damage, apart from a broken rule", async () => {
    decide("Fixtures stay small", ["**"], "bun ./scripts/missing-check.ts");
    decide("Generated files are never committed", ["**"], "git clean -fdx");

    const plain = await checkDecisions(workspace);
    expect(plain).toMatchObject({ exitCode: 1, stream: "stderr" });
    expect(plain.output).toContain("D-0001 Fixtures stay small: COULD NOT RUN (`bun ./scripts/missing-check.ts`)");
    expect(plain.output).toContain(
      "D-0002 Generated files are never committed: NOT RUN (`git clean -fdx` deletes untracked files)",
    );
    expect(plain.output).toContain("Checked 2 decisions: 0 hold, 0 broken, 1 could not run, 1 not run.");

    const hook = await checkDecisions(workspace, { hook: "claude-code", hookInput: "{}" });
    expect(hook).toMatchObject({ exitCode: 2, stream: "stderr" });
    expect(hook.output).toContain("could not run, so nothing vouches for the code");
    expect(hook.output).toContain("would do damage and was not run");
    expect(hook.output).not.toContain("Restore what the decision requires");
  });

  it("judges by how the check ended, not by words in its output", async () => {
    mkdirSync(join(workspace, "scripts"), { recursive: true });
    writeFileSync(
      join(workspace, "scripts", "not-found.ts"),
      'console.error("export fetchUser not found in src/index.ts; Cannot find name phone");\nprocess.exit(1);\n',
    );
    writeFileSync(
      join(workspace, "scripts", "hangs.ts"),
      'console.log("checking...");\nsetTimeout(() => {}, 3_000);\n',
    );
    decide("Exports keep their names", ["**"], "bun scripts/not-found.ts");
    decide("Tools exist", ["**"], "shelra-no-such-tool-xyz --version");
    decide("Checks end", ["**"], "bun scripts/hangs.ts");

    const result = await checkDecisions(workspace, { timeoutMs: 1_500 });
    expect(result).toMatchObject({ exitCode: 1, stream: "stderr" });
    expect(result.output).toContain("D-0001 Exports keep their names: BROKEN (`bun scripts/not-found.ts`)");
    expect(result.output).toContain("D-0002 Tools exist: COULD NOT RUN (`shelra-no-such-tool-xyz --version`)");
    expect(result.output).toContain("D-0003 Checks end: COULD NOT RUN (`bun scripts/hangs.ts`)");
    expect(result.output).toMatch(/timed out after [\d.]+ s\n\s+checking\.\.\./u);
    expect(result.output).toContain("Checked 3 decisions: 0 hold, 1 broken, 2 could not run.");
  }, 30_000);

  it("as a hook, stops starting checks when its time budget is spent and says so", async () => {
    mkdirSync(join(workspace, "scripts"), { recursive: true });
    writeFileSync(join(workspace, "scripts", "slow.ts"), "setTimeout(() => {}, 3_000);\n");
    decide("First", ["**"], "bun scripts/slow.ts");
    decide("Second", ["**"], holds);

    const result = await checkDecisions(workspace, { hook: "claude-code", timeoutMs: 5_000, budgetMs: 400 });
    expect(result).toMatchObject({ exitCode: 2, stream: "stderr" });
    expect(result.output).toContain("Its check `bun scripts/slow.ts` could not run:");
    expect(result.output).toContain("timed out after");
    expect(result.output).toContain("not started: the hook's time budget ran out");
    expect(result.output).not.toContain("Restore what the decision requires");
  }, 30_000);

  it("with changed, checks only the decisions that cover a changed file", async () => {
    decide("The API is snake_case", ["src/api/**"], holds);
    decide("Migrations are never edited", ["migrations/**"], fails());
    mkdirSync(join(workspace, "src", "api"), { recursive: true });
    mkdirSync(join(workspace, "migrations"), { recursive: true });
    writeFileSync(join(workspace, "migrations", "0001.sql"), "CREATE TABLE users (id INTEGER);\n");
    git("init", "-q");
    git("add", "-A");
    git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "base",
    );
    writeFileSync(join(workspace, "src", "api", "users.ts"), "export const users = [];\n");

    const result = await checkDecisions(workspace, { changed: true });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("D-0001 The API is snake_case: holds");
    expect(result.output).not.toContain("D-0002");

    writeFileSync(join(workspace, "migrations", "0001.sql"), "CREATE TABLE users (id INTEGER, phone TEXT);\n");
    expect(await checkDecisions(workspace, { changed: true })).toMatchObject({ exitCode: 1 });
  });

  it("with changed, counts every file of a repository that has no commit yet", async () => {
    decide("The API is snake_case", ["src/api/**"], holds);
    mkdirSync(join(workspace, "src", "api"), { recursive: true });
    writeFileSync(join(workspace, "src", "api", "users.ts"), "export const users = [];\n");
    git("init", "-q");
    git("add", "-A");

    const result = await checkDecisions(workspace, { changed: true });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("D-0001 The API is snake_case: holds");
    expect(result.output).not.toContain("outside a git repository");
  });

  it("as a Claude Code stop hook, sends the broken decision back to Claude once", async () => {
    decide("Logs hold no emails", ["src/**"], fails());

    const blocked = await checkDecisions(workspace, { hook: "claude-code", hookInput: '{"stop_hook_active":false}' });
    expect(blocked).toMatchObject({ exitCode: 2, stream: "stderr" });
    expect(blocked.output).toContain("- D-0001 Logs hold no emails (docs/decisions/0001-logs-hold-no-emails.md)");
    expect(blocked.output).toContain("Its check `bun scripts/fail.ts` fails:");
    expect(blocked.output).toContain("Restore what the decision requires.");
    // Claude Code is already continuing because of a stop hook: no second block, no loop.
    const again = await checkDecisions(workspace, { hook: "claude-code", hookInput: '{"stop_hook_active":true}' });
    expect(again).toMatchObject({ exitCode: 0, stream: "stdout" });
  });

  it("routes every action through one entry point and refuses check options elsewhere", async () => {
    expect(await runDecisionsCli(workspace, "list", undefined, { changed: true })).toMatchObject({
      exitCode: 1,
      output: "--changed and --hook go with `shelra decisions check`.",
    });
    expect(await runDecisionsCli(workspace, "check", undefined, { hook: "cursor" })).toMatchObject({
      exitCode: 1,
      output: 'Unknown hook "cursor". Use --hook claude-code.',
    });
    expect(await runDecisionsCli(workspace, "check", undefined, { hook: "claude-code" })).toMatchObject({
      exitCode: 0,
      stream: "stdout",
    });
    expect(await runDecisionsCli(workspace)).toMatchObject({ exitCode: 0, stream: "stdout" });
    expect(await runDecisionsCli(workspace, "show", "D-0009")).toMatchObject({ exitCode: 1, stream: "stderr" });
  });
});
