import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeCodeExecutor, parseClaudeStream } from "./claude-code-executor";
import { createCodexExecutor, parseCodexEvents } from "./codex-executor";
import { referenceEnv, runJsonLinesProcess } from "./reference-agent";
import type { BenchmarkTaskDefinition } from "./types";

let root: string;
let workspace: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shelra-reference-agents-"));
  workspace = join(root, "task");
  mkdirSync(join(workspace, "src"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const line = (value: unknown) => JSON.stringify(value);

/** A stand-in for a reference CLI: a script that answers its stdin with canned events. */
function fakeCli(events: unknown[], writes?: { path: string; content: string }): { file: string; args: string[] } {
  const script = join(root, `fake-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(
    script,
    [
      'import { writeFileSync } from "node:fs";',
      "let input = '';",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      writes ? `  writeFileSync(${JSON.stringify(writes.path)}, ${JSON.stringify(writes.content)});` : "",
      `  for (const event of ${JSON.stringify(events)}) console.log(JSON.stringify(event));`,
      "});",
    ].join("\n"),
  );
  return { file: process.execPath, args: [script] };
}

function task(): BenchmarkTaskDefinition {
  return {
    id: "01-slugify",
    category: "coding",
    difficulty: "easy",
    prompt: "Implement slugify in src/slug.ts.",
    workspace,
    acceptanceCriteria: [
      { id: "AC-FILE", description: "slug.ts exists", check: { kind: "file_exists", path: "src/slug.ts" } },
    ],
  };
}

const CLAUDE_EVENTS = [
  {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", name: "Write", input: { file_path: "src/slug.ts", content: "x" } },
        { type: "tool_use", name: "Bash", input: { command: "bun test" } },
        { type: "tool_use", name: "Bash", input: { command: "echo done" } },
      ],
    },
  },
  { type: "user", message: { content: [{ type: "tool_result", is_error: true }] } },
  {
    type: "result",
    result: "Implemented slugify.",
    num_turns: 4,
    total_cost_usd: 0.012,
    is_error: false,
    subtype: "success",
    usage: { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 10, output_tokens: 20 },
    modelUsage: { "claude-sonnet-5": {} },
  },
];

describe("reading a reference agent's events", () => {
  it("reads Claude Code's stream: tools, checks by program, failures, tokens and cost", () => {
    const turn = parseClaudeStream([...CLAUDE_EVENTS.map(line), "not json"]);
    expect(turn).toMatchObject({
      toolCalls: 3,
      commands: ["bun test", "echo done"],
      verificationCommands: 1,
      failedToolResults: 1,
      filesChanged: 1,
      llmCalls: 4,
      finalText: "Implemented slugify.",
      error: null,
      tokens: { inputTokens: 160, outputTokens: 20, totalTokens: 180 },
      costUsd: 0.012,
      details: { subtype: "success", modelsUsed: ["claude-sonnet-5"] },
    });
  });

  it("reads Codex's events: commands with exit codes, file changes, turns and errors", () => {
    const turn = parseCodexEvents([
      line({ type: "item.completed", item: { type: "command_execution", command: ["bun", "test"], exit_code: 1 } }),
      line({ type: "item.completed", item: { type: "file_change", changes: [{ path: "src/slug.ts" }] } }),
      line({ type: "item.completed", item: { type: "agent_message", text: "Done." } }),
      line({ type: "turn.completed", usage: { input_tokens: 30, output_tokens: 5, reasoning_output_tokens: 7 } }),
      line({ type: "turn.failed", error: { message: "quota" } }),
    ]);
    expect(turn).toMatchObject({
      toolCalls: 2,
      commands: ["bun test"],
      verificationCommands: 1,
      failedToolResults: 1,
      filesChanged: 1,
      llmCalls: 1,
      finalText: "Done.",
      tokens: { inputTokens: 30, outputTokens: 5, totalTokens: 35 },
      details: { reasoningTokens: 7 },
    });
    expect(turn.error).toContain("quota");
  });
});

describe("runJsonLinesProcess", () => {
  it("feeds the prompt on stdin and collects one event per line", async () => {
    const run = await runJsonLinesProcess(fakeCli([{ a: 1 }, { b: 2 }]), [], {
      cwd: workspace,
      env: process.env,
      stdin: "prompt",
      timeoutMs: 30_000,
    });
    expect(run).toMatchObject({ lines: ['{"a":1}', '{"b":2}'], exitCode: 0, timedOut: false });
  });

  it("reports a missing executable as a failed run instead of throwing", async () => {
    const run = await runJsonLinesProcess({ file: join(root, "no-such-agent") }, [], {
      cwd: workspace,
      env: process.env,
      stdin: "prompt",
      timeoutMs: 30_000,
    });
    expect(run.exitCode).not.toBe(0);
    expect(run.lines).toEqual([]);
    expect(run.stderr).not.toBe("");
  });
});

describe("referenceEnv", () => {
  it("gives the agent the real home for its login and drops variables of another session", () => {
    const env = referenceEnv({ HOME: "/real/home", USERPROFILE: "C:\\real" }, (key) => key === "PATH_EXTRA_TEST");
    expect(env.HOME).toBe("/real/home");
    expect(env.USERPROFILE).toBe("C:\\real");
  });
});

describe("reference executors", () => {
  it("grades Claude Code's workspace with the same oracle as Shelra", async () => {
    const executor = createClaudeCodeExecutor({
      model: "sonnet",
      benchmarkRoot: root,
      scratchDir: join(root, "claude-scratch"),
      command: fakeCli(CLAUDE_EVENTS, { path: "src/slug.ts", content: "export const slugify = (s) => s;\n" }),
    });

    const execution = await executor.executeTask(task(), { emit: () => {} });

    expect(execution.status).toBe("passed");
    expect(execution.behavior).toMatchObject({ selfVerification: true, falseCompletion: false });
    expect(execution.finalResult).toMatchObject({ harness: "claude-code", model: "sonnet", exitCode: 0 });
  });

  it("counts a Codex turn that ended as done with nothing built as a false completion", async () => {
    const executor = createCodexExecutor({
      benchmarkRoot: root,
      command: fakeCli([
        { type: "item.completed", item: { type: "agent_message", text: "All done." } },
        { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } },
      ]),
    });

    const execution = await executor.executeTask(task(), { emit: () => {} });

    expect(execution.status).toBe("failed");
    expect(execution.failureType).toBe("implementation_failure");
    expect(execution.behavior).toMatchObject({ completionBlocked: false, falseCompletion: true });
  });
});
