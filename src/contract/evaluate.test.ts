import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AcceptanceDeps, evaluateAcceptance } from "./evaluate";
import type { AcceptanceCriterion } from "./types";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-contract-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const deps = (judge?: AcceptanceDeps["judge"]): AcceptanceDeps => ({
  runCommand: vi.fn(),
  probeHttp: vi.fn(),
  observePage: vi.fn(),
  ...(judge ? { judge } : {}),
});

const judged: AcceptanceCriterion = {
  id: "AC-J",
  description: "reads well",
  check: { kind: "judge", question: "Is the page readable?" },
  required: true,
};

describe("evaluateAcceptance", () => {
  it("decides file checks itself, without a model", async () => {
    writeFileSync(join(workspace, "a.txt"), "hello");
    const report = await evaluateAcceptance(
      [
        { id: "AC-1", description: "a exists", check: { kind: "file_exists", path: "a.txt" }, required: true },
        { id: "AC-2", description: "b exists", check: { kind: "file_exists", path: "b.txt" }, required: false },
      ],
      { workspace, attempt: 1 },
      deps(),
    );
    expect(report.passed).toBe(true);
    expect(report.results.map((result) => [result.id, result.passed, result.modelJudged])).toEqual([
      ["AC-1", true, false],
      ["AC-2", false, false],
    ]);
  });

  it("blocks a judged criterion when no judge is available, and records a verdict as model-judged", async () => {
    const without = await evaluateAcceptance([judged], { workspace, attempt: 1 }, deps());
    expect(without.passed).toBe(false);
    expect(without.blocked).toEqual(["AC-J"]);

    const judge = vi.fn(async () => ({ passed: true, reason: "clear headings" }));
    const withJudge = await evaluateAcceptance([judged], { workspace, attempt: 1 }, deps(judge));
    expect(judge).toHaveBeenCalledWith(expect.objectContaining({ question: "Is the page readable?" }));
    expect(withJudge.passed).toBe(true);
    expect(withJudge.results[0]).toMatchObject({ passed: true, detail: "clear headings", modelJudged: true });

    const failing = await evaluateAcceptance(
      [judged],
      { workspace, attempt: 1 },
      deps(async () => ({ error: "rate limited" })),
    );
    expect(failing.blocked).toEqual(["AC-J"]);
    expect(failing.results[0]?.detail).toContain("rate limited");
  });
});
