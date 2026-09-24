import { spawn } from "node:child_process";
import { trackChild } from "../exec/command";
import { killProcessTree } from "../exec/shell";
import { describeFailures, type WorkspaceGrade } from "./grading";
import type { BenchmarkTaskExecution } from "./runner";
import type { BenchmarkJsonObject } from "./types";

/**
 * Shared pieces of the reference adapters (Claude Code, Codex): other coding agents driven headless on
 * the same task workspaces and graded by the same oracle as Shelra, so a score says how Shelra compares
 * with them on identical work (audit doc 15, §15.3 rule 5).
 */

/** What a reference agent did in one task, read from its own event stream. */
export interface ReferenceTurn {
  toolCalls: number;
  commands: string[];
  verificationCommands: number;
  failedToolResults: number;
  filesChanged: number;
  llmCalls: number;
  finalText: string;
  /** An error the agent reported about its own run, as opposed to a failed oracle. */
  error: string | null;
  tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
  costUsd: number | null;
  /** Adapter-specific facts for the run record (models used, exit subtype, item counts). */
  details: BenchmarkJsonObject;
}

export interface ProcessRun {
  lines: string[];
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
}

export interface ReferenceCommand {
  /** The executable; found on PATH when it is a bare name. */
  file: string;
  /** Arguments placed before the adapter's own, such as a script for a runtime. */
  args?: string[];
}

/**
 * Runs a CLI that prints one JSON event per line, with the prompt on stdin. There is no shell: cmd.exe
 * drops empty arguments such as `--setting-sources ""`. A missing executable or a crash ends as a
 * failed run with its error in `stderr`, never as an exception.
 */
export function runJsonLinesProcess(
  command: ReferenceCommand,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdin: string; timeoutMs: number; signal?: AbortSignal },
): Promise<ProcessRun> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    let buffer = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(command.file, [...(command.args ?? []), ...args], {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      // Its own process group on POSIX, so a timeout kills the CLI's children too; Windows uses taskkill /T.
      detached: process.platform !== "win32",
    });
    // Out of the terminal's process group it misses Ctrl+C: the exit sweep stops it with Shelra.
    const untrack = trackChild(child.pid);
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      untrack();
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (buffer.trim()) lines.push(buffer.trim());
      resolve({ lines, exitCode, stderr, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      void killProcessTree(child.pid, 500);
    }, options.timeoutMs);
    const onAbort = () => void killProcessTree(child.pid, 500);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) lines.push(line);
        index = buffer.indexOf("\n");
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000);
    });
    child.on("error", (error) => {
      stderr = `${stderr}\n${String(error)}`.trim();
      finish(null);
    });
    child.on("close", (code) => finish(code));
    child.stdin?.on("error", () => {
      // The child may exit before reading its prompt; its exit code tells the rest.
    });
    child.stdin?.end(options.stdin);
  });
}

/**
 * The environment for a reference agent. Its login lives under the person's own home, which the clean
 * room moved, so HOME and USERPROFILE go back to the real ones; `drop` removes variables that would make
 * the agent believe it runs inside another session.
 */
export function referenceEnv(
  realHome?: { HOME?: string; USERPROFILE?: string } | null,
  drop: (key: string) => boolean = () => false,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (drop(key)) delete env[key];
  for (const key of ["HOME", "USERPROFILE"] as const) {
    const value = realHome?.[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** A task execution for a reference agent: graded by the oracle, described by its own event stream. */
export function referenceExecution(input: {
  harness: string;
  model: string | null;
  workspace: string;
  grade: WorkspaceGrade;
  turn: ReferenceTurn;
  run: ProcessRun;
  durationMs: number;
  costSource: string;
}): BenchmarkTaskExecution {
  const { grade, turn, run } = input;
  const ended = !run.timedOut && run.exitCode === 0 && turn.error === null;
  return {
    status: grade.verified ? "passed" : "failed",
    scores: {
      ...(grade.coding === undefined ? {} : { coding: grade.coding }),
      ...(grade.intent === undefined ? {} : { intent: grade.intent }),
      verification: turn.verificationCommands > 0 ? 100 : 0,
    },
    tokens: turn.tokens,
    cost: {
      micros: turn.costUsd === null ? null : Math.round(turn.costUsd * 1_000_000),
      kind: turn.costUsd === null ? "unavailable" : "estimated",
      source: input.costSource,
    },
    behavior: {
      planCreated: false,
      researchPerformed: false,
      researchSources: 0,
      delegatedAgents: 0,
      llmCalls: turn.llmCalls,
      toolCalls: turn.toolCalls,
      commandsExecuted: turn.commands.length,
      filesRead: 0,
      filesChanged: turn.filesChanged,
      testsExecuted: turn.verificationCommands,
      verificationAttempts: turn.verificationCommands,
      failuresDetected: turn.failedToolResults,
      repairsAttempted: 0,
      repairsSucceeded: 0,
      selfVerification: turn.verificationCommands > 0,
      humanInterventions: 0,
      // No host of Shelra's stands behind these agents to flag unverified work.
      completionBlocked: false,
      falseCompletion: grade.requiredCount > 0 && !grade.verified && ended,
    },
    acceptance: grade.acceptance,
    finalResult: {
      harness: input.harness,
      model: input.model,
      verified: grade.verified,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      error: turn.error,
      ...turn.details,
      stderrTail: run.stderr.slice(-400),
      finalTextExcerpt: turn.finalText.trim().slice(-400),
    },
    failureReason: grade.verified
      ? null
      : run.timedOut
        ? `${input.harness} exceeded the task timeout; ${describeFailures(grade.failedRequired)}`
        : run.exitCode !== 0 || turn.error
          ? `${input.harness} did not finish (${turn.error ?? `exit ${run.exitCode}`}); ${describeFailures(grade.failedRequired)}`
          : describeFailures(grade.failedRequired),
    failureType: grade.verified
      ? null
      : run.timedOut
        ? "timeout"
        : run.exitCode !== 0 || turn.error
          ? "model_failure"
          : turn.filesChanged === 0
            ? "implementation_failure"
            : "intent_failure",
    evidence: [{ kind: "other", path: input.workspace, label: "Graded task workspace" }],
    durationMs: input.durationMs,
    llmDurationMs: null,
    toolDurationMs: null,
    verificationDurationMs: grade.report?.durationMs ?? null,
    repairDurationMs: null,
  };
}
