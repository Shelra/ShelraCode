import type { ObservedCheckRun } from "../contract/contract";
import { foldPath } from "../ledger/glob";
import { redact } from "../utils/session-trace";
import { changedPaths, type WorkspaceState } from "./workspace-state";

/** A check the host observed; its outcome does not by itself establish freshness or task completion. */
export interface WorkspaceCheckReceipt {
  command: string;
  passed: boolean;
  detail: string;
  mutationEvents: number;
  /** Candidate observed after this individual run, never after a batch of later checks. */
  state: WorkspaceState | null;
  /** When supplied, a change during the run prevents it from verifying the candidate it left behind. */
  beforeState?: WorkspaceState | null;
  cwd: string;
  finished?: boolean;
  unrunnable?: string;
  source?: "agent" | "host";
  execution?: "caller-runner" | "private-copy" | "windows-appcontainer";
  candidateFingerprint?: string;
}

export interface CheckReceiptContext {
  workspace: string;
  startState: WorkspaceState | null;
  currentState: WorkspaceState | null;
  mutationEvents: number;
}

/** Redacted public projection. Passed describes the observed run; fresh describes its final candidate. */
export interface HostCheckResult {
  command: string;
  cwd: string;
  source: "agent" | "host";
  passed: boolean;
  fresh: boolean;
  finished?: boolean;
  unrunnable?: string;
  detail: string;
  execution?: "caller-runner" | "private-copy" | "windows-appcontainer";
  candidateFingerprint?: string;
}

export type HostTurnStatus = "verified" | "answered" | "unverified" | "blocked" | "limited" | "paused" | "cancelled";

/** The existing completion gate's verdict and its evidence, not a second acceptance evaluator. */
export interface HostTurnResult {
  readonly taskId: string;
  readonly status: HostTurnStatus;
  readonly verified: boolean;
  readonly changedFiles: readonly string[];
  readonly checks: readonly Readonly<HostCheckResult>[];
  readonly limitations: readonly string[];
}

function sameCandidate(before: WorkspaceState | null, after: WorkspaceState | null): boolean {
  return before !== null && after !== null && changedPaths(before, after)?.length === 0;
}

/** Reuse the contract's run type and freshness policy; an unknown comparison never becomes a fresh run. */
export function observedCheckRuns(
  receipts: readonly WorkspaceCheckReceipt[],
  context: CheckReceiptContext,
): ObservedCheckRun[] {
  return receipts.map((receipt) => {
    const inWorkspace = foldPath(receipt.cwd) === foldPath(context.workspace);
    const stableDuringRun = receipt.beforeState === undefined || sameCandidate(receipt.beforeState, receipt.state);
    return {
      command: receipt.command,
      passed: receipt.passed,
      detail: receipt.detail,
      fresh:
        inWorkspace &&
        receipt.mutationEvents === context.mutationEvents &&
        stableDuringRun &&
        sameCandidate(receipt.state, context.currentState),
      beforeFirstChange:
        inWorkspace &&
        receipt.mutationEvents === 0 &&
        stableDuringRun &&
        sameCandidate(context.startState, receipt.state),
      ...(receipt.finished === undefined ? {} : { finished: receipt.finished }),
      ...(receipt.unrunnable === undefined ? {} : { unrunnable: receipt.unrunnable }),
    };
  });
}

function publicCheckResult(check: Readonly<HostCheckResult>): HostCheckResult {
  return {
    ...check,
    command: redact(check.command),
    cwd: redact(check.cwd),
    detail: redact(check.detail),
    ...(check.unrunnable === undefined ? {} : { unrunnable: redact(check.unrunnable) }),
  };
}

/** Keep outcome, scope and origin while redacting the observations exposed outside the contract evaluator. */
export function serializeCheckReceipts(
  receipts: readonly WorkspaceCheckReceipt[],
  context: CheckReceiptContext,
): HostCheckResult[] {
  const observations = observedCheckRuns(receipts, context);
  return receipts.map((receipt, index) =>
    publicCheckResult({
      command: receipt.command,
      cwd: receipt.cwd,
      source: receipt.source ?? "agent",
      ...(receipt.execution ? { execution: receipt.execution } : {}),
      ...(receipt.candidateFingerprint ? { candidateFingerprint: receipt.candidateFingerprint } : {}),
      passed: receipt.passed,
      fresh: observations[index].fresh,
      ...(receipt.finished === undefined ? {} : { finished: receipt.finished }),
      ...(receipt.unrunnable === undefined ? {} : { unrunnable: receipt.unrunnable }),
      detail: receipt.detail,
    }),
  );
}

function inline(value: string): string {
  return redact(value).replace(/\r?\n/gu, " ↵ ");
}

/** Describe exact commands, including stale failures and unavailable checks, without expanding their coverage. */
export function summarizeCheckReceipts(
  receipts: readonly WorkspaceCheckReceipt[],
  context: CheckReceiptContext,
): string {
  const checks = serializeCheckReceipts(receipts, context);
  if (checks.length === 0) return "";
  return [
    "[Shelra check receipts:",
    ...checks.map((check) => {
      const result =
        check.unrunnable !== undefined
          ? `unavailable: ${inline(check.unrunnable)}`
          : check.finished === false
            ? "did not finish"
            : check.passed
              ? "passed"
              : "failed";
      const candidate = check.fresh
        ? "candidate matches the final local workspace"
        : "not evidence for the final local workspace (stale or unknown candidate)";
      return `- ${check.source}: \`${inline(check.command)}\` in \`${inline(check.cwd)}\`: ${result}; ${candidate}.`;
    }),
    "]",
  ].join("\n");
}

/** Freeze a snapshot of the gate's result; callers cannot turn a later mutation into contradictory evidence. */
export function createHostTurnResult(input: Omit<HostTurnResult, "verified">): HostTurnResult {
  return Object.freeze({
    taskId: redact(input.taskId),
    status: input.status,
    verified: input.status === "verified",
    changedFiles: Object.freeze(input.changedFiles.map(redact)),
    checks: Object.freeze(input.checks.map((check) => Object.freeze(publicCheckResult(check)))),
    limitations: Object.freeze(input.limitations.map(redact)),
  });
}
