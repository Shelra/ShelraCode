export {
  activeHooksFor,
  getMatchingHooks,
  type HookResolution,
  type HookState,
  invalidateHookCache,
  loadHooksConfig,
  matchesPattern,
  type ResolvedHook,
  resolveHooks,
  validateHook,
} from "./config.js";
export { execCommandHook, executeHooks, HOOK_DEPTH_ENV, killTree } from "./executor.js";
export type {
  AggregatedHookResult,
  BaseHookInput,
  CommandHook,
  HookCommand,
  HookEvent,
  HookFailurePolicy,
  HookInput,
  HookMatcher,
  HookOutput,
  HookResult,
  HookSource,
  HooksConfig,
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  PreToolUseHookInput,
} from "./types.js";
export { BLOCKABLE_EVENTS, getMatchQuery, HOOK_EVENTS, isHookEvent, SHELRA_OWN_EVENTS } from "./types.js";

import { redactSecrets } from "../memory/gate";
import { recordSwallowedError } from "../utils/diagnostics";
import { activeHooksFor, resolveHooks } from "./config.js";
import { aggregateResults, execCommandHook, HOOK_DEPTH_ENV } from "./executor.js";
import type {
  AggregatedHookResult,
  HookInput,
  HookResult,
  HookSource,
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  PreToolUseHookInput,
} from "./types.js";
import { BLOCKABLE_EVENTS, getMatchQuery } from "./types.js";

export interface HookIssue {
  event: string;
  /** `blocking` stopped the action; `non_blocking_error` failed without stopping it. */
  outcome: "blocking" | "non_blocking_error";
  message: string;
}

let hookIssueListener: ((issue: HookIssue) => void) | null = null;

/** The interface subscribes here. A hook that succeeds is silent; only failures and blocks are reported. */
export function setHookIssueListener(listener: ((issue: HookIssue) => void) | null): void {
  hookIssueListener = listener;
}

/** Reports every failed or blocking hook of one run to the listener, with the first useful line of why. */
export function reportHookIssues(event: string, result: AggregatedHookResult): void {
  if (!hookIssueListener) return;
  for (const hook of result.results) {
    // A hook blocks with exit code 2 or with {"decision": "block"} on stdout; both are reported.
    const blocking =
      hook.outcome === "blocking" || hook.output?.decision === "block" || hook.output?.permissionDecision === "deny";
    const failed = hook.outcome === "non_blocking_error" || hook.invalidOutput === true;
    if (!blocking && !failed) continue;
    const reason =
      (hook.stderr ?? "").split(/\r?\n/).find((line) => line.trim()) ??
      hook.output?.reason ??
      hook.output?.stopReason ??
      (hook.invalidOutput ? "its output looked like JSON but was not valid" : undefined);
    try {
      hookIssueListener({
        event,
        outcome: blocking ? "blocking" : "non_blocking_error",
        message: (reason ?? hook.command).trim(),
      });
    } catch {
      // A broken listener must never break the agent.
    }
  }
}

// --- The run log ------------------------------------------------------------------------------------------------

/**
 * What a hook run did, said so that a hook after the fact is never mistaken for a control:
 *  - `prevented`  a hook before an action stopped it (only events where the runtime waits and obeys).
 *  - `allowed`    a hook before an action ran and did not stop it.
 *  - `observed`   a hook ran after or around something that had already happened or cannot be stopped: it saw it, and
 *                 whatever it says, it did not prevent anything.
 *  - `failed-open` it failed (timeout, crash, bad output) and the action went on, as its policy says.
 *  - `failed-closed` it failed and its closed policy stopped the action.
 *  - `skipped`    it did not run (a hook started by a hook).
 */
export type HookEffect = "prevented" | "allowed" | "observed" | "failed-open" | "failed-closed" | "skipped";

export interface HookRunRecord {
  at: string;
  event: string;
  hookId: string;
  source: HookSource | "unknown";
  matcher?: string;
  /** The command with secrets masked and cut to a readable length. */
  command: string;
  outcome: HookResult["outcome"] | "skipped";
  effect: HookEffect;
  durationMs: number;
  exitCode: number | null;
  /** The first useful line of the reason, masked. */
  reason?: string;
  timedOut?: boolean;
  truncated?: boolean;
  /** Hooks are scripts the host runs: the trigger and the outcome are deterministic, never a model's judgment. */
  deterministic: true;
}

