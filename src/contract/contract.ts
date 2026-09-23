import type { BrowserObservation, CommandOutcome, HttpProbe } from "../exec/types";
import { destructiveCommandReason } from "../security/destructive";
import { type DiscoveredCheck, isSameCheck } from "./discover";
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
}

export interface ContractCheckResult {
  check: DiscoveredCheck;
  passed: boolean;
  /** Whose run decided: the agent's own fresh run, or the host's. */
  by: "agent" | "host";
  detail: string;
  /** A run before the turn's first change already failed: the failure predates the turn. */
  failedBefore: boolean;
}

/** Runs one check command in the agent's workspace, the way the agent's own shell would. */
export type ContractCheckRunner = (
  command: string,
  options: { timeoutMs: number; signal?: AbortSignal },
) => Promise<{ passed: boolean; output: string; durationMs: number }>;

/**
 * The checks a coding turn's final code must pass: tests, type-check and lint. Never a build, which
 * can have side effects (this repository's `bun run build` reinstalls the person's `shelra`).
 */
export function contractChecks(discovered: readonly DiscoveredCheck[]): DiscoveredCheck[] {
  return discovered.filter((check) => check.kind !== "build");
}

export async function evaluateTurnContract(input: {
  checks: readonly DiscoveredCheck[];
  runs: readonly ObservedCheckRun[];
  workspace: string;
  runCheck: ContractCheckRunner;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ContractCheckResult[]> {
  const decided = new Map<DiscoveredCheck, ContractCheckResult>();
  const forHost: DiscoveredCheck[] = [];
  for (const check of input.checks) {
    const mine = input.runs.filter((run) => isSameCheck(run.command, check));
    const failedBefore = mine.some((run) => run.beforeFirstChange && !run.passed);
    const latest = mine.at(-1);
    if (latest?.fresh) {
      decided.set(check, {
        check,
        passed: latest.passed,
        by: "agent",
        detail: latest.passed ? `\`${check.command}\` passed` : latest.detail,
        failedBefore,
      });
      continue;
    }
    const destructive = destructiveCommandReason(check.command, input.workspace);
    if (destructive) {
      // A command table in a repository is data: a check that would do damage is never run for it.
      decided.set(check, {
        check,
        passed: false,
        by: "host",
        detail: `not run: \`${check.command}\` ${destructive}`,
        failedBefore,
      });
      continue;
    }
    forHost.push(check);
  }

  if (forHost.length > 0) {
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
          });
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
      decided.set(check, {
        check,
        passed: result?.passed ?? false,
        by: "host",
        detail: result?.detail ?? `\`${check.command}\` did not run`,
        failedBefore: input.runs.some((run) => isSameCheck(run.command, check) && run.beforeFirstChange && !run.passed),
      });
    });
  }

  return input.checks.flatMap((check) => {
    const result = decided.get(check);
    return result ? [result] : [];
  });
}

function outcome(
  command: string,
  cwd: string,
  result: { passed: boolean; output: string; durationMs: number },
): CommandOutcome {
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
