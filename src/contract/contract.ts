import type { BrowserObservation, CommandOutcome, HttpProbe } from "../exec/types";
import { type CheckEnd, checkCouldNotRun } from "../ledger/judge";
import { destructiveCommandReason } from "../security/destructive";
import { type CheckKind, type DiscoveredCheck, isSameCheck } from "./discover";
import { evaluateAcceptance } from "./evaluate";
import type { AcceptanceCriterion } from "./types";

/**
 * The task contract of a coding turn (audit doc 15, Phase 1.3–1.4): the project's own checks must pass on
 * the final code. A run the agent made after its last change is reused; the host runs every other check
 * itself. The model proposes; only running a check decides.
 */

/** A check the agent ran during the turn, as the host observed it. */
export interface ObservedCheckRun {
  command: string;
  passed: boolean;
  /** The output of a failed run, or a short note. */
  detail: string;
  /** Nothing in the workspace changed between this run and the end of the turn. */
  fresh: boolean;
  /** The run happened before the turn changed anything. */
  beforeFirstChange: boolean;
  /** For the host's own run of a decision check that reached no verdict: why (see `ContractCheckResult`). */
  unrunnable?: string;
}

/**
 * One check of the contract: a check the project states, or a plan criterion's command (`task`), which the
 * agent proposed and which failed before its change.
 */
export interface ContractCheck {
  /** A project check, a plan criterion's command, or the check of a decision the user approved. */
  kind: CheckKind | "task" | "decision";
  command: string;
  source: string;
  runs?: string;
}

export interface ContractCheckResult {
  check: ContractCheck;
  passed: boolean;
  /** Whose run decided: the agent's own fresh run, or the host's. */
  by: "agent" | "host";
  /** For a failure, the check's own output (what the repair round reads); otherwise a short note. */
  detail: string;
  /** A run before the turn's first change already failed: the failure predates the turn. */
  failedBefore: boolean;
  /** A run before the turn's first change passed: a failure now is a regression the turn caused. */
  passedBefore: boolean;
  /**
   * For a decision's check that failed without reaching a verdict (it timed out, or its script, command or
   * runtime is missing): why. Such a check vouches for nothing, and says nothing against the change either.
   */
  unrunnable?: string;
}

/** Runs one check command in the agent's workspace, the way the agent's own shell would. */
export type ContractCheckRunner = (
  command: string,
  /** `cwd` is the folder the checks belong to, whatever folder the agent's shell has moved to since. */
  options: { timeoutMs: number; signal?: AbortSignal; cwd?: string },
) => Promise<ContractRun>;

/** One run of a check: whether it passed and what it printed, and when known, how its process ended. */
export interface ContractRun {
  passed: boolean;
  output: string;
  durationMs: number;
  state?: CheckEnd["state"];
  exitCode?: number | null;
}

/** Why a failed decision check reached no verdict, or undefined for any other check or a real failure. */
function unrunnableDecision(check: ContractCheck, end: CheckEnd): string | undefined {
  return check.kind === "decision" ? (checkCouldNotRun(end, check.command) ?? undefined) : undefined;
}

/**
 * The checks a coding turn's final code must pass: tests, type-check and lint. Never a build, which
 * can have side effects (this repository's `bun run build` reinstalls the person's `shelra`).
 */
export function contractChecks(discovered: readonly DiscoveredCheck[]): DiscoveredCheck[] {
  return discovered.filter((check) => check.kind !== "build");
}

