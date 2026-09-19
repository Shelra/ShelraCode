/**
 * Regressions found by running the real product against a real model (2026-09-19): a directory
 * listing counted as a test run, and the panel said "Verified" next to a failing check.
 */
import { describe, expect, it } from "vitest";
import type { KernelState } from "../agent/kernel";
import { classifyCommand, isVerificationCommand } from "./activity";
import { type CheckSummary, workStatus } from "./observability";

describe("classifyCommand looks at the program, not at words in its arguments", () => {
  it("does not treat listings, reads or searches as checks", () => {
    for (const command of [
      "Get-ChildItem -Recurse tests",
      "ls tests/",
      "cat tests/auth.test.ts",
      'grep -r "test" src',
      "Get-Content package.json | Select-String test",
      "git log --oneline -- tests",
      "echo build finished",
    ]) {
      expect(classifyCommand(command), command).toBe("generic");
      expect(isVerificationCommand(command), command).toBe(false);
    }
  });

  it("still recognises real test, type, lint and build runs", () => {
    expect(classifyCommand("bun test")).toBe("test");
    expect(classifyCommand("bun test src/ui/markdown.test.tsx")).toBe("test");
    expect(classifyCommand("bun run test")).toBe("test");
    expect(classifyCommand("npm run test:unit")).toBe("test");
    expect(classifyCommand("bunx vitest run --pool=forks")).toBe("test");
    expect(classifyCommand("npx jest --ci")).toBe("test");
    expect(classifyCommand("pytest -q")).toBe("test");
    expect(classifyCommand("cargo test --all")).toBe("test");
    expect(classifyCommand("go test ./...")).toBe("test");
    expect(classifyCommand("tsc --noEmit")).toBe("typecheck");
    expect(classifyCommand("bun run typecheck")).toBe("typecheck");
    expect(classifyCommand("bunx biome check src/")).toBe("lint");
    expect(classifyCommand("bun run build")).toBe("build");
    expect(classifyCommand("npm install zod")).toBe("install");
  });

  it("finds the check inside a compound command", () => {
    expect(classifyCommand("cd app && bun test")).toBe("test");
    expect(classifyCommand("CI=1 bun run test")).toBe("test");
    expect(classifyCommand("bun install; bun test")).toBe("test");
    expect(classifyCommand("git status && ls")).toBe("generic");
  });
});

function kernel(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "t",
    objective: "o",
    phase: "complete",
    scope: [],
    mutations: [],
    observations: [],
    attemptCount: 1,
    verificationPassed: false,
    reviewPassed: false,
    ...overrides,
  };
}

const failing: CheckSummary = { command: "bun test", label: "tests", tone: "danger", meta: "3 pass · 2 fail" };
const passing: CheckSummary = { command: "bun run typecheck", label: "types", tone: "success", meta: "no type errors" };

describe("workStatus never says Verified next to a failing check", () => {
  it("reports failing checks even when the kernel considers the turn complete", () => {
    expect(
      workStatus({ kernel: kernel(), isProcessing: false, changedCount: 0, checks: [passing, failing] }),
    ).toMatchObject({ tone: "danger", label: "Checks failing", hint: "bun test" });
  });

  it("still yields to a blocked or stopped run", () => {
    expect(
      workStatus({
        kernel: kernel({ phase: "blocked", blockedReason: "no evidence" }),
        isProcessing: false,
        changedCount: 1,
        checks: [failing],
      }).label,
    ).toBe("Blocked");
    expect(
      workStatus({ kernel: kernel({ phase: "cancelled" }), isProcessing: false, changedCount: 0, checks: [failing] })
        .label,
    ).toBe("Stopped");
  });

  it("is Verified once every latest check passes", () => {
    expect(workStatus({ kernel: kernel(), isProcessing: false, changedCount: 1, checks: [passing] }).label).toBe(
      "Verified",
    );
  });
});
