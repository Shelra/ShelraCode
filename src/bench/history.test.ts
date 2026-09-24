// Excluded from the default Vitest run because it reads the native bun:sqlite database the runner
// writes. Run with `bun test src/bench/history.test.ts`.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, getDatabasePath } from "../storage/db";
import { appendRunsToHistory, cleanText, type History, saveHistory } from "./history";
import { runBenchmark } from "./runner";
import type { BenchmarkManifest } from "./types";

let homeDir: string;
let repositoryRoot: string;
let originalHome: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "shelra-bench-history-test-"));
  repositoryRoot = join(homeDir, "repo");
  mkdirSync(join(repositoryRoot, "bench", "history"), { recursive: true });
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

const manifest: BenchmarkManifest = {
  benchmarkVersion: "history-test-0.1",
  suite: "history",
  tasks: [{ id: "task-01", category: "coding", difficulty: "easy", prompt: "p" }],
};

async function oneRun(): Promise<string> {
  const summary = await runBenchmark({
    workspace: homeDir,
    manifest,
    runInput: { agentName: "shelra", agentConfig: { ablation: "gate" } },
    createExecutor: () => ({
      async executeTask() {
        return {
          status: "failed",
          scores: { coding: 0 },
          behavior: { falseCompletion: true },
          failureReason: `workspace ${join(homeDir, "x", "tasks", "run_1", "task-01")} failed`,
        };
      },
    }),
  });
  return summary.runId;
}

describe("cleanText", () => {
  it("removes the home folder, user and machine, and reduces both workspace layouts to their task", () => {
    const identities = [{ home: "C:\\Users\\alice", user: "alice", host: "ALICE-PC" }];
    const text = cleanText(
      "C:\\Users\\alice\\repo\\.shelra\\bench\\runs\\run_1\\tasks\\01-a failed on ALICE-PC; /tmp/shelra-bench-x/tasks/run_20260923_ab/02-b too",
      identities,
    );
    expect(text).not.toContain("alice");
    expect(text).not.toContain("ALICE-PC");
    expect(text).toContain("<workspace>/01-a");
    expect(text).toContain("<workspace>/02-b");
  });
});

describe("appendRunsToHistory", () => {
  it("adds only the named runs, cleaned, and merging them again changes nothing", async () => {
    const first = await oneRun();
    const second = await oneRun();
    const databasePath = getDatabasePath();

    const merged = appendRunsToHistory({ repositoryRoot, databasePath, source: "test", runIds: [second] });
    expect(merged).toMatchObject({ runs: 1, added: 1, replaced: 0 });
    const history = JSON.parse(readFileSync(merged.historyPath, "utf8")) as History;
    expect(history.runs.map((run) => run.id)).toEqual([second]);
    expect(history.runs[0]?.agent.config).toMatchObject({ ablation: "gate" });
    const text = JSON.stringify(history);
    expect(text).not.toContain(homeDir);
    expect(text).toContain('"falseCompletion":true');

    const again = appendRunsToHistory({ repositoryRoot, databasePath, source: "test", runIds: [second] });
    expect(again).toMatchObject({ runs: 1, added: 0, replaced: 1 });
    const unchanged = JSON.parse(readFileSync(again.historyPath, "utf8")) as History;
    expect(unchanged.runs).toEqual(history.runs);

    const both = appendRunsToHistory({ repositoryRoot, databasePath, source: "test", runIds: [first, second] });
    expect(both).toMatchObject({ runs: 2, added: 1, replaced: 1 });
  });
});

describe("saveHistory", () => {
  it("replaces a longer file entirely and reads back exactly what it wrote", () => {
    const path = join(repositoryRoot, "bench", "history", "benchmark-history.json");
    writeFileSync(path, `${"x".repeat(50_000)}\n`);
    const history: History = { schemaVersion: 1, description: "d", updatedAt: "", runs: [], fieldCases: [] };

    saveHistory(path, history, repositoryRoot);

    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(history, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ schemaVersion: 1, runs: [] });
  });
});
