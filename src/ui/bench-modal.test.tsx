import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { describe, expect, it } from "vitest";
import type {
  BenchmarkLeaderboardEntry,
  BenchmarkRunComparison,
  BenchmarkRunDetails,
  BenchmarkRunSummary,
  BenchmarkTaskResult,
} from "../bench/types";
import { BenchModal } from "./bench-modal";
import { dark, light } from "./theme";

const NOW = new Date("2026-09-13T22:05:15.000Z");

function run(
  runNumber: number,
  status: BenchmarkRunSummary["status"],
  scores: BenchmarkRunSummary["scores"],
  overrides: Partial<BenchmarkRunSummary> = {},
): BenchmarkRunSummary {
  return {
    runId: `run_fixture_${runNumber}`,
    runNumber,
    workspaceId: "workspace-fixture",
    workspacePath: "D:/fixture/shelra",
    status,
    createdAt: new Date(NOW.getTime() - runNumber * 3_600_000),
    startedAt: new Date(NOW.getTime() - runNumber * 3_600_000),
    finishedAt: status === "completed" || status === "failed" ? NOW : null,
    heartbeatAt: NOW,
    benchmarkVersion: runNumber === 1 ? "bench-0.1" : "bench-0.2",
    suite: "full",
    agentName: "shelra",
    leaderboardEligible: true,
    agentVersion: `1.${runNumber}.0`,
    agentConfig: { harness: "autonomy-runtime" },
    configurationFingerprint: `fixture-config-${runNumber === 1 ? "old" : "latest"}`,
    model: runNumber % 2 === 0 ? "openrouter/free" : "openrouter/frontier-controlled",
    modelProvider: "OpenRouter",
    modelVersion: null,
    repositoryCommit: `commit${runNumber}abcdef`,
    repositoryDirty: runNumber === 2,
    repositoryDiffHash: null,
    shelraVersion: `1.${runNumber}.0`,
    environment: { platform: "fixture", runtimeVersions: { bun: "fixture" } },
    benchmarkConfig: { suite: "full" },
    seed: "fixture-seed",
    taskCount: 3,
    completedTaskCount: status === "interrupted" ? 1 : 3,
    resolvedTaskCount: status === "completed" ? 3 : 0,
    resolvedRate: status === "completed" ? 100 : 0,
    scores,
    tokens: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    cost: { micros: 42_000, kind: "exact", source: "fixture" },
    durationMs: 684_000,
    failureReason: status === "interrupted" ? "process stopped" : null,
    failureType: status === "interrupted" ? "timeout" : null,
    processId: null,
    finalizedAt: status === "completed" || status === "failed" ? NOW : null,
    ...overrides,
  };
}

function task(status: BenchmarkTaskResult["status"], score: number): BenchmarkTaskResult {
  return {
    runId: "run_fixture_3",
    taskId: status === "failed" ? "memory-resume-02" : "intent-dashboard-01",
    category: "intent",
    difficulty: "hard",
    definition: {
      id: status === "failed" ? "memory-resume-02" : "intent-dashboard-01",
      category: "intent",
      difficulty: "hard",
      prompt: "Build the requested dashboard and verify its acceptance criteria.",
    },
    status,
    startedAt: NOW,
    finishedAt: NOW,
    durationMs: 54_000,
    llmDurationMs: 32_000,
    toolDurationMs: 18_000,
    verificationDurationMs: 4_000,
    repairDurationMs: null,
    scores: { coding: score, intent: score, verification: status === "passed" ? 92 : 40 },
    tokens: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    cost: { micros: 42_000, kind: "exact", source: "fixture" },
    behavior: { verificationAttempts: 2, repairsAttempted: status === "failed" ? 1 : 0 },
    acceptance: [
      {
        id: "AC-01",
        description: "Responsive layout below 768px",
        status: status === "passed" ? "passed" : "failed",
        required: true,
      },
      { id: "AC-02", description: "Live clock retains full date", status: "passed", required: true },
    ],
    finalResult: { verified: status === "passed" },
    failureReason: status === "failed" ? "Responsive acceptance criterion failed" : null,
    failureType: status === "failed" ? "intent_failure" : null,
    evidence: [],
    objectiveRunDir: "D:/fixture/.shelra/objectives/run",
  };
}

const latest = run(3, "completed", { overall: 84.7, coding: 86.2, intent: 94.2, verification: 92.8 });
const previous = run(2, "failed", { intent: 83.1, verification: 81.8 });
const old = run(1, "completed", { overall: 79.2, coding: 80.1, intent: 90.1, verification: 81.8 });
const interrupted = run(0, "interrupted", {}, { benchmarkVersion: "bench-0.1" });

const details: BenchmarkRunDetails = {
  ...latest,
  tasks: [task("passed", 94), task("failed", 40)],
  events: [],
  artifacts: [],
};

const comparison: BenchmarkRunComparison = {
  runs: [old, latest],
  comparable: true,
  reason: null,
  metrics: [
    { dimension: "overall", values: [79.2, 84.7], deltaFromFirst: 5.5 },
    { dimension: "intent", values: [90.1, 94.2], deltaFromFirst: 4.1 },
    { dimension: "verification", values: [81.8, 92.8], deltaFromFirst: 11 },
  ],
  taskChanges: { improved: ["intent-dashboard-01"], regressed: ["memory-resume-02"], unchanged: ["coding-01"] },
  costDeltaMicros: 3_000,
  durationDeltaMs: 33_000,
};

