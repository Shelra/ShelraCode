// Excluded from the default Vitest run because bun:sqlite needs Bun's native test loader on
// this Windows setup. Run with `bun test src/storage/benchmarks.test.ts`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendBenchmarkEvent,
  compareBenchmarkRuns,
  createBenchmarkRun,
  finalizeBenchmarkRun,
  getBenchmarkRun,
  getBenchmarkRunDetails,
  listBenchmarkLeaderboard,
  listBenchmarkRuns,
  markBenchmarkRunInterrupted,
  recordBenchmarkTaskResult,
  setBenchmarkBaseline,
  startBenchmarkTask,
} from "./benchmarks";
import { closeDatabase } from "./db";

let homeDir: string;
let originalHome: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "shelra-bench-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = homeDir;
  closeDatabase();
});

afterEach(() => {
  closeDatabase();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(homeDir, { recursive: true, force: true });
});

function createRun(_overall: number, options: { version?: string; model?: string; eligible?: boolean } = {}) {
  return createBenchmarkRun({
    workspace: homeDir,
    benchmarkVersion: options.version ?? "bench-0.1",
    suite: "full",
    agentName: "shelra",
    leaderboardEligible: options.eligible ?? true,
    agentVersion: "1.1.7",
    agentConfig: { harness: "test" },
    model: options.model ?? "openrouter/free",
    modelProvider: "OpenRouter",
    repositoryCommit: "abc1234",
    repositoryDirty: false,
    shelraVersion: "1.1.7",
    environment: { platform: "test", runtimeVersions: { bun: "test" } },
    benchmarkConfig: { scorePolicy: "test" },
    taskCount: 1,
    seed: "fixed-seed",
  });
}

function completeRun(runId: string, overall: number, taskId = "task-01") {
  startBenchmarkTask({ runId, taskId, category: "coding", difficulty: "medium" });
  recordBenchmarkTaskResult({
    runId,
    taskId,
    category: "coding",
    difficulty: "medium",
    status: overall >= 80 ? "passed" : "failed",
    scores: { coding: overall, intent: overall, verification: overall },
    tokens: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    cost: { micros: 42_000, kind: "exact", source: "test" },
    behavior: { verificationAttempts: 1, repairsAttempted: overall < 80 ? 1 : 0 },
    failureType: overall < 80 ? "intent_failure" : null,
    acceptance: [
      {
        id: "AC-01",
        description: "The implementation satisfies the request",
        status: overall >= 80 ? "passed" : "failed",
        required: true,
      },
    ],
    finalResult: { verified: overall >= 80 },
  });
  return finalizeBenchmarkRun({
    runId,
    status: "completed",
    scores: { overall, coding: overall, intent: overall, verification: overall },
    tokens: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    cost: { micros: 42_000, kind: "exact", source: "test" },
  });
}

