import { type ChildProcess, spawn } from "child_process";
import { existsSync } from "fs";
import { delimiter, join } from "path";
import { performance } from "perf_hooks";
import { HOOK_EVENT_ENV } from "../product/identity";
import type {
  AggregatedHookResult,
  CommandHook,
  HookFailurePolicy,
  HookInput,
  HookOutput,
  HookResult,
  HookSource,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 600_000;
const BLOCKING_EXIT_CODE = 2;
const MAX_STDOUT_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_CONTEXT_CHARS = 10_000;

const CREDENTIAL_ENV =
  /(^SHELRA_TOKEN$|_API_KEY$|^KEY_|_TOKEN$|_SECRET$|_PASSW(OR)?D$|_ACCESS_KEY$|CREDENTIALS?$|^DATABASE_URL$|^OMNIROUTE_)/iu;

/**
 * The environment a hook starts with. A hook the person wrote themselves (user settings) gets all of it. One defined in
 * the repository (project or local settings) was only approved by reading its command, so it does not also get the
 * account token and the provider keys: move the hook to user settings if it needs them.
 */
export function hookEnvironment(source: HookSource | undefined): NodeJS.ProcessEnv {
  if (source !== "project" && source !== "local") return { ...process.env };
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !CREDENTIAL_ENV.test(name)));
}

/** Set in the environment of every hook, and checked before one runs: a hook that starts Shelra cannot start hooks. */
export const HOOK_DEPTH_ENV = "SHELRA_HOOK_DEPTH";

export interface HookRunMeta {
  hookId?: string;
  source?: HookSource;
  /** True on an event where the runtime waits for the decision (`BLOCKABLE_EVENTS`). */
  blockable?: boolean;
  failurePolicy?: HookFailurePolicy;
  /** The project root, passed to the hook as SHELRA_PROJECT_DIR. */
  projectDir?: string;
}

let shellOnPath: boolean | null = null;

function hasShOnPath(): boolean {
  if (shellOnPath !== null) return shellOnPath;
  shellOnPath = false;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory && (existsSync(join(directory, "sh.exe")) || existsSync(join(directory, "sh")))) {
      shellOnPath = true;
      break;
    }
  }
  return shellOnPath;
}

function launch(hook: CommandHook): { program: string; args: string[] } {
  if (hook.args) return { program: hook.command, args: hook.args };
  const shell = hook.shell ?? (process.platform === "win32" && !hasShOnPath() ? "cmd" : "sh");
  if (shell === "cmd") return { program: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", hook.command] };
  if (shell === "powershell")
    return { program: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", hook.command] };
  return { program: "sh", args: ["-c", hook.command] };
}

/** Ends the process and everything it started: a hook's children must not outlive its timeout or a cancellation. */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on(
        "error",
        () => {},
      );
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  } catch {
    /* already gone */
  }
}

/**
 * Execute a single command hook. The hook input is piped as JSON to stdin; stdout is parsed as JSON when it starts
 * with `{`. Exit code 0 is success; 2 blocks on an event that can block (anywhere else it is an ordinary failure);
 * anything else is a failure that does not block, unless the hook's failure policy is `closed` on an event that can.
 */
