import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ContractCheckRunner, contractChecks, evaluateTurnContract } from "./contract";
import type { DiscoveredCheck } from "./discover";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-turn-contract-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const test: DiscoveredCheck = {
  kind: "test",
  command: "bun run test",
  source: "package.json scripts.test",
  runs: "bun test",
};
const typecheck: DiscoveredCheck = { kind: "typecheck", command: "bun run typecheck", source: "package.json" };
const lint: DiscoveredCheck = { kind: "lint", command: "bun run lint", source: "package.json" };

describe("contractChecks", () => {
  it("keeps tests, type-check and lint, never a build", () => {
    expect(
      contractChecks([test, typecheck, lint, { kind: "build", command: "bun run build", source: "package.json" }]),
    ).toEqual([test, typecheck, lint]);
  });
});

describe("evaluateTurnContract", () => {
  it("reuses the agent's fresh run and runs the rest itself", async () => {
    const runCheck = vi.fn<ContractCheckRunner>(async (command) => ({
      passed: command !== "bun run lint",
      output: command === "bun run lint" ? "src/a.ts:1 unused variable" : "ok",
      durationMs: 5,
    }));

    const results = await evaluateTurnContract({
      checks: [test, typecheck, lint],
      runs: [
        // The agent ran the tests' script body after its last change: that run counts.
        { command: "bun test", passed: true, detail: "", fresh: true, beforeFirstChange: false },
        // It type-checked earlier, then changed code again: stale, so the host runs it.
        { command: "bun run typecheck", passed: true, detail: "", fresh: false, beforeFirstChange: false },
      ],
      workspace,
      runCheck,
      timeoutMs: 60_000,
    });

    expect(runCheck.mock.calls.map(([command]) => command)).toEqual(["bun run typecheck", "bun run lint"]);
    expect(results.map((result) => [result.check.kind, result.passed, result.by])).toEqual([
      ["test", true, "agent"],
      ["typecheck", true, "host"],
      ["lint", false, "host"],
    ]);
    expect(results[2]?.detail).toContain("unused variable");
  });

  it("marks a failure the agent saw before its first change as older than the turn", async () => {
    const results = await evaluateTurnContract({
      checks: [lint],
      runs: [{ command: "bun run lint", passed: false, detail: "old warning", fresh: false, beforeFirstChange: true }],
      workspace,
      runCheck: async () => ({ passed: false, output: "old warning", durationMs: 1 }),
      timeoutMs: 60_000,
    });
    expect(results[0]).toMatchObject({ passed: false, by: "host", failedBefore: true });
  });

  it("never runs a check a repository states if it would do damage", async () => {
    const runCheck = vi.fn<ContractCheckRunner>();
    const results = await evaluateTurnContract({
      checks: [{ kind: "test", command: "rm -rf ~", source: "AGENTS.md" }],
      runs: [],
      workspace,
      runCheck,
      timeoutMs: 60_000,
    });
    expect(runCheck).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ passed: false, by: "host" });
    expect(results[0]?.detail).toContain("not run");
    // It vouches for nothing either way: the turn is not sent back to fix it.
    expect(results[0]?.unrunnable).toContain("not run");
  });

  it("tells a project check that could not run here from one that failed (2026-10-03)", async () => {
    const runCheck = vi.fn<ContractCheckRunner>(async (command) =>
      command === "pyright"
        ? { passed: false, output: "sh: 1: pyright: not found", durationMs: 1, state: "completed", exitCode: 127 }
        : command === "python -m pytest"
          ? { passed: false, output: "", durationMs: 240_000, state: "timed_out", exitCode: null }
          : { passed: false, output: "1 failed", durationMs: 1, state: "completed", exitCode: 1 },
    );
    const results = await evaluateTurnContract({
      checks: [
        { kind: "typecheck", command: "pyright", source: "pyright configuration" },
        { kind: "test", command: "python -m pytest", source: "pytest configuration" },
        { kind: "lint", command: "ruff check .", source: "ruff configuration" },
      ],
      runs: [],
      workspace,
      runCheck,
      timeoutMs: 240_000,
    });
    expect(results[0]?.unrunnable).toContain("pyright: not found");
    expect(results[1]?.unrunnable).toMatch(/^timed out/u);
    expect(results[2]?.unrunnable).toBeUndefined();

    // The agent's own run is known only by its text: dash, the shell of Debian and Ubuntu images, says it this way.
    const reused = await evaluateTurnContract({
      checks: [{ kind: "typecheck", command: "pyright", source: "pyright configuration" }],
      runs: [
        {
          command: "pyright",
          passed: false,
          detail: "sh: 1: pyright: not found",
          fresh: true,
          beforeFirstChange: false,
        },
      ],
      workspace,
      runCheck,
      timeoutMs: 240_000,
    });
    expect(reused[0]).toMatchObject({ by: "agent", unrunnable: "sh: 1: pyright: not found" });
  });

  it("never lets a real failure hide behind 'could not run' (review 2026-10-03)", async () => {
    const test = { kind: "test" as const, command: "bun run test", source: "package.json", runs: "bun test" };
    const outputs: Record<string, { output: string; state: "completed" | "timed_out"; exitCode: number | null }> = {
      // One test spawns a helper that is missing; another fails for real.
      helper: {
        output: "sh: 1: imagemagick: not found\n(fail) formats the clock [1.00ms]\n 3 pass\n 1 fail\n",
        state: "completed",
        exitCode: 1,
      },
      // A program the check does not start is missing, and nothing says a test ran.
      other: { output: "bash: convert: command not found", state: "completed", exitCode: 127 },
      // The suite hangs after the change, though it finished before it.
      hang: { output: "", state: "timed_out", exitCode: null },
    };
    for (const [name, end] of Object.entries(outputs)) {
      const results = await evaluateTurnContract({
        checks: [test],
        runs:
          name === "hang"
            ? [{ command: "bun run test", passed: true, detail: "4 pass", fresh: false, beforeFirstChange: true }]
            : [],
        workspace,
        runCheck: async () => ({ passed: false, durationMs: 1, ...end }),
        timeoutMs: 60_000,
      });
      expect(results[0]?.unrunnable, name).toBeUndefined();
    }
  });

  it("looks through the script a check runs before running it (audit gap #10)", async () => {
    writeFileSync(
      join(workspace, "package.json"),
      JSON.stringify({ name: "kart", scripts: { build: "rm -rf ~/projects && tsc", test: "vitest run" } }),
    );
    const runCheck = vi.fn<ContractCheckRunner>(async () => ({ passed: true, output: "ok", durationMs: 1 }));
    const results = await evaluateTurnContract({
      checks: [
        { kind: "build", command: "npm run build", source: "package.json" },
        { kind: "test", command: "npm run test", source: "package.json" },
      ],
      runs: [],
      workspace,
      runCheck,
      timeoutMs: 60_000,
    });
    expect(runCheck.mock.calls.map(([command]) => command)).toEqual(["npm run test"]);
    expect(results[0]).toMatchObject({ passed: false, by: "host" });
    expect(results[0]?.detail).toContain("not run: `npm run build`");
    expect(results[0]?.detail).toContain("(in `build` of package.json)");
    expect(results[1]).toMatchObject({ passed: true });
  });
});
