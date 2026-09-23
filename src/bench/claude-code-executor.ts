import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isVerificationCommand } from "../agent/verification-evidence";
import { gradeWorkspace } from "./grading";
import {
  type ReferenceCommand,
  type ReferenceTurn,
  referenceEnv,
  referenceExecution,
  runJsonLinesProcess,
} from "./reference-agent";
import type { BenchmarkExecutionNotice, BenchmarkTaskExecution } from "./runner";
import type { BenchmarkTaskDefinition } from "./types";

/**
 * Claude Code as a reference agent: `claude -p` runs on the same task workspace Shelra gets, then the
 * same oracle grades it. The person's Claude Code settings, plugins, hooks and MCP servers are not
 * loaded (`--setting-sources ""`, `--strict-mcp-config`), auto memory goes to a scratch folder and no
 * session is saved; only the login under the real home is used.
 */
export interface ClaudeCodeExecutorOptions {
  /** A Claude Code model alias or id (`sonnet`); without one, Claude Code uses its own default. */
  model?: string;
  benchmarkRoot: string;
  /** Where Claude Code's auto memory goes for the run, so the person's own is neither read nor written. */
  scratchDir: string;
  /** HOME and USERPROFILE where the Claude Code login lives, when the clean room moved them. */
  realHome?: { HOME?: string; USERPROFILE?: string } | null;
  taskTimeoutMs?: number;
  maxTurns?: number;
  /** The executable; `claude` on PATH by default. */
  command?: ReferenceCommand;
}

/** Variables that would make the child believe it runs inside another Claude Code session. */
const INHERITED_SESSION_KEY = (key: string) =>
  key === "CLAUDECODE" || key === "CLAUDE_PID" || key.startsWith("CLAUDE_CODE_") || key === "ANTHROPIC_MODEL";

/** Reads `claude -p --output-format stream-json` events. */
export function parseClaudeStream(lines: readonly string[]): ReferenceTurn {
  const turn: ReferenceTurn = {
    toolCalls: 0,
    commands: [],
    verificationCommands: 0,
    failedToolResults: 0,
    filesChanged: 0,
    llmCalls: 0,
    finalText: "",
    error: null,
    tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    costUsd: null,
    details: {},
  };
  const changed = new Set<string>();
  for (const line of lines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = event.message as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? (message.content as Array<Record<string, unknown>>) : [];
    if (event.type === "assistant") {
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        turn.toolCalls += 1;
        const input = (block.input ?? {}) as Record<string, unknown>;
        const name = String(block.name ?? "");
        if ((name === "Bash" || name === "PowerShell") && typeof input.command === "string") {
          turn.commands.push(input.command);
          if (isVerificationCommand(input.command)) turn.verificationCommands += 1;
        }
        if ((name === "Edit" || name === "Write" || name === "MultiEdit") && typeof input.file_path === "string") {
          changed.add(input.file_path);
        }
      }
    } else if (event.type === "user") {
      for (const block of content)
        if (block.type === "tool_result" && block.is_error === true) turn.failedToolResults += 1;
    } else if (event.type === "result") {
      turn.finalText = typeof event.result === "string" ? event.result : "";
      turn.llmCalls = typeof event.num_turns === "number" ? event.num_turns : 0;
      turn.costUsd = typeof event.total_cost_usd === "number" ? event.total_cost_usd : null;
      const subtype = typeof event.subtype === "string" ? event.subtype : null;
      if (event.is_error === true) turn.error = subtype ?? "error";
      const usage = (event.usage ?? {}) as Record<string, unknown>;
      const input =
        Number(usage.input_tokens ?? 0) +
        Number(usage.cache_read_input_tokens ?? 0) +
        Number(usage.cache_creation_input_tokens ?? 0);
      const output = Number(usage.output_tokens ?? 0);
      turn.tokens = { inputTokens: input, outputTokens: output, totalTokens: input + output };
      const modelUsage = event.modelUsage as Record<string, unknown> | undefined;
      turn.details = { subtype, numTurns: turn.llmCalls, modelsUsed: modelUsage ? Object.keys(modelUsage) : [] };
    }
  }
  turn.filesChanged = changed.size;
  return turn;
}

export function createClaudeCodeExecutor(options: ClaudeCodeExecutorOptions) {
  mkdirSync(options.scratchDir, { recursive: true });
  const settings = JSON.stringify({ autoMemoryDirectory: join(options.scratchDir, "auto-memory") });
  return {
    async executeTask(
      task: BenchmarkTaskDefinition,
      context: { signal?: AbortSignal; emit: (notice: BenchmarkExecutionNotice) => void },
    ): Promise<BenchmarkTaskExecution> {
      const workspace = task.workspace ?? process.cwd();
      const startedAt = Date.now();
      context.emit({
        type: "note",
        taskId: task.id,
        message: `Claude Code turn started${options.model ? ` with ${options.model}` : ""}`,
        payload: { harness: "claude-code" },
      });
      const run = await runJsonLinesProcess(
        options.command ?? { file: "claude" },
        [
          "-p",
          ...(options.model ? ["--model", options.model] : []),
          "--output-format",
          "stream-json",
          "--verbose",
          "--permission-mode",
          "acceptEdits",
          "--allowedTools",
          "Bash",
          "PowerShell",
          "--max-turns",
          String(options.maxTurns ?? 80),
          "--no-session-persistence",
          "--strict-mcp-config",
          "--setting-sources",
          "",
          "--settings",
          settings,
        ],
        {
          cwd: workspace,
          env: referenceEnv(options.realHome, INHERITED_SESSION_KEY),
          stdin: task.prompt,
          timeoutMs: options.taskTimeoutMs ?? 20 * 60_000,
          signal: context.signal,
        },
      );
      const turn = parseClaudeStream(run.lines);
      const durationMs = Date.now() - startedAt;
      const grade = await gradeWorkspace(task, workspace, {
        benchmarkRoot: options.benchmarkRoot,
        signal: context.signal,
        harness: "claude-code",
        emit: context.emit,
      });
      return referenceExecution({
        harness: "claude-code",
        model: options.model ?? null,
        workspace,
        grade,
        turn,
        run,
        durationMs,
        costSource: "claude -p total_cost_usd (API-equivalent estimate)",
      });
    },
  };
}
