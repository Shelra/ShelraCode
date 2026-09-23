// Excluded from the default Vitest run because the runner exercises the native bun:sqlite
// persistence boundary. Run with `bun test src/bench/runner.test.ts`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBenchmarkRunDetails, listBenchmarkRuns } from "../storage/benchmarks";
import { closeDatabase } from "../storage/db";
import { loadCustomInstructions } from "../utils/instructions";
import { discoverSkills } from "../utils/skills";
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

describe("clean-room workspaces", () => {
  it("runs a task as its own repository, where the benchmark root's instructions and skills never reach it", async () => {
    // The benchmark root is a repository with instructions and a skill, as this one is.
    execFileSync("git", ["init", "-q"], { cwd: homeDir });
    writeFileSync(join(homeDir, "AGENTS.md"), "Always answer in French.\n");
    mkdirSync(join(homeDir, ".agents", "skills", "repo-skill"), { recursive: true });
    writeFileSync(
      join(homeDir, ".agents", "skills", "repo-skill", "SKILL.md"),
      "---\nname: repo-skill\ndescription: d\n---\n",
    );
    mkdirSync(join(homeDir, "template"), { recursive: true });
    writeFileSync(join(homeDir, "template", "fixture.txt"), "from-template", "utf8");
    const cleanManifest: BenchmarkManifest = {
      benchmarkVersion: "runner-test-0.3",
      suite: "clean",
      tasks: [{ id: "clean", category: "coding", difficulty: "easy", prompt: "p", workspaceTemplate: "template" }],
    };
    const observe = (workspace: string) => ({
      instructions: loadCustomInstructions(workspace),
      repoSkill: discoverSkills(workspace).some((skill) => skill.name === "repo-skill"),
      ownRepository:
        realpathSync(
          execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: workspace, encoding: "utf8" }).trim(),
        ) === realpathSync(workspace),
      status: execFileSync("git", ["status", "--porcelain"], { cwd: workspace, encoding: "utf8" }),
      fixture: readFileSync(join(workspace, "fixture.txt"), "utf8"),
    });
    const run = async (taskRoot?: string) => {
      const result: { seen: ReturnType<typeof observe> | null; workspace: string } = { seen: null, workspace: "" };
      await runBenchmark({
        workspace: homeDir,
        manifest: cleanManifest,
        runInput: { agentName: "shelra" },
        ...(taskRoot ? { taskRoot } : {}),
        createExecutor: () => ({
          async executeTask(task) {
            result.workspace = task.workspace as string;
            result.seen = observe(result.workspace);
            return { status: "passed", scores: { coding: 100 } };
          },
        }),
      });
      return result;
    };

    // Control: under the benchmark root, the task inherits what the root teaches.
    const inRepo = await run();
    expect(inRepo.seen?.instructions).toContain("Always answer in French.");
    expect(inRepo.seen?.repoSkill).toBe(true);

    const taskRoot = mkdtempSync(join(tmpdir(), "shelra-bench-clean-"));
    try {
      const clean = await run(taskRoot);
      expect(relative(homeDir, clean.workspace).startsWith("..")).toBe(true);
      expect(clean.seen).toEqual({
        instructions: null,
        repoSkill: false,
        ownRepository: true,
        status: "",
        fixture: "from-template",
      });
    } finally {
      rmSync(taskRoot, { recursive: true, force: true });
    }
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

  it("continues a chain in one directory, each session starting from a commit of what the last one left", async () => {
    const template = join(homeDir, "template");
    mkdirSync(template, { recursive: true });
    writeFileSync(join(template, "fixture.txt"), "v1\n");
    const chain: BenchmarkManifest = {
      benchmarkVersion: "runner-test-0.1",
      suite: "chain",
      tasks: [
        { id: "one", category: "memory", difficulty: "easy", prompt: "p", workspaceTemplate: "template" },
        { id: "two", category: "memory", difficulty: "easy", prompt: "p", continueIn: "one" },
        { id: "three", category: "memory", difficulty: "easy", prompt: "p", continueIn: "two" },
      ],
    };
    const git = (workspace: string, ...args: string[]) =>
      execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
    const taskRoot = mkdtempSync(join(tmpdir(), "shelra-bench-chain-"));
    const seen: Record<string, unknown> = {};
    try {
      await runBenchmark({
        workspace: homeDir,
        manifest: chain,
        runInput: { agentName: "shelra" },
        taskRoot,
        createExecutor: () => ({
          async executeTask(task) {
            const workspace = task.workspace as string;
            seen[`${task.id}:workspace`] = workspace;
            seen[`${task.id}:status`] = git(workspace, "status", "--porcelain");
            seen[`${task.id}:fixture`] = readFileSync(join(workspace, "fixture.txt"), "utf8");
            seen[`${task.id}:commits`] = git(workspace, "log", "--format=%s");
            if (task.id === "one") writeFileSync(join(workspace, "fixture.txt"), "v2\n");
            // An agent that removed the repository: the next session still starts from a clean commit.
            if (task.id === "two") {
              rmSync(join(workspace, ".git"), { recursive: true, force: true });
              writeFileSync(join(workspace, "fixture.txt"), "v3\n");
            }
            return { status: "passed", scores: { coding: 100 } };
          },
        }),
      });
      expect(seen["two:workspace"]).toBe(seen["one:workspace"]);
      expect(seen["three:workspace"]).toBe(seen["one:workspace"]);
      expect(seen).toMatchObject({
        "one:status": "",
        "one:fixture": "v1\n",
        "one:commits": "Benchmark fixture",
        "two:status": "",
        "two:fixture": "v2\n",
        "two:commits": "Benchmark state before two\nBenchmark fixture",
        "three:status": "",
        "three:fixture": "v3\n",
        "three:commits": "Benchmark state before three",
      });
    } finally {
      rmSync(taskRoot, { recursive: true, force: true });
    }
  });
});
