import type { TurnCommand } from "./reflection";

/** Commands that only look at something: they are never the step that got past a failure. */
const INSPECTION_RE =
  /^(?:ls|dir|cat|type|head|tail|less|more|grep|rg|find|tree|wc|pwd|echo|which|where|stat|Get-ChildItem|gci|Get-Content|gc|Select-String|sls|Get-Location|Get-Item|Test-Path|Resolve-Path|Write-Output|Write-Host|git\s+(?:status|diff|log|show|branch|remote))\b/iu;

/** Drops leading `NAME=value` assignments, so a command is known by the program it runs. */
function withoutAssignments(command: string): string {
  return command.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/u, "");
}

/** A command's program and first argument, up to the first pipe or separator: two runs of the same check share it. */
export function checkHead(command: string): string {
  return withoutAssignments(command.split(/[|;&]/u)[0] ?? "")
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
  const head = checkHead(failed.command);
  if (!head) return null;
  const [program, argument] = head.split(" ");
  const later = commands.slice(index + 1);
  const at = later.findIndex((command) => {
    if (!command.success) return false;
    const other = checkHead(command.command);
    if (other === head) return true;
    const [otherProgram, otherArgument] = other.split(" ");
    return otherProgram !== program && !!argument && !argument.startsWith("-") && otherArgument === argument;
  });
  const passed = later[at];
  if (!passed) return null;
  const alternative = checkHead(passed.command) !== head;
  const between = alternative
    ? []
    : later
        .slice(0, at)
        .filter(
          (command) =>
            command.success &&
            checkHead(command.command) !== head &&
            !INSPECTION_RE.test(withoutAssignments(command.command)),
        )
        .map((command) => command.command)
        .slice(-2);
  return { passed, alternative, between };
}