export async function evaluateTurnContract(input: {
  checks: readonly ContractCheck[];
  runs: readonly ObservedCheckRun[];
  workspace: string;
  runCheck: ContractCheckRunner;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ContractCheckResult[]> {
  const decided = new Map<ContractCheck, ContractCheckResult>();
  const forHost: ContractCheck[] = [];
  const before = (check: ContractCheck) => {
    const earlier = input.runs.filter((run) => isSameCheck(run.command, check) && run.beforeFirstChange);
    return { failedBefore: earlier.some((run) => !run.passed), passedBefore: earlier.some((run) => run.passed) };
  };
  for (const check of input.checks) {
    const latest = input.runs.filter((run) => isSameCheck(run.command, check)).at(-1);
    if (latest?.fresh) {
      // A host run keeps the verdict it got from how its process ended; of the agent's own run only the text
      // is known.
      const unrunnable = latest.passed
        ? undefined
        : check.kind === "decision"
          ? (latest.unrunnable ??
            unrunnableDecision(check, { state: "completed", exitCode: null, output: latest.detail }))
          : undefined;
      decided.set(check, {
        check,
        passed: latest.passed,
        by: "agent",
        detail: latest.passed ? `\`${check.command}\` passed` : latest.detail,
        ...before(check),
        ...(unrunnable ? { unrunnable } : {}),
      });
      continue;
    }
    const destructive = destructiveCommandReason(check.command, input.workspace);
    if (destructive) {
      // A command table in a repository is data: a check that would do damage is never run for it.
      const detail = `not run: \`${check.command}\` ${destructive}`;
      decided.set(check, {
        check,
        passed: false,
        by: "host",
        detail,
        ...before(check),
        // A decision check that would do damage vouches for nothing either way, as `shelra decisions check` says.
        ...(check.kind === "decision" ? { unrunnable: detail } : {}),
      });
      continue;
    }
    forHost.push(check);
  }

  if (forHost.length > 0) {
    // The full output of each host run: a repair round reads the failures in it, not a clipped summary.
    const outputs = new Map<string, ContractRun>();
    const criteria: AcceptanceCriterion[] = forHost.map((check, index) => ({
      id: `contract-${index}`,
      description: check.command,
      check: { kind: "command_succeeds", command: check.command, timeoutMs: input.timeoutMs },
      required: true,
    }));
    const report = await evaluateAcceptance(
      criteria,
      { workspace: input.workspace, attempt: 1, signal: input.signal },
      {
        runCommand: async (command, options) => {
          const result = await input.runCheck(command, {
            timeoutMs: options.timeoutMs ?? input.timeoutMs,
            signal: options.signal,
            cwd: input.workspace,
          });
          outputs.set(command, result);
          return outcome(command, options.cwd, result);
        },
        probeHttp: async (url): Promise<HttpProbe> => ({
          url,
          ok: false,
          durationMs: 0,
          error: "not available to the contract",
        }),
        observePage: async (url): Promise<BrowserObservation> => unavailablePage(url),
      },
    );
    forHost.forEach((check, index) => {
      const result = report.results.find((item) => item.id === `contract-${index}`);
      const passed = result?.passed ?? false;
      const run = outputs.get(check.command);
      const unrunnable =
        passed || !run
          ? undefined
          : unrunnableDecision(check, {
              state: run.state ?? "completed",
              exitCode: run.exitCode ?? null,
              output: run.output,
            });
      decided.set(check, {
        check,
        passed,
        by: "host",
        detail: passed
          ? (result?.detail ?? `\`${check.command}\` passed`)
          : run?.output || result?.detail || `\`${check.command}\` did not run`,
        ...before(check),
        ...(unrunnable ? { unrunnable } : {}),
      });
    });
  }

  return input.checks.flatMap((check) => {
    const result = decided.get(check);
    return result ? [result] : [];
  });
}

function outcome(command: string, cwd: string, result: ContractRun): CommandOutcome {
  return {
    command,
    cwd,
    exitCode: result.passed ? 0 : 1,
    stdout: result.passed ? result.output : "",
    stderr: result.passed ? "" : result.output,
    durationMs: result.durationMs,
    timedOut: false,
    state: "completed",
    truncated: false,
  };
}

function unavailablePage(url: string): BrowserObservation {
  return {
    ok: false,
    url,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    externalRequests: [],
    assertions: [],
    error: "not available to the contract",
  };
}