export function execCommandHook(
  hook: CommandHook,
  input: HookInput,
  cwd: string,
  signal?: AbortSignal,
  meta: HookRunMeta = {},
): Promise<HookResult> {
  const timeoutMs = Math.min(hook.timeout ? hook.timeout * 1000 : DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const jsonInput = JSON.stringify(input);
  const policy: HookFailurePolicy = meta.failurePolicy ?? hook.failurePolicy ?? "open";
  const closed = policy === "closed" && meta.blockable === true;
  const started = performance.now();
  const base = {
    command: hook.command,
    ...(meta.hookId ? { hookId: meta.hookId } : {}),
    ...(meta.source ? { source: meta.source } : {}),
  };

  return new Promise<HookResult>((resolve) => {
    if (signal?.aborted) {
      resolve({ ...base, outcome: "cancelled", exitCode: null, durationMs: 0 });
      return;
    }

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: Omit<HookResult, "command" | "durationMs">) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", onAbort);
      const durationMs = Math.round(performance.now() - started);
      let final: HookResult = { ...base, ...result, durationMs, ...(truncated ? { truncated: true } : {}) };
      // A guard that fails must not silently let the action through when it was asked to fail closed.
      const failed = final.outcome === "non_blocking_error" || final.invalidOutput === true;
      if (closed && failed) {
        final = {
          ...final,
          outcome: "blocking",
          failedClosed: true,
          stderr: `Hook failed and its policy is "closed", so the action was blocked: ${final.stderr || (final.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : final.invalidOutput ? "its output was not valid JSON" : `exit code ${final.exitCode}`)}`,
        };
      }
      resolve(final);
    };

    const { program, args } = launch(hook);
    let child: ChildProcess;
    try {
      child = spawn(program, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
        env: {
          ...hookEnvironment(meta.source),
          [HOOK_EVENT_ENV]: input.hook_event_name,
          [HOOK_DEPTH_ENV]: String(Number(process.env[HOOK_DEPTH_ENV] ?? "0") + 1),
          ...(meta.projectDir ? { SHELRA_PROJECT_DIR: meta.projectDir } : {}),
        },
      });
    } catch (error) {
      finish({
        outcome: "non_blocking_error",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
      });
      return;
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length >= MAX_STDOUT_BYTES) {
        truncated = true;
        return;
      }
      stdout += chunk.toString();
      if (stdout.length > MAX_STDOUT_BYTES) {
        stdout = stdout.slice(0, MAX_STDOUT_BYTES);
        truncated = true;
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length >= MAX_STDERR_BYTES) {
        truncated = true;
        return;
      }
      stderr += chunk.toString();
      if (stderr.length > MAX_STDERR_BYTES) {
        stderr = stderr.slice(0, MAX_STDERR_BYTES);
        truncated = true;
      }
    });
    child.stdin?.on("error", () => {
      /* the hook may exit without reading its input */
    });

    child.on("error", (error) => {
      finish({ outcome: "non_blocking_error", stderr: error.message, exitCode: null });
    });

    child.on("close", (code) => {
      const exitCode = code ?? null;
      const parsed = parseHookOutput(stdout);
      const common = {
        output: parsed.output,
        stderr: stderr.trim() || undefined,
        exitCode,
        ...(parsed.invalid ? { invalidOutput: true } : {}),
      };
      if (exitCode === BLOCKING_EXIT_CODE && meta.blockable !== false) {
        finish({ ...common, outcome: "blocking" });
        return;
      }
      if (exitCode !== null && exitCode !== 0) {
        finish({
          ...common,
          outcome: "non_blocking_error",
          ...(exitCode === BLOCKING_EXIT_CODE
            ? { stderr: `${stderr.trim()} (exit code 2 does not block on this event)`.trim() }
            : {}),
        });
        return;
      }
      finish({ ...common, outcome: "success", exitCode: exitCode ?? 0 });
    });

    try {
      child.stdin?.write(jsonInput);
      child.stdin?.end();
    } catch {
      /* stdin may already be closed */
    }

    timeoutTimer = setTimeout(() => {
      killTree(child);
      finish({
        outcome: "non_blocking_error",
        stderr: `Hook timed out after ${hook.timeout ?? DEFAULT_TIMEOUT_MS / 1000}s`,
        exitCode: null,
        timedOut: true,
      });
    }, timeoutMs);

    function onAbort() {
      killTree(child);
      finish({ outcome: "cancelled", exitCode: null });
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface HookToRun {
  hook: CommandHook;
  meta: HookRunMeta;
}

/**
 * Runs the hooks matching one event in parallel and aggregates their results. Results keep the order the hooks were
 * given in, so the aggregate (which reason is reported first, which context comes first) is stable.
 */
export async function executeHooks(
  hooks: Array<CommandHook | HookToRun>,
  input: HookInput,
  cwd: string,
  signal?: AbortSignal,
): Promise<AggregatedHookResult> {
  if (hooks.length === 0) return aggregateResults([]);
  const entries = hooks.map((entry): HookToRun => ("hook" in entry ? entry : { hook: entry, meta: {} }));
  const results = await Promise.all(
    entries.map((entry) => execCommandHook(entry.hook, input, cwd, signal, entry.meta)),
  );
  return aggregateResults(results);
}

export function aggregateResults(results: HookResult[]): AggregatedHookResult {
  const blockingErrors: Array<{ command: string; stderr: string }> = [];
  const additionalContexts: string[] = [];
  let blocked = false;
  let preventContinuation = false;
  let stopReason: string | undefined;
  let decision: "approve" | "block" | undefined;

  for (const result of results) {
    if (result.outcome === "blocking") {
      blocked = true;
      blockingErrors.push({ command: result.command, stderr: result.stderr ?? "Hook returned exit code 2" });
    }

    if (result.output) {
      if (result.output.continue === false) {
        preventContinuation = true;
        stopReason = result.output.stopReason ?? stopReason;
      }
      const denies =
        result.output.decision === "block" ||
        result.output.permissionDecision === "deny" ||
        result.output.permissionDecision === "ask";
      if (denies) {
        blocked = true;
        decision = "block";
        if (result.output.permissionDecision === "ask" && result.output.reason === undefined) {
          result.output.reason =
            "A hook asked for confirmation; only a person can give it here, so the action was not run.";
        }
      } else if (result.output.decision === "approve" && !blocked) {
        decision = "approve";
      }
      if (result.output.additionalContext) {
        additionalContexts.push(result.output.additionalContext);
      }
    }
  }

  return {
    blocked,
    blockingErrors,
    preventContinuation,
    stopReason,
    additionalContexts,
    decision,
    results,
  };
}

function cap(text: string): string {
  return text.length > MAX_CONTEXT_CHARS ? `${text.slice(0, MAX_CONTEXT_CHARS)}…` : text;
}

export function parseHookOutput(stdout: string): { output?: HookOutput; invalid?: boolean } {
  const trimmed = stdout.trim();
  if (!trimmed || !trimmed.startsWith("{")) return {};

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) return { invalid: true };

    const output: HookOutput = {};
    if (typeof parsed.continue === "boolean") output.continue = parsed.continue;
    if (typeof parsed.stopReason === "string") output.stopReason = cap(parsed.stopReason);
    if (parsed.decision === "approve" || parsed.decision === "block") output.decision = parsed.decision;
    if (typeof parsed.reason === "string") output.reason = cap(parsed.reason);
    if (typeof parsed.additionalContext === "string") output.additionalContext = cap(parsed.additionalContext);
    // The shape other agents' hooks use for a tool decision. "allow" is recorded but never widens a permission.
    const specific = parsed.hookSpecificOutput;
    if (specific && typeof specific === "object") {
      const decisionValue = (specific as Record<string, unknown>).permissionDecision;
      if (decisionValue === "allow" || decisionValue === "deny" || decisionValue === "ask")
        output.permissionDecision = decisionValue;
      const why = (specific as Record<string, unknown>).permissionDecisionReason;
      if (typeof why === "string" && output.reason === undefined) output.reason = cap(why);
      const context = (specific as Record<string, unknown>).additionalContext;
      if (typeof context === "string" && output.additionalContext === undefined)
        output.additionalContext = cap(context);
    }

    return Object.keys(output).length > 0 ? { output } : {};
  } catch {
    return { invalid: true };
  }
}
