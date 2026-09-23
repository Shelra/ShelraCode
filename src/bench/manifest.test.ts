import { describe, expect, it } from "vitest";
import { loadBenchmarkManifest, manifestSummary, parseManifest } from "./manifest";

describe("benchmark manifest", () => {
  it("keeps benchmark-owned task definitions authoritative in persisted summaries", () => {
    const manifest = parseManifest({
      benchmarkVersion: "bench-0.1",
      suite: "full",
      config: { taskCount: 999, suite: "untrusted override" },
      tasks: [
        {
          id: "task-01",
          category: "intent",
          difficulty: "medium",
          prompt: "implement the requested behavior",
          acceptanceCriteria: [{ id: "AC-01", description: "The request is satisfied" }],
        },
      ],
    });

    const summary = manifestSummary(manifest);
    expect(summary.taskCount).toBe(1);
    expect(summary.suite).toBe("full");
    expect(manifest.tasks[0]?.acceptanceCriteria?.[0]?.required).toBeUndefined();
    expect(summary.taskDefinitions).toEqual(manifest.tasks);
  });

  it("rejects malformed or duplicate acceptance criteria", () => {
    expect(() =>
      parseManifest({
        benchmarkVersion: "bench-0.1",
        suite: "full",
        config: "not an object",
        tasks: [],
      }),
    ).toThrow(/config must be an object/iu);

    expect(() =>
      parseManifest({
        benchmarkVersion: "bench-0.1",
        suite: "full",
        tasks: [
          {
            id: "task-01",
            category: "intent",
            difficulty: "medium",
            prompt: "request",
            acceptanceCriteria: [
              { id: "AC-01", description: "first" },
              { id: "AC-01", description: "duplicate" },
            ],
          },
        ],
      }),
    ).toThrow(/duplicate acceptance criterion/iu);
  });

  it("parses strict benchmark-owned oracle checks and template workspaces", () => {
    const manifest = parseManifest({
      benchmarkVersion: "bench-0.2",
      suite: "core",
      oracleMode: "benchmark-owned",
      tasks: [
        {
          id: "task-01",
          category: "coding",
          difficulty: "hard",
          workspaceTemplate: "bench/fixtures/task-01",
          prompt: "fix it",
          acceptanceCriteria: [
            {
              id: "AC-ORACLE",
              description: "external oracle passes",
              check: { kind: "command_succeeds", command: "bun run {{benchmarkRoot}}/oracle.ts" },
            },
          ],
        },
      ],
    });

    expect(manifest.oracleMode).toBe("benchmark-owned");
    expect(manifest.tasks[0]?.workspaceTemplate).toBe("bench/fixtures/task-01");
    expect(manifest.tasks[0]?.acceptanceCriteria?.[0]?.check).toEqual({
      kind: "command_succeeds",
      command: "bun run {{benchmarkRoot}}/oracle.ts",
    });
  });

  it("rejects strict suites without deterministic checks", () => {
    expect(() =>
      parseManifest({
        benchmarkVersion: "bench-0.2",
        suite: "core",
        oracleMode: "benchmark-owned",
        tasks: [
          {
            id: "task-01",
            category: "coding",
            difficulty: "easy",
            prompt: "fix it",
            acceptanceCriteria: [{ id: "AC-ORACLE", description: "missing check" }],
          },
        ],
      }),
    ).toThrow(/deterministic check/iu);
  });

  it("parses a chain of sessions and the simulated user's approvals, and rejects a chain that forks", () => {
    const step = (id: string, extra: Record<string, unknown>) => ({
      id,
      category: "memory",
      difficulty: "medium",
      prompt: "p",
      ...extra,
    });
    const chain = parseManifest({
      benchmarkVersion: "chain-0.1",
      suite: "chain",
      tasks: [
        step("s1", { workspaceTemplate: "fixture", approveDecisions: [] }),
        step("s2", { continueIn: "s1", approveDecisions: ["never (?:remove|delete)", "soft"] }),
      ],
    });
    expect(chain.tasks[0]?.approveDecisions).toEqual([]);
    expect(chain.tasks[1]).toMatchObject({ continueIn: "s1", approveDecisions: ["never (?:remove|delete)", "soft"] });

    const parse = (tasks: unknown[]) => () => parseManifest({ benchmarkVersion: "c", suite: "c", tasks });
    expect(parse([step("s1", { continueIn: "s0" })])).toThrow(/not an earlier task/iu);
    expect(parse([step("s1", { workspaceTemplate: "f", continueIn: "s0" })])).toThrow(/cannot combine/iu);
    expect(parse([step("s1", { approveDecisions: ["("] })])).toThrow(/invalid regular expression/iu);
    expect(parse([step("s1", { approveDecisions: "soft" })])).toThrow(/array of regular expressions/iu);
    // Once s2 continued in s1's directory, s1's result is gone: neither a second chain nor a copy can start there.
    const forked = [step("s1", { workspaceTemplate: "f" }), step("s2", { continueIn: "s1" })];
    expect(parse([...forked, step("s3", { continueIn: "s1" })])).toThrow(/already continued in its directory/iu);
    expect(parse([...forked, step("s3", { workspaceFrom: "s1" })])).toThrow(/already continued in its directory/iu);
  });

  it("loads the checked-in task ladder as a strict benchmark", () => {
    const manifest = loadBenchmarkManifest(process.cwd(), "bench/suites/shelra-agent-core-v0.2.json");
    expect(manifest.oracleMode).toBe("benchmark-owned");
    expect(manifest.tasks).toHaveLength(8);
    expect(manifest.tasks.at(-1)?.difficulty).toBe("expert");
    expect(manifest.tasks.every((task) => task.workspaceTemplate && task.acceptanceCriteria?.length === 2)).toBe(true);
  });
});
