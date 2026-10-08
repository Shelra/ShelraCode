import type { ContractCheckRunner, ContractRun } from "../contract/contract";
import { runCommand } from "../exec/command";
import { freezeWorkspace } from "../exec/frozen-workspace";
import { gradingEnvironment } from "../exec/verification-environment";
import { runWindowsVerification } from "../exec/windows-appcontainer";
import { BashTool } from "../tools/bash";
import type { ToolResult } from "../types";
import { runnableVerifierCommand, verifierCommandProblem, verifierTestFile } from "./behavior-verifier";
import { captureCheckerFiles, checkerFilesMatch } from "./checker-files";
import { captureWorkspaceStateAsync, changedPaths } from "./workspace-state";

export interface IndependentCandidateRun {
  run: ContractRun;
  problem?: string;
  execution: "caller-runner" | "private-copy" | "windows-appcontainer";
  candidateFingerprint: string;
}

/** Both the checker tool and final host run use this path; no untrusted test executes on the live project. */
export async function runIndependentCandidate(input: {
  workspace: string;
  command: string;
  files: ReadonlyMap<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Trusted API injection for tests. It does not receive an OS-isolation claim. */
  runner?: ContractCheckRunner;
}): Promise<IndependentCandidateRun> {
  const frozen = await freezeWorkspace(input.workspace);
  try {
    const before = await captureWorkspaceStateAsync(frozen.workspace);
    if (before.kind === "unknown") throw new Error("The independent check's private candidate could not be observed.");
    const originals = checkerFilesMatch(frozen.workspace, input.files);
    if (!originals.ok) throw new Error(`The independent check's private oracle is incomplete: ${originals.reason}`);
    let execution: IndependentCandidateRun["execution"] = input.runner ? "caller-runner" : "private-copy";
    let run: ContractRun;
    if (input.runner)
      run = await input.runner(input.command, {
        cwd: frozen.workspace,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      });
    else {
      const outcome =
        process.platform === "win32"
          ? await runWindowsVerification(input.command, frozen, {
              timeoutMs: input.timeoutMs,
              signal: input.signal,
              protectedPaths: [".shelra/verify"],
            })
          : await runCommand({
              command: input.command,
              cwd: frozen.workspace,
              timeoutMs: input.timeoutMs,
              signal: input.signal,
              env: gradingEnvironment(frozen),
              inheritEnv: false,
              logDir: frozen.temp,
            });
      if ("isolated" in outcome && outcome.isolated) execution = "windows-appcontainer";
      run = {
        passed: outcome.state === "completed" && outcome.exitCode === 0,
        output: [outcome.stdout, outcome.stderr].filter(Boolean).join("\n"),
        durationMs: outcome.durationMs,
        state: outcome.state === "spawn_error" ? "refused" : outcome.state,
        exitCode: outcome.exitCode,
      };
    }
    const touched = changedPaths(before, await captureWorkspaceStateAsync(frozen.workspace));
    const oracle = checkerFilesMatch(frozen.workspace, input.files);
    const problem =
      touched === null
        ? "the independent check's private candidate could not be compared"
        : touched.length > 0
          ? `the independent check changed project files in its private copy: ${touched.slice(0, 10).join(", ")}`
          : !oracle.ok
            ? `the independent check changed its frozen oracle: ${oracle.reason}`
            : run.state === "refused"
              ? `the independent check could not run in its private candidate: ${run.output}`
              : undefined;
    await frozen.integrity();
    return { run, ...(problem ? { problem } : {}), execution, candidateFingerprint: frozen.receipt.candidate };
  } finally {
    await frozen.cleanup();
  }
}

/** Keeping execution below the tool broker preserves schemas, inherited policy, hooks and operation receipts. */
export class IndependentCheckerBash extends BashTool {
  constructor(
    root: string,
    private readonly callerRunner?: ContractCheckRunner,
    private readonly unavailableReason?: string,
  ) {
    super(root, { root });
  }

  override async execute(command: string, timeout = 30_000, signal?: AbortSignal): Promise<ToolResult> {
    try {
      if (this.unavailableReason) throw new Error(this.unavailableReason);
      const testFile = verifierTestFile(command);
      if (!testFile) throw new Error("The checker must run exactly one test under .shelra/verify.");
      const problem = verifierCommandProblem(command, testFile);
      if (problem) throw new Error(problem);
      const captured = captureCheckerFiles(this.getRootCwd());
      if (!captured.ok) throw new Error(captured.reason);
      const result = await runIndependentCandidate({
        workspace: this.getRootCwd(),
        command: runnableVerifierCommand(command, testFile),
        files: captured.files,
        timeoutMs: timeout,
        signal,
        runner: this.callerRunner,
      });
      return {
        success: result.run.passed && result.problem === undefined,
        output: result.run.output,
        ...(result.problem || !result.run.passed ? { error: result.problem ?? result.run.output } : {}),
      };
    } catch (error) {
      return { success: false, refused: "blocked", error: `Checker execution unavailable: ${String(error)}` };
    }
  }

  override getToolDescription(): string {
    return "Run one independent test under .shelra/verify in a private candidate copy. Windows execution requires AppContainer. Do not chain commands or start background processes.";
  }
}
