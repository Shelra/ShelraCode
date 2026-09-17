// Excluded from the default Vitest run because the runner exercises the native bun:sqlite
// persistence boundary. Run with `bun test src/bench/runner.test.ts`.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBenchmarkRunDetails, listBenchmarkRuns } from "../storage/benchmarks";
import { closeDatabase } from "../storage/db";
import { type BenchmarkTaskExecutor, runBenchmark } from "./runner";
import type { BenchmarkManifest } from "./types";

let homeDir: string;
let originalHome: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "shelra-bench-runner-test-"));
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
  benchmarkVersion: "runner-test-0.1",
  suite: "core",
  scorePolicy: {
    id: "test-policy",
    version: "1",
    weights: { coding: 0.6, intent: 0.3, verification: 0.1 },
    requiredDimensions: ["coding", "intent", "verification"],
  },
  tasks: [
    {
      id: "task-01",
      category: "coding",
      difficulty: "easy",
      prompt: "implement one thing",
      acceptanceCriteria: [{ id: "AC-01", description: "The change works", required: true }],
    },
    { id: "task-02", category: "verification", difficulty: "medium", prompt: "verify one thing" },
  ],
};

function executor(): BenchmarkTaskExecutor {
  return {
    async executeTask(task, context) {
      context.emit({ type: "note", message: `${task.id} inspected repository` });
      context.emit({ type: "verification", message: `${task.id} verified`, payload: { checked: true } });
      return {
        status: "passed",
        scores: { coding: 80, verification: 90 },
        tokens: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        cost: { micros: 1_000, kind: "exact", source: "test" },
        acceptance: [{ id: "AC-01", description: "works", status: "passed", required: true }],
        behavior: { verificationAttempts: 1 },
      };
    },
  };
}

describe("benchmark runner", () => {
  it("creates the run before execution and persists each task incrementally", async () => {
    const events: string[] = [];
    const result = await runBenchmark({
      workspace: homeDir,
      manifest,
      runInput: {
        agentName: "shelra",
        agentVersion: "test",
        model: "controlled-model",
        modelProvider: "test",
      },
      onRunCreated: (run) => events.push(`created:${run.runNumber}`),
      onEvent: (event) => events.push(event.type),
      createExecutor: () => executor(),
    });

    expect(events[0]).toBe("created:1");
    expect(result.status).toBe("completed");
    expect(result.completedTaskCount).toBe(2);
    expect(result.scores.overall).toBe(87);
    expect(result.scores.intent).toBe(100);
    expect(listBenchmarkRuns({ agentName: "shelra" })).toHaveLength(1);
    expect(getBenchmarkRunDetails(result.runId)?.tasks).toHaveLength(2);
    expect(getBenchmarkRunDetails(result.runId)?.tasks[0]?.definition?.prompt).toBe("implement one thing");
    expect(getBenchmarkRunDetails(result.runId)?.tasks[0]?.definition?.acceptanceCriteria?.[0]?.id).toBe("AC-01");
  });

  it("retains a failed run when executor setup fails after run creation", async () => {
    let createdRunId = "";
    const result = await runBenchmark({
      workspace: homeDir,
      manifest,
      runInput: { agentName: "shelra" },
      onRunCreated: (run) => {
        createdRunId = run.runId;
      },
      createExecutor: () => {
        throw new Error("provider unavailable");
      },
    });

    expect(createdRunId).toMatch(/^run_/u);
    expect(result.runId).toBe(createdRunId);
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("provider unavailable");
    expect(listBenchmarkRuns({ statuses: ["failed"] })).toHaveLength(1);
  });

  it("copies strict-suite templates into a fresh workspace for the executor", async () => {
    const template = join(homeDir, "template");
    mkdirSync(template, { recursive: true });
    writeFileSync(join(template, "fixture.txt"), "from-template", "utf8");
    const strictManifest: BenchmarkManifest = {
      benchmarkVersion: "runner-test-0.2",
      suite: "strict",
      oracleMode: "benchmark-owned",
      tasks: [
        {
          id: "task-template",
          category: "coding",
          difficulty: "medium",
          prompt: "use the fixture",
          workspaceTemplate: "template",
          acceptanceCriteria: [
            {
              id: "AC-ORACLE",
              description: "fixture exists",
              check: { kind: "file_exists", path: "fixture.txt" },
            },
          ],
        },
      ],
      scorePolicy: {
        id: "strict-test-policy",
        version: "1",
        weights: { coding: 0.5, intent: 0.3, verification: 0.2 },
        requiredDimensions: ["coding", "intent", "verification"],
      },
    };
    let executionWorkspace = "";
    const result = await runBenchmark({
      workspace: homeDir,
      manifest: strictManifest,
      runInput: { agentName: "shelra" },
      createExecutor: () => ({
        async executeTask(task) {
          executionWorkspace = task.workspace ?? "";
          expect(executionWorkspace).not.toBe(template);
          expect(existsSync(join(executionWorkspace, "fixture.txt"))).toBe(true);
          expect(readFileSync(join(executionWorkspace, "fixture.txt"), "utf8")).toBe("from-template");
          return {
            status: "passed",
            scores: { coding: 100, intent: 100, verification: 100 },
            acceptance: [{ id: "AC-ORACLE", description: "fixture exists", status: "passed", required: true }],
          };
        },
      }),
    });

    expect(result.status).toBe("completed");
    expect(executionWorkspace).toContain(`${join(homeDir, ".shelra", "bench", "runs")}`);
  });
});

