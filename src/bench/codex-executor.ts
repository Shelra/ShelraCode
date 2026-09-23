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
 * OpenAI's Codex CLI as a reference agent: `codex exec` runs non-interactively on the same task
 * workspace Shelra gets, in a workspace-write sandbox with no saved session, then the same oracle
 * grades it. Model and reasoning effort come from the person's Codex configuration unless given.
 */
export interface CodexExecutorOptions {
  /** A Codex model id; without one, Codex uses the model in its configuration. */
  model?: string;
  /** A Codex reasoning effort; without one, Codex uses the effort in its configuration. */
  reasoningEffort?: string;
  benchmarkRoot: string;
  /** HOME and USERPROFILE where the Codex login lives, when the clean room moved them. */
  realHome?: { HOME?: string; USERPROFILE?: string } | null;
  taskTimeoutMs?: number;
  /** The executable; `codex` on PATH by default. */
  command?: ReferenceCommand;
}

function commandText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join(" ");
  return "";
}

/** Reads `codex exec --json` events. */
export function parseCodexEvents(lines: readonly string[]): ReferenceTurn {
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
  const itemCounts: Record<string, number> = {};
  let reasoningTokens = 0;
  for (const line of lines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = String(event.type ?? "");
    if (type === "turn.completed") {
      turn.llmCalls += 1;
      const usage = (event.usage ?? {}) as Record<string, unknown>;
      const input = Number(usage.input_tokens ?? 0);
      const output = Number(usage.output_tokens ?? 0);
      turn.tokens = {
        inputTokens: turn.tokens.inputTokens + input,
        outputTokens: turn.tokens.outputTokens + output,
        totalTokens: turn.tokens.totalTokens + input + output,
      };
      reasoningTokens += Number(usage.reasoning_output_tokens ?? usage.reasoning_tokens ?? 0);
    } else if (type === "turn.failed" || type === "error") {
      turn.error = JSON.stringify(event.error ?? event.message ?? event).slice(0, 300);
    } else if (type === "item.completed") {
      const item = (event.item ?? {}) as Record<string, unknown>;
      const itemType = String(item.type ?? item.item_type ?? "unknown");
      itemCounts[itemType] = (itemCounts[itemType] ?? 0) + 1;
      if (itemType === "command_execution") {
        turn.toolCalls += 1;
        const command = commandText(item.command);
        turn.commands.push(command);
        if (isVerificationCommand(command)) turn.verificationCommands += 1;
        if (typeof item.exit_code === "number" && item.exit_code !== 0) turn.failedToolResults += 1;
      } else if (itemType === "file_change") {
        turn.toolCalls += 1;
        for (const change of Array.isArray(item.changes) ? (item.changes as Array<Record<string, unknown>>) : []) {
          if (typeof change.path === "string") changed.add(change.path);
        }
      } else if (itemType === "agent_message" && typeof item.text === "string") {
        turn.finalText = item.text;
      }
    }
  }
  turn.filesChanged = changed.size;
  turn.details = { itemCounts, reasoningTokens };
  return turn;
}

export function createCodexExecutor(options: CodexExecutorOptions) {
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
        message: `Codex turn started${options.model ? ` with ${options.model}` : ""}`,
        payload: { harness: "codex" },
      });
      const run = await runJsonLinesProcess(
        options.command ?? { file: "codex" },
        [
          "exec",
          "--json",
          "--skip-git-repo-check",
          "--ephemeral",
          ...(options.model ? ["-m", options.model] : []),
          ...(options.reasoningEffort ? ["-c", `model_reasoning_effort="${options.reasoningEffort}"`] : []),
          "-s",
          "workspace-write",
          "-C",
          workspace,
          "-",
        ],
        {
          cwd: workspace,
          env: referenceEnv(options.realHome),
          stdin: task.prompt,
          timeoutMs: options.taskTimeoutMs ?? 20 * 60_000,
          signal: context.signal,
        },
      );
      const turn = parseCodexEvents(run.lines);
      const durationMs = Date.now() - startedAt;
      const grade = await gradeWorkspace(task, workspace, {
        benchmarkRoot: options.benchmarkRoot,
        signal: context.signal,
        harness: "codex",
        emit: context.emit,
      });
      return referenceExecution({
        harness: "codex",
        model: options.model ?? null,
        workspace,
        grade,
        turn,
        run,
        durationMs,
        costSource: "codex exec reports tokens only",
      });
    },
  };
}