function leaderboard(entries: BenchmarkRunSummary[]): BenchmarkLeaderboardEntry[] {
  return entries.map((entry, index) => ({ ...entry, runCount: index + 1 }));
}

describe("Shelra Bench visual contract", () => {
  it("renders the Shelra-first evolution, real statuses and dense leaderboard", async () => {
    const screen = await testRender(
      <BenchModal
        t={dark}
        width={140}
        height={42}
        view="leaderboard"
        leaderboard={leaderboard([latest, old])}
        runs={[latest, previous, old, interrupted]}
        selectedIndex={0}
        selectedRun={latest}
        details={details}
        comparison={comparison}
        baseline={old}
        filter=""
        filterActive={false}
        trendDimension="overall"
        loading={false}
        error={null}
        live={null}
      />,
      { width: 140, height: 42 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    expect(frame).toContain("Shelra Bench");
    expect(frame).toContain("SHELRA EVOLUTION");
    expect(frame).toContain("Latest 84.7");
    expect(frame).toContain("Baseline 79.2");
    expect(frame).toContain("Shelra harness configurations");
    expect(frame).toContain("openrouter/frontier");
    expect(frame).toContain("commit3a");
    expect(frame).not.toContain("Claude Code");
    screen.renderer.destroy();
  });

  it("shows failed/interrupted history and per-criterion evidence in light mode", async () => {
    const screen = await testRender(
      <BenchModal
        t={light}
        width={120}
        height={36}
        view="history"
        leaderboard={leaderboard([latest])}
        runs={[latest, previous, interrupted]}
        selectedIndex={1}
        selectedRun={previous}
        details={details}
        comparison={comparison}
        baseline={latest}
        filter="memory"
        filterActive={false}
        trendDimension="verification"
        loading={false}
        error={null}
        live={null}
      />,
      { width: 120, height: 36 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();
    const colors = screen.captureSpans();

    expect(frame).toContain("Run history");
    expect(frame).toContain("FAIL");
    expect(frame).toContain("INTERRUPTED");
    expect(frame).toContain("Model is a controlled variable");
    expect(colors.lines.some((line) => line.spans.some((span) => span.fg.equals(RGBA.fromHex(light.accent))))).toBe(
      true,
    );
    screen.renderer.destroy();
  });

  it("renders comparison deltas, regressions and actual task criteria", async () => {
    const screen = await testRender(
      <BenchModal
        t={dark}
        width={140}
        height={42}
        view="compare"
        leaderboard={[]}
        runs={[latest, old]}
        selectedIndex={0}
        selectedRun={latest}
        details={details}
        comparison={comparison}
        baseline={old}
        filter=""
        filterActive={false}
        trendDimension="overall"
        loading={false}
        error={null}
        live={null}
      />,
      { width: 140, height: 42 },
    );
    await screen.renderOnce();
    const comparisonFrame = screen.captureCharFrame();
    expect(comparisonFrame).toContain("+5.5");
    expect(comparisonFrame).toContain("Tasks regressed 1");
    screen.renderer.destroy();

    const taskScreen = await testRender(
      <BenchModal
        t={dark}
        width={140}
        height={42}
        view="tasks"
        leaderboard={[]}
        runs={[latest]}
        selectedIndex={0}
        selectedRun={latest}
        details={details}
        comparison={comparison}
        baseline={old}
        filter=""
        filterActive={false}
        trendDimension="overall"
        loading={false}
        error={null}
        live={null}
      />,
      { width: 140, height: 42 },
    );
    await taskScreen.renderOnce();
    const taskFrame = taskScreen.captureCharFrame();
    expect(taskFrame).toContain("AC-01 Responsive layout below 768px");
    expect(taskFrame).toContain("AC-02 Live clock retains full date");
    expect(taskFrame).toContain("verification attempt");
    taskScreen.renderer.destroy();

    const trendScreen = await testRender(
      <BenchModal
        t={dark}
        width={120}
        height={32}
        view="trend"
        leaderboard={[]}
        runs={[latest, old]}
        selectedIndex={0}
        selectedRun={latest}
        details={details}
        comparison={comparison}
        baseline={old}
        filter=""
        filterActive={false}
        trendDimension="cost"
        loading={false}
        error={null}
        live={null}
      />,
      { width: 120, height: 32 },
    );
    await trendScreen.renderOnce();
    const trendFrame = trendScreen.captureCharFrame();
    expect(trendFrame).toContain("Shelra cost over time");
    expect(trendFrame).toContain("$0.042");
    trendScreen.renderer.destroy();

    const liveScreen = await testRender(
      <BenchModal
        t={light}
        width={120}
        height={32}
        view="live"
        leaderboard={[]}
        runs={[]}
        selectedIndex={0}
        selectedRun={null}
        details={null}
        comparison={null}
        baseline={null}
        filter=""
        filterActive={false}
        trendDimension="overall"
        loading={false}
        error={null}
        live={{
          run: run(4, "running", {}, { taskCount: 4, completedTaskCount: 1 }),
          currentTaskId: "memory-resume-04",
          currentTaskLabel: "Testing task persistence after restart.",
          passed: 1,
          failed: 0,
          running: 1,
          elapsedMs: 522_000,
        }}
      />,
      { width: 120, height: 32 },
    );
    await liveScreen.renderOnce();
    const liveFrame = liveScreen.captureCharFrame();
    expect(liveFrame).toContain("Live run #4");
    expect(liveFrame).toContain("1 / 4 tasks");
    expect(liveFrame).toContain("memory-resume-04");
    liveScreen.renderer.destroy();
  });
});