describe("cross-session workspaces", () => {
  it("copies an earlier task's finished workspace, keeping or wiping its memory as declared", async () => {
    const template = join(homeDir, "template");
    mkdirSync(join(template, "src"), { recursive: true });
    writeFileSync(join(template, "src", "index.ts"), "export const a = 1;\n");
    const seen: Record<string, boolean> = {};
    const memoryManifest: BenchmarkManifest = {
      benchmarkVersion: "runner-test-0.1",
      suite: "memory",
      tasks: [
        { id: "learn", category: "memory", difficulty: "easy", prompt: "learn", workspaceTemplate: "template" },
        {
          id: "keep",
          category: "memory",
          difficulty: "easy",
          prompt: "recall",
          workspaceFrom: "learn",
          memoryPolicy: "keep",
        },
        {
          id: "wipe",
          category: "memory",
          difficulty: "easy",
          prompt: "recall",
          workspaceFrom: "learn",
          memoryPolicy: "wipe",
        },
      ],
    };
    const result = await runBenchmark({
      workspace: homeDir,
      manifest: memoryManifest,
      runInput: { agentName: "shelra", agentVersion: "test", model: "m", modelProvider: "test" },
      createExecutor: () => ({
        async executeTask(task) {
          const workspace = task.workspace as string;
          if (task.id === "learn") {
            mkdirSync(join(workspace, ".shelra", "memory"), { recursive: true });
            writeFileSync(join(workspace, ".shelra", "memory", "MEMORY.md"), "- [x](x.md) — learned\n");
            mkdirSync(join(workspace, ".agents", "skills", "x"), { recursive: true });
            writeFileSync(join(workspace, ".agents", "skills", "x", "SKILL.md"), "---\nname: x\ndescription: d\n---\n");
            mkdirSync(join(workspace, ".shelra", "objectives"), { recursive: true });
            writeFileSync(join(workspace, ".shelra", "objectives", "run.json"), "{}");
          } else {
            seen[`${task.id}:memory`] = existsSync(join(workspace, ".shelra", "memory", "MEMORY.md"));
            seen[`${task.id}:skill`] = existsSync(join(workspace, ".agents", "skills", "x", "SKILL.md"));
            seen[`${task.id}:objectives`] = existsSync(join(workspace, ".shelra", "objectives"));
            seen[`${task.id}:code`] = existsSync(join(workspace, "src", "index.ts"));
          }
          return { status: "passed", scores: { coding: 100 } };
        },
      }),
    });
    expect(result.status).toBe("completed");
    expect(seen).toEqual({
      "keep:memory": true,
      "keep:skill": true,
      "keep:objectives": false,
      "keep:code": true,
      "wipe:memory": false,
      "wipe:skill": false,
      "wipe:objectives": false,
      "wipe:code": true,
    });
  });
});
