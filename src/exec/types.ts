/**
 * Execution results designed for agents, not for humans reading a terminal.
 *
 * Every outcome makes its consequences explicit as separate fields so the runtime can
 * branch deterministically (did it exit non-zero? did it time out? is the port open?)
 * without asking a model to interpret a blob of text.
 */

export type CommandState = "completed" | "timed_out" | "spawn_error" | "killed";

export interface CommandOutcome {
  command: string;
  cwd: string;
  /** Null when the process never produced an exit status (spawn failure or kill). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  state: CommandState;
  /** True when stdout/stderr above were clipped for context. Full text lives at logPath. */
  truncated: boolean;
  logPath?: string;
}

export function commandSucceeded(outcome: CommandOutcome): boolean {
  return outcome.state === "completed" && outcome.exitCode === 0;
}

/** A concise, model-facing rendering of an outcome. Keeps context small but unambiguous. */
export function summarizeCommand(outcome: CommandOutcome, maxChars = 2000): string {
  const head = `$ ${outcome.command}\nexit=${outcome.exitCode ?? "none"} state=${outcome.state} duration=${outcome.durationMs}ms`;
  const tail = (label: string, text: string): string => {
    const trimmed = text.trim();
    if (!trimmed) return "";
    const clipped = trimmed.length > maxChars ? `…(clipped)…\n${trimmed.slice(-maxChars)}` : trimmed;
    return `\n--- ${label} ---\n${clipped}`;
  };
  return `${head}${tail("stdout", outcome.stdout)}${tail("stderr", outcome.stderr)}`;
}

export type FileOperation = "create" | "overwrite" | "edit" | "delete" | "noop";

export interface FileChange {
  path: string;
  operation: FileOperation;
  /** False when the write produced byte-identical content — an important repair-loop signal. */
  changed: boolean;
  linesAdded: number;
  linesRemoved: number;
  bytesAfter: number;
  error?: string;
}

/** A managed long-running process, such as a dev server. */
export type ProcessState = "starting" | "ready" | "exited" | "failed" | "stopped";

export interface ManagedProcess {
  id: string;
  command: string;
  cwd: string;
  pid?: number;
  port?: number;
  url?: string;
  state: ProcessState;
  /** Why the process is not usable, when state is "failed". */
  failureReason?: string;
  startedAt: number;
  exitCode?: number | null;
  logPath: string;
}

export interface ProcessStartOptions {
  command: string;
  cwd: string;
  /** Preferred port. The manager resolves collisions and reports the port actually used. */
  port?: number;
  env?: Record<string, string>;
  /** How long to wait for the readiness signal before declaring failure. */
  readyTimeoutMs?: number;
  /** Regex matched against combined output to detect readiness, in addition to port probing. */
  readyPattern?: RegExp;
  signal?: AbortSignal;
}

export interface HttpProbe {
  url: string;
  ok: boolean;
  status?: number;
  durationMs: number;
  bodySnippet?: string;
  contentType?: string;
  error?: string;
}

/** What a browser check observed. This is the evidence a visual/behavioural criterion needs. */
export interface BrowserObservation {
  url: string;
  ok: boolean;
  status?: number;
  title?: string;
  /** Uncaught errors and console.error output, plus failed network requests. */
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** Successful or failed HTTP(S) requests that left the app's own origin. */
  externalRequests: string[];
  /** Results of caller-supplied DOM assertions. */
  assertions: DomAssertionResult[];
  screenshotPath?: string;
  /** Document scroll width vs viewport width, used for responsive overflow checks. */
  horizontalOverflowPx?: number;
  viewport?: { width: number; height: number };
  error?: string;
}

export interface DomAssertion {
  id: string;
  description: string;
  /** CSS selector that must match at least `minCount` visible elements. */
  selector?: string;
  minCount?: number;
  /** Case-insensitive text that must appear in the rendered document. */
  textContains?: string;
  /** Arbitrary boolean expression evaluated in page context. Must return a boolean. */
  expression?: string;
  /** When set, the selected element's text must change during the observation window. */
  waitForChangeMs?: number;
}

export interface DomAssertionResult {
  id: string;
  description: string;
  passed: boolean;
  detail: string;
}
