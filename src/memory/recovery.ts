import type { TurnCommand } from "./reflection";

/** Commands that only look at something: they are never the step that got past a failure. */
const INSPECTION_RE =
  /^(?:ls|dir|cat|type|head|tail|less|more|grep|rg|find|tree|wc|pwd|echo|which|where|stat|Get-ChildItem|gci|Get-Content|gc|Select-String|sls|Get-Location|Get-Item|Test-Path|Resolve-Path|Write-Output|Write-Host|git\s+(?:status|diff|log|show|branch|remote))\b/iu;

/** Drops leading `NAME=value` assignments, so a command is known by the program it runs. */
function withoutAssignments(command: string): string {
  return command.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/u, "");
}

/** A step that only moves the shell: `cd`, `Set-Location`, `pushd`, `if ($?) {` wrappers left around it. */
const MOVE_RE = /^(?:if\s*\(\$\?\)\s*\{\s*)?(?:cd|chdir|pushd|sl|set-location)(?:\s|$)/iu;

/** A step's program and first argument: two runs of the same check share it. */
function headOf(step: string): string {
  return step
    .replace(/^if\s*\(\$\?\)\s*\{\s*/iu, "")
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((token) =>
      token
        .replace(/^\.[\\/]/u, "")
        .replace(/^["']|["']$/gu, "")
        .toLowerCase(),
    )
    .join(" ");
}

/**
 * What a command does, read past its changes of directory: the first step that does work (its head and text) and
 * the first change of directory. Seen live 2026-09-25: a model prefixed every command with `cd <project>;`, so every
 * command looked like the same check and a lesson paired two unrelated ones.
 */
interface CommandShape {
  work: string;
  workStep: string;
  move: string;
}

function shapeOf(command: string): CommandShape {
  const steps = command
    .split(/[|;&\r\n]+/u)
    .map((step) => withoutAssignments(step).trim())
    .filter(Boolean);
  const workStep = steps.find((step) => !MOVE_RE.test(step)) ?? "";
  const moveStep = steps.find((step) => MOVE_RE.test(step)) ?? "";
  return { work: headOf(workStep), workStep: workStep.replace(/^if\s*\(\$\?\)\s*\{\s*/iu, ""), move: headOf(moveStep) };
}

/** A command's program and first argument, past any change of directory: two runs of the same check share it. */
export function checkHead(command: string): string {
  const shape = shapeOf(command);
  return shape.work || shape.move;
}

/** Another program given the same first argument, not a flag: `bun install` for `npm install`. */
function isAlternative(failedHead: string, laterHead: string): boolean {
  const [program, argument] = failedHead.split(" ");
  const [otherProgram, otherArgument] = laterHead.split(" ");
  return !!argument && !argument.startsWith("-") && program !== otherProgram && argument === otherArgument;
}

/** A line that says what went wrong, rather than a banner or a progress line. */
const ERROR_LINE_RE =
  /\b(?:error|errors|fail|failed|failure|cannot|can't|couldn't|not found|no such|missing|denied|refused|exception|traceback|panic|fatal|invalid|unexpected|undefined|timed out)\b/iu;

/**
 * The line of a command's output that names the failure: the first one that reads like an error, else the first line
 * (seen 2026-09-25: a lesson quoted `bun test v1.4.1 (4661e494f)`, the runner's banner, instead of
 * `error: Cannot find package 'ms'`).
 */
export function errorLine(output: string): string {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => ERROR_LINE_RE.test(line)) ?? lines[0] ?? "(no output)";
}

export interface Recovery {
  /** The later command that passed: the same check, or another program doing the same job. */
  passed: TurnCommand;
  /**
   * Another program was given the same first argument: `bun install` after `npm install` failed, or
   * `Set-Location "D:\my game"` after `cd D:\my game`.
   */
  alternative: boolean;
  /** What ran between the failure and the pass and did something (not a look or a search), the last two. */
  between: string[];
}

/**
 * How a turn got past the failed command at `index`, or null when nothing shows it did. Only the same check passing
 * later, or another program given the same first argument (not a flag), counts. Seen live 2026-09-25: an audit script that never
 * passed was paired with an unrelated `Select-String` that happened to succeed next, and the lesson told the next
 * session to treat that search as a prerequisite.
 */
export function recoveryOf(commands: readonly TurnCommand[], index: number): Recovery | null {
  const failed = commands[index];
  if (!failed || failed.success) return null;
  const shape = shapeOf(failed.command);
  if (!shape.work && !shape.move) return null;
  const sameCheck = (other: CommandShape) => shape.work !== "" && other.work === shape.work;
  // A later command that only changes directory can stand for the failed command's own change of directory
  // (`Set-Location "D:\my game"` after `cd D:\my game && …` failed on the space).
  const alternativeTo = (other: CommandShape) =>
    isAlternative(shape.work, other.work) || (other.work === "" && isAlternative(shape.move, other.move));
  const later = commands.slice(index + 1);
  const at = later.findIndex((command) => {
    if (!command.success) return false;
    const other = shapeOf(command.command);
    return sameCheck(other) || alternativeTo(other);
  });
  const passed = later[at];
  if (!passed) return null;
  const alternative = !sameCheck(shapeOf(passed.command));
  const between = alternative
    ? []
    : later
        .slice(0, at)
        .filter((command) => {
          const other = shapeOf(command.command);
          return command.success && other.work !== "" && !sameCheck(other) && !INSPECTION_RE.test(other.workStep);
        })
        .map((command) => command.command)
        .slice(-2);
  return { passed, alternative, between };
}