const RUN_LOG_LIMIT = 500;
const runLog: HookRunRecord[] = [];
let runListener: ((record: HookRunRecord) => void) | null = null;

export function setHookRunListener(listener: ((record: HookRunRecord) => void) | null): void {
  runListener = listener;
}

export function recentHookRuns(limit = 50): HookRunRecord[] {
  return runLog.slice(-limit);
}

export function clearHookRunLog(): void {
  runLog.length = 0;
}

function sanitize(text: string, max: number): string {
  const masked = redactSecrets(text).replace(/\s+/gu, " ").trim();
  return masked.length > max ? `${masked.slice(0, max - 1)}…` : masked;
}

function effectOf(result: HookResult, blockable: boolean): HookEffect {
  if (result.failedClosed) return "failed-closed";
  const stopped =
    result.outcome === "blocking" ||
    result.output?.decision === "block" ||
    result.output?.permissionDecision === "deny" ||
    result.output?.permissionDecision === "ask";
  if (blockable) {
    if (stopped) return "prevented";
    if (result.outcome === "non_blocking_error" || result.invalidOutput) return "failed-open";
    return "allowed";
  }
  if (result.outcome === "non_blocking_error" || result.invalidOutput) return "failed-open";
  return "observed";
}

function record(
  event: string,
  id: string,
  source: HookSource | "unknown",
  matcher: string | undefined,
  result: HookResult,
  blockable: boolean,
): void {
  const reasonLine = (result.stderr ?? result.output?.reason ?? result.output?.stopReason ?? "")
    .split(/\r?\n/u)
    .find((line) => line.trim());
  const entry: HookRunRecord = {
    at: new Date().toISOString(),
    event,
    hookId: id,
    source,
    ...(matcher ? { matcher } : {}),
    command: sanitize(result.command, 160),
    outcome: result.outcome,
    effect: effectOf(result, blockable),
    durationMs: result.durationMs ?? 0,
    exitCode: result.exitCode,
    ...(reasonLine ? { reason: sanitize(reasonLine, 200) } : {}),
    ...(result.timedOut ? { timedOut: true } : {}),
    ...(result.truncated ? { truncated: true } : {}),
    deterministic: true,
  };
  runLog.push(entry);
  if (runLog.length > RUN_LOG_LIMIT) runLog.splice(0, runLog.length - RUN_LOG_LIMIT);
  if (runListener) {
    try {
      runListener(entry);
    } catch {
      // A broken listener must never break the agent.
    }
  }
}

// --- Running ----------------------------------------------------------------------------------------------------

const inFlight = new Set<Promise<unknown>>();

