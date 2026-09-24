/**
 * What a decision's failed check says: the rule is broken only when the check itself reached a verdict. A
 * check that timed out, was stopped, or could not start (its script, command or runtime is missing) vouches
 * for nothing either way. `shelra decisions check` and the agent's completion gate judge the same way, so
 * the two never disagree about the same workspace, and neither tells anyone to revert work over a missing tool.
 */

/** How a check's process ended. `refused`: the sandbox or the shell would not start it. */
export type CheckEndState = "completed" | "timed_out" | "killed" | "refused";

export interface CheckEnd {
  state: CheckEndState;
  exitCode: number | null;
  /** What the check printed (or the reason it was refused), already clipped by the caller. */
  output: string;
}

/** Exit codes of a shell whose command does not exist: sh 127 (126: found but not runnable), cmd 9009. */
const MISSING_COMMAND_EXITS = new Set([126, 127, 9009]);
/**
 * What only a failed launch prints: the shell's own "command not found", PowerShell's and cmd's "not
 * recognized", Bun's missing entry script, a shell or runtime that cannot find the file it was given. A test
 * whose output happens to say "not found" is a failing test, not one of these, so the messages are matched whole.
 */
const LAUNCH_FAILURE_RE =
  /command not found|is not recognized as (?:an internal|the name of)|error: (?:Module|Script) not found|^(?:bash|sh|zsh|dash|bun|node|python3?|deno)(?:\.exe)?: (?:line \d+: )?[^:\n]+: No such file or directory/imu;
/**
 * A module a runtime could not load. tsc, Node and pytest print the same words when the code under test
 * imports something missing (a dependency a decision forbids, say), which is a verdict; only the check's
 * own script missing means it could not run.
 */
const MISSING_MODULE_RE =
  /Cannot find module ['"]([^'"]+)['"]|No module named ['"]?([\w.]+)['"]?|can't open file ['"]([^'"]+)['"]/gu;

/** A script or module name without its folder and extension, for comparing a missing module with the check's. */
function stem(name: string): string {
  return (name.replaceAll("\\", "/").split("/").pop() ?? "").replace(/\.[^.]+$/u, "").toLowerCase();
}

/** The scripts a check command runs (`bun scripts/check.ts`, `python -m checks.sql`), by stem. */
function checkScripts(command: string): Set<string> {
  const tokens = command.split(/\s+/u).map((token) => token.replace(/^["']|["']$/gu, ""));
  const scripts = tokens.filter((token) => /\.(?:[cm]?[jt]sx?|py|sh|ps1)$/iu.test(token));
  const modules = tokens.flatMap((token, index) =>
    token === "-m" && tokens[index + 1] ? [tokens[index + 1] as string] : [],
  );
  return new Set([
    ...scripts.map(stem),
    ...modules.flatMap((module) => [module.toLowerCase(), stem(module.replaceAll(".", "/"))]),
  ]);
}

/** Why a failed check could not reach a verdict, or null when it did (the rule is broken). */
export function checkCouldNotRun(end: CheckEnd, command: string, seconds?: string): string | null {
  const after = end.output ? `\n${end.output}` : "";
  if (end.state === "timed_out") return `timed out${seconds ? ` after ${seconds} s` : ""}${after}`;
  if (end.state === "killed") return `was stopped before it finished${after}`;
  if (end.state === "refused") return end.output || "was refused";
  const own = checkScripts(command);
  const ownScriptMissing = [...end.output.matchAll(MISSING_MODULE_RE)].some((match) => {
    const name = match[1] ?? match[2] ?? match[3] ?? "";
    return own.has(stem(name)) || own.has(name.toLowerCase());
  });
  const missing =
    (end.exitCode !== null && MISSING_COMMAND_EXITS.has(end.exitCode)) ||
    LAUNCH_FAILURE_RE.test(end.output) ||
    ownScriptMissing;
  return missing ? end.output || `exited with ${end.exitCode}` : null;
}
