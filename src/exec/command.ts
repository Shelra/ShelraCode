/**
 * One-shot command execution with structured, separately-captured consequences.
 *
 * Unlike the tool-facing `{ success, output }` shape, nothing here is flattened: stdout and
 * stderr stay apart, the exit code stays a number, and a timeout is a distinct state rather
 * than a string a model has to notice inside a blob of text.
 */

import { spawn } from "node:child_process";
import { allocateLogPath, BoundedCapture, DEFAULT_CAPTURE_CHARS, RunLog } from "./logging";
import { measureProcessTreeMb } from "./memory";
import {
  buildShellInvocation,
  createShellErrorFilter,
  killProcessTree,
  killProcessTreeSync,
  type ShellPreference,
  spawnOptions,
} from "./shell";
import type { CommandOutcome, CommandState } from "./types";

export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
/**
 * Resident-memory ceiling for a command's whole process tree. Agent-written code under test
 * can allocate without bound (a benchmark oracle reached 22 GB on 2026-09-17 and took the
 * machine down before its wall-clock timeout mattered); the tree is killed at this size.
 */
export const DEFAULT_COMMAND_MEMORY_MB = 6_144;
/** ~450 ms of CIM query per poll on Windows; 3 s keeps the watchdog cheap while a 1 GB/s runaway stays bounded. */
export const DEFAULT_MEMORY_POLL_MS = 3_000;

/** Children still running; killed on process exit so a crash never leaves orphans behind. */
const activeChildren = new Set<number>();
let exitSweepInstalled = false;
function trackChild(pid: number | undefined): () => void {
  if (!pid) return () => {};
  activeChildren.add(pid);
  if (!exitSweepInstalled) {
    exitSweepInstalled = true;
    process.once("exit", () => {
      for (const child of activeChildren) killProcessTreeSync(child);
    });
  }
  return () => {
    activeChildren.delete(pid);
  };
}

export interface RunCommandOptions {
  command: string;
  /** Defaults to the current working directory. */
  cwd?: string;
  /** Defaults to 120s. On expiry the whole process tree is killed. */
  timeoutMs?: number;
  /** Extra environment entries, merged over the parent environment. */
  env?: Record<string, string>;
  /** Shell override. Defaults to PowerShell on Windows, `sh` elsewhere. */
  shell?: ShellPreference;
  signal?: AbortSignal;
  /** Directory for the full-output log. Defaults to the configured exec log root. */
  logDir?: string;
  /** Filename hint for the log file. */
  logLabel?: string;
  /** Per-stream in-memory character budget before clipping. */
  maxCapturedChars?: number;
  /** Set false to skip writing a log file (in-memory capture only). */
  log?: boolean;
  /** Process-tree resident-memory ceiling in MB; 0 disables. Defaults to 6 GB. */
  maxMemoryMb?: number;
  /** How often the tree is measured against the ceiling. */
  memoryPollMs?: number;
}

function buildEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Deterministic output: colour escape codes are noise the runtime would have to strip.
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    CI: process.env.CI ?? "1",
    ...extra,
  };
}