/** Waits (bounded) for hooks that were started without being awaited, so a session ends with no hook still running. */
export async function awaitBackgroundHooks(timeoutMs = 2_000): Promise<void> {
  if (inFlight.size === 0) return;
  await Promise.race([Promise.allSettled([...inFlight]), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

function emptyResult(): AggregatedHookResult {
  return {
    blocked: false,
    blockingErrors: [],
    preventContinuation: false,
    additionalContexts: [],
    results: [],
  };
}

/**
 * Fire hooks for a generic event. Resolves which hooks apply and are trusted, runs them, and records each run.
 * Swallows all errors so hooks never crash the agent.
 */
export async function executeEventHooks(
  input: HookInput,
  cwd: string,
  signal?: AbortSignal,
): Promise<AggregatedHookResult> {
  try {
    const event = input.hook_event_name;
    const resolution = resolveHooks(cwd);
    const matched = activeHooksFor(resolution, event, getMatchQuery(input));
    if (matched.length === 0) return emptyResult();
    const blockable = BLOCKABLE_EVENTS.has(event);
    // A hook that runs Shelra must not start hooks of its own: that is how a hook loops without end.
    if (Number(process.env[HOOK_DEPTH_ENV] ?? "0") >= 1) {
      for (const hook of matched) {
        const skipped: HookResult = { outcome: "success", exitCode: null, command: hook.hook.command, durationMs: 0 };
        record(event, hook.id, hook.source, hook.matcher, skipped, false);
        const last = runLog[runLog.length - 1];
        if (last) {
          last.outcome = "skipped";
          last.effect = "skipped";
          last.reason = "started from inside a hook";
        }
      }
      return emptyResult();
    }
    const synchronous = matched.filter((hook) => !hook.async);
    const background = matched.filter((hook) => hook.async);
    for (const hook of background) {
      const run = execCommandHook(hook.hook, input, cwd, signal, {
        hookId: hook.id,
        source: hook.source,
        blockable: false,
        projectDir: resolution.root,
      })
        .then((result) => record(event, hook.id, hook.source, hook.matcher, result, false))
        .catch((error) => recordSwallowedError(`hooks.background.${hook.id}`, error));
      inFlight.add(run);
      void run.finally(() => inFlight.delete(run));
    }
    const results = await Promise.all(
      synchronous.map((hook) =>
        execCommandHook(hook.hook, input, cwd, signal, {
          hookId: hook.id,
          source: hook.source,
          blockable,
          failurePolicy: hook.failurePolicy,
          projectDir: resolution.root,
        }),
      ),
    );
    const aggregated = aggregateResults(results);
    // Recorded in the order the hooks are defined, not the order they happened to finish, so the log is stable. A
    // failure of the bookkeeping must not discard a verdict that was already computed.
    try {
      synchronous.forEach((hook, index) => {
        const result = results[index];
        if (result && result.outcome !== "cancelled")
          record(event, hook.id, hook.source, hook.matcher, result, blockable);
      });
    } catch (error) {
      recordSwallowedError("hooks.record", error);
    }
    // On an event nothing waits for, a hook can say "block" and it means nothing: report that it only observed.
    if (!blockable) {
      aggregated.blocked = false;
      aggregated.blockingErrors = [];
      aggregated.preventContinuation = false;
      delete aggregated.decision;
    }
    try {
      reportHookIssues(event, aggregated);
    } catch (error) {
      recordSwallowedError("hooks.report", error);
    }
    return aggregated;
  } catch (error) {
    // Hooks never crash the agent, but a failure that turns every hook off (an unreadable settings or trust file)
    // must show: in the swallowed-error log and in the hook run log the person reads with /hooks.
    recordSwallowedError("hooks.resolve", error);
    record(
      input.hook_event_name,
      "hooks",
      "unknown",
      undefined,
      {
        outcome: "non_blocking_error",
        exitCode: null,
        command: "(resolving hooks)",
        stderr: `hooks could not be resolved, so none ran: ${error instanceof Error ? error.message : String(error)}`,
      },
      BLOCKABLE_EVENTS.has(input.hook_event_name),
    );
    return emptyResult();
  }
}

/**
 * Fire PreToolUse hooks. Returns the aggregated result which may block execution.
 */
export async function executePreToolHooks(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<AggregatedHookResult> {
  const input: PreToolUseHookInput = {
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    session_id: sessionId,
    cwd,
  };
  return executeEventHooks(input, cwd, signal);
}

/**
 * Fire PostToolUse hooks after a successful tool execution.
 */
export async function executePostToolHooks(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: Record<string, unknown>,
  cwd: string,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<AggregatedHookResult> {
  const input: PostToolUseHookInput = {
    hook_event_name: "PostToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_output: toolOutput,
    session_id: sessionId,
    cwd,
  };
  return executeEventHooks(input, cwd, signal);
}

/**
 * Fire PostToolUseFailure hooks after a tool execution fails.
 */
export async function executePostToolFailureHooks(
  toolName: string,
  toolInput: Record<string, unknown>,
  error: string,
  cwd: string,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<AggregatedHookResult> {
  const input: PostToolUseFailureHookInput = {
    hook_event_name: "PostToolUseFailure",
    tool_name: toolName,
    tool_input: toolInput,
    error,
    session_id: sessionId,
    cwd,
  };
  return executeEventHooks(input, cwd, signal);
}