describe("benchmark run persistence", () => {
  it("keeps three immutable executions after a database restart", () => {
    const first = completeRun(createRun(70).runId, 70);
    const second = completeRun(createRun(80).runId, 80);
    const third = completeRun(createRun(90).runId, 90);

    expect(first.runNumber).toBeLessThan(second.runNumber);
    expect(second.runNumber).toBeLessThan(third.runNumber);
    expect(listBenchmarkRuns({ agentName: "shelra", limit: 10 }).map((run) => run.runId)).toEqual([
      third.runId,
      second.runId,
      first.runId,
    ]);

    closeDatabase();
    const afterRestart = listBenchmarkRuns({ agentName: "shelra", limit: 10 });
    expect(afterRestart).toHaveLength(3);
    expect(getBenchmarkRun(first.runId)?.scores.overall).toBe(70);
    expect(getBenchmarkRun(second.runId)?.scores.overall).toBe(80);
    expect(getBenchmarkRun(third.runId)?.scores.overall).toBe(90);
    expect(getBenchmarkRun(first.runId)?.resolvedRate).toBe(0);
    expect(getBenchmarkRun(second.runId)?.resolvedRate).toBe(100);
  });

  it("retains partial task evidence when an active run is interrupted", () => {
    const run = createBenchmarkRun({
      workspace: homeDir,
      benchmarkVersion: "bench-0.1",
      suite: "memory",
      agentName: "shelra",
      taskCount: 2,
      processId: null,
    });
    startBenchmarkTask({ runId: run.runId, taskId: "memory-01", category: "memory", difficulty: "hard" });
    recordBenchmarkTaskResult({
      runId: run.runId,
      taskId: "memory-01",
      category: "memory",
      difficulty: "hard",
      status: "failed",
      failureReason: "restart lost task state",
      failureType: "intent_failure",
      acceptance: [{ id: "AC-01", description: "Resume retains intent", status: "not_run", required: true }],
    });
    startBenchmarkTask({ runId: run.runId, taskId: "memory-02", category: "memory", difficulty: "hard" });
    const interrupted = markBenchmarkRunInterrupted(run.runId, "runner crashed after task 1");

    expect(interrupted?.status).toBe("interrupted");
    expect(interrupted?.completedTaskCount).toBe(1);
    closeDatabase();
    expect(getBenchmarkRun(run.runId)?.status).toBe("interrupted");
    const details = getBenchmarkRunDetails(run.runId);
    expect(details?.tasks).toHaveLength(2);
    expect(details?.tasks[0]?.failureReason).toBe("restart lost task state");
    expect(details?.tasks[0]?.failureType).toBe("intent_failure");
    expect(details?.tasks[0]?.acceptance[0]?.status).toBe("not_run");
    expect(details?.tasks[1]?.status).toBe("interrupted");
    expect(details?.tasks[1]?.failureType).toBe("timeout");
  });

  it("reconstructs criteria, usage, cost, commit and benchmark version", () => {
    const run = completeRun(createRun(88, { version: "bench-0.2", model: "openrouter/test:free" }).runId, 88);
    const details = getBenchmarkRunDetails(run.runId);

    expect(details?.benchmarkVersion).toBe("bench-0.2");
    expect(details?.model).toBe("openrouter/test:free");
    expect(details?.repositoryCommit).toBe("abc1234");
    expect(details?.tasks[0]?.acceptance[0]?.id).toBe("AC-01");
    expect(details?.tasks[0]?.tokens.totalTokens).toBe(30);
    expect(details?.tasks[0]?.cost.micros).toBe(42_000);
    expect(details?.tasks[0]?.failureType).toBeNull();
  });

  it("computes comparison deltas and keeps methodology boundaries explicit", () => {
    const before = completeRun(createRun(70).runId, 70);
    const after = completeRun(createRun(80).runId, 80);
    const comparison = compareBenchmarkRuns([before.runId, after.runId]);

    expect(comparison.comparable).toBe(true);
    expect(comparison.metrics.find((metric) => metric.dimension === "overall")?.deltaFromFirst).toBe(10);
    expect(comparison.taskChanges.improved).toEqual(["task-01"]);

    const incompatible = completeRun(createRun(85, { version: "bench-0.2" }).runId, 85);
    const blocked = compareBenchmarkRuns([before.runId, incompatible.runId]);
    expect(blocked.comparable).toBe(false);
    expect(blocked.costDeltaMicros).toBeNull();

    const differentModel = completeRun(createRun(82, { model: "openrouter/another-controlled-model" }).runId, 82);
    const modelBlocked = compareBenchmarkRuns([after.runId, differentModel.runId]);
    expect(modelBlocked.comparable).toBe(false);
    expect(modelBlocked.reason).toMatch(/model/iu);
  });

  it("pins a completed run as baseline without mutating its measured result", () => {
    const run = completeRun(createRun(84).runId, 84);
    const baseline = setBenchmarkBaseline(run.runId);
    expect(baseline.runId).toBe(run.runId);
    expect(getBenchmarkRun(run.runId)?.finalizedAt).toBeInstanceOf(Date);
    expect(() => finalizeBenchmarkRun({ runId: run.runId, status: "completed", scores: { overall: 99 } })).toThrow(
      /immutable/iu,
    );
  });

  it("keeps diagnostic completed runs out of the primary leaderboard", () => {
    const diagnostic = completeRun(createRun(100, { model: "diagnostic-model", eligible: false }).runId, 100);
    const eligible = completeRun(createRun(82, { model: "certified-model", eligible: true }).runId, 82);

    expect(listBenchmarkLeaderboard({ agentName: "shelra" }).map((run) => run.runId)).toEqual([eligible.runId]);
    expect(getBenchmarkRun(diagnostic.runId)?.leaderboardEligible).toBe(false);
    expect(getBenchmarkRun(eligible.runId)?.leaderboardEligible).toBe(true);
  });

  it("does not allow a diagnostic run to become the baseline", () => {
    const diagnostic = completeRun(createRun(100, { model: "diagnostic-model", eligible: false }).runId, 100);

    expect(() => setBenchmarkBaseline(diagnostic.runId)).toThrow(/leaderboard-eligible/iu);
  });

  it("redacts credentials from persisted operational text", () => {
    const run = createBenchmarkRun({
      workspace: homeDir,
      benchmarkVersion: "bench-0.1",
      suite: "security",
      agentName: "shelra",
    });
    appendBenchmarkEvent({
      runId: run.runId,
      type: "error",
      message: "provider rejected apiKey=sk-or-v1-test-secret",
    });

    const event = getBenchmarkRunDetails(run.runId)?.events.at(-1);
    expect(event?.message).toBe("provider rejected apiKey=[redacted]");
    expect(event?.message).not.toContain("test-secret");

    const taskRun = createBenchmarkRun({
      workspace: homeDir,
      benchmarkVersion: "bench-0.1",
      suite: "security",
      agentName: "shelra",
    });
    recordBenchmarkTaskResult({
      runId: taskRun.runId,
      taskId: "security-01",
      category: "coding",
      difficulty: "easy",
      status: "failed",
      acceptance: [{ id: "AC-01", description: "apiKey=sk-or-v1-criterion-secret", status: "failed", required: true }],
      finalResult: { message: "authorization: bearer-secret" },
    });
    const taskDetails = getBenchmarkRunDetails(taskRun.runId);
    expect(taskDetails?.tasks[0]?.acceptance[0]?.description).toBe("apiKey=[redacted]");
    expect(taskDetails?.tasks[0]?.finalResult?.message).toBe("authorization: [redacted]");
  });
});
