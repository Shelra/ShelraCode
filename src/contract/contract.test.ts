import { mkdtempSync, rmSync } from "node:fs";
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
  });
});