export async function runCommand(options: RunCommandOptions): Promise<CommandOutcome> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const maxMemoryMb = options.maxMemoryMb ?? DEFAULT_COMMAND_MEMORY_MB;
  const memoryPollMs = options.memoryPollMs ?? DEFAULT_MEMORY_POLL_MS;
  const captureLimit = options.maxCapturedChars ?? DEFAULT_CAPTURE_CHARS;
  const startedAt = Date.now();

  const base: CommandOutcome = {
    command: options.command,
    cwd,
    exitCode: null,
    stdout: "",
    stderr: "",
    durationMs: 0,
    timedOut: false,
    state: "spawn_error",
    truncated: false,
  };

  if (options.signal?.aborted) {
    return { ...base, state: "killed", stderr: "Aborted before start", durationMs: 0 };
  }

  const useLog = options.log !== false;
  const logPath = useLog ? allocateLogPath(options.logLabel ?? "command", options.logDir) : undefined;
  const log = logPath ? new RunLog(logPath) : null;
  log?.header([`# command: ${options.command}`, `# cwd: ${cwd}`, `# started: ${new Date(startedAt).toISOString()}`]);

  const stdoutCapture = new BoundedCapture(captureLimit);
  const stderrCapture = new BoundedCapture(captureLimit);
  const stderrFilter = createShellErrorFilter();

  const invocation = buildShellInvocation(options.command, options.shell);

  const finish = async (
    state: CommandState,
    exitCode: number | null,
    timedOut: boolean,
    extraStderr?: string,
  ): Promise<CommandOutcome> => {
    const flushed = stderrFilter.flush();
    if (flushed) {
      stderrCapture.append(flushed);
      log?.write("stderr", flushed);
    }
    if (extraStderr) {
      stderrCapture.append(extraStderr);
      log?.write("stderr", extraStderr);
    }
    const durationMs = Date.now() - startedAt;
    await log?.close(`# exit: ${exitCode ?? "none"} state: ${state} duration: ${durationMs}ms`);
    return {
      command: options.command,
      cwd,
      exitCode,
      stdout: stdoutCapture.text(),
      stderr: stderrCapture.text(),
      durationMs,
      timedOut,
      state,
      truncated: stdoutCapture.truncated || stderrCapture.truncated,
      ...(logPath ? { logPath } : {}),
    };
  };

  return await new Promise<CommandOutcome>((resolve) => {
    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let memoryTimer: ReturnType<typeof setInterval> | undefined;
    let untrack: () => void = () => {};
    let killedReason: "timeout" | "abort" | "memory" | null = null;
    let peakMemoryMb = 0;

    const cleanup = (): void => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceTimer) clearTimeout(forceTimer);
      if (memoryTimer) clearInterval(memoryTimer);
      untrack();
      options.signal?.removeEventListener("abort", onAbort);
    };

    const settle = (state: CommandState, exitCode: number | null, timedOut: boolean, extra?: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      void finish(state, exitCode, timedOut, extra).then(resolve);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(invocation.file, invocation.args, spawnOptions(cwd, buildEnv(options.env)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void finish("spawn_error", null, false, `Failed to start shell: ${message}`).then(resolve);
      return;
    }

    const onAbort = (): void => {
      killedReason = "abort";
      void killProcessTree(child.pid, 500);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      stdoutCapture.append(chunk);
      log?.write("stdout", chunk);
    });

    child.stderr?.on("data", (chunk: string) => {
      const cleaned = stderrFilter.push(chunk);
      if (!cleaned) return;
      stderrCapture.append(cleaned);
      log?.write("stderr", cleaned);
    });

    child.on("error", (error: Error) => {
      settle("spawn_error", null, false, `Failed to start shell: ${error.message}`);
    });

    child.on("close", (code: number | null) => {
      if (killedReason === "timeout") {
        settle("timed_out", null, true, `\nProcess tree killed after ${timeoutMs}ms timeout.`);
        return;
      }
      if (killedReason === "abort") {
        settle("killed", null, false, "\nProcess tree killed by abort signal.");
        return;
      }
      if (killedReason === "memory") {
        settle(
          "killed",
          null,
          false,
          `\nProcess tree killed after exceeding the ${maxMemoryMb} MB memory ceiling (observed ${Math.round(peakMemoryMb)} MB).`,
        );
        return;
      }
      settle("completed", code, false);
    });

    untrack = trackChild(child.pid);
    if (maxMemoryMb > 0 && child.pid) {
      const rootPid = child.pid;
      let measuring = false;
      memoryTimer = setInterval(() => {
        if (measuring || settled || killedReason) return;
        measuring = true;
        void measureProcessTreeMb(rootPid)
          .then((usedMb) => {
            peakMemoryMb = Math.max(peakMemoryMb, usedMb);
            if (usedMb > maxMemoryMb && !killedReason) {
              killedReason = "memory";
              void killProcessTree(rootPid, 500);
              forceTimer = setTimeout(
                () =>
                  settle(
                    "killed",
                    null,
                    false,
                    `\nProcess tree kill after exceeding the ${maxMemoryMb} MB memory ceiling timed out.`,
                  ),
                5_000,
              );
            }
          })
          .finally(() => {
            measuring = false;
          });
      }, memoryPollMs);
    }

    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      timeoutTimer = setTimeout(() => {
        killedReason = "timeout";
        void killProcessTree(child.pid, 500);
        // If the tree refuses to die, do not hang the caller forever.
        setTimeout(() => settle("timed_out", null, true, `\nProcess tree kill timed out after ${timeoutMs}ms.`), 5_000);
      }, timeoutMs);
    }
  });
}
