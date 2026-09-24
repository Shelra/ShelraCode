import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { splitShellCommands } from "../agent/verification-evidence";

/**
 * Shell commands whose effect cannot be undone from inside the project: history rewritten on a remote,
 * uncommitted work discarded, files deleted outside the workspace (or the workspace itself), a disk
 * formatted, the machine shut down, the Windows registry changed. Shelra runs model-written commands on
 * the host, often from free and weaker models, and until the audit of 2026-09-23 nothing stopped these
 * but a sentence in the prompt. The bash tool asks the user before running one (in the terminal UI) or
 * refuses it where nobody can be asked (headless runs, benchmarks, sub-agents).
 *
 * The rules are deliberately narrow: deleting `node_modules` or `dist` inside the project, `git status`,
 * `git push` without force and `git restore --staged` stay unguarded.
 */

function lower(tokens: readonly string[]): string[] {
  return tokens.map((token) => token.toLowerCase());
}

function program(token: string | undefined): string {
  return (token ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.toLowerCase()
    .replace(/\.(?:exe|cmd|bat)$/u, "") as string;
}

function hasFlag(tokens: readonly string[], ...flags: string[]): boolean {
  return tokens.some((token) => flags.includes(token));
}

/** Short flags may be combined (`-rf`, `-fdx`). */
function hasShortFlag(tokens: readonly string[], letter: string): boolean {
  return tokens.some((token) => /^-[A-Za-z]+$/u.test(token) && token.slice(1).includes(letter));
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable reference, not a template
const HOME_TOKENS = new Set(["~", "$home", "%userprofile%", "$env:userprofile", "${home}"]);
const HOME_PREFIX_RE = /^(?:~|\$home|\$\{home\}|\$env:userprofile|%userprofile%)[\\/]/iu;

/** A path as the shell would resolve it from `cwd`: the home folder's spellings included. */
function resolveTarget(bare: string, cwd: string): string {
  if (HOME_TOKENS.has(bare.toLowerCase())) return homedir();
  if (HOME_PREFIX_RE.test(bare)) return resolve(homedir(), bare.replace(/^[^\\/]+[\\/]/u, ""));
  return isAbsolute(bare) ? bare : resolve(cwd, bare);
}

/** Why removing `target` recursively is destructive, or null when it stays inside the project. */
function outsideTarget(target: string, cwd: string, project: string): string | null {
  const bare = target.replace(/^["']|["']$/gu, "");
  if (!bare) return null;
  const lowered = bare.toLowerCase();
  if (HOME_TOKENS.has(lowered) || HOME_PREFIX_RE.test(bare)) return "your home folder";
  if (bare === "/" || bare === "/*" || /^[A-Za-z]:[\\/]?\*?$/u.test(bare)) return "the root of a drive";
  if (bare === "*" || bare === "." || bare === "./" || bare === ".\\") return "everything in the project";
  // `./*`, `.\*` and `<folder>/*`: everything under that folder.
  const everythingUnder = /^(.+?)[\\/]\*+$/u.exec(bare);
  const full = resolveTarget(everythingUnder?.[1] ?? bare, cwd);
  const rel = relative(resolve(project), resolve(full));
  if (rel === "") return everythingUnder ? "everything in the project" : "the whole project";
  if (rel.startsWith("..") || isAbsolute(rel)) return `${bare}, outside the project`;
  return null;
}

/** Arguments that name what to delete: everything that is not a switch. cmd's switches start with `/`. */
function removalTargets(tokens: readonly string[], cmdStyle: boolean): string[] {
  return tokens.slice(1).filter((token) => !token.startsWith("-") && !(cmdStyle && token.startsWith("/")));
}

const REGISTRY_PATH_RE =
  /^(?:-path:?)?(?:registry::)?(?:hk(?:lm|cu|cr|u|cc)|hkey_(?:local_machine|current_user|classes_root|users|current_config))(?::|\\|$)/iu;

/** Git's options before the subcommand, with a value (`-C dir`, `-c k=v`) or without (`--no-pager`). */
const GIT_OPTIONS_WITH_VALUE = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);

/** The git subcommand and its arguments, skipping the global options that could hide it. */
function gitSubcommand(args: readonly string[]): string[] {
  let index = 0;
  while (index < args.length) {
    const arg = args[index] as string;
    if (GIT_OPTIONS_WITH_VALUE.has(arg)) index += 2;
    else if (arg.startsWith("-")) index += 1;
    else break;
  }
  return args.slice(index);
}

/** Commands that list files; a recursive removal piped from one deletes what they listed. */
const LISTING_COMMANDS = new Set(["gci", "get-childitem", "ls", "dir", "gi", "get-item", "find"]);
const PASS_THROUGH_COMMANDS = new Set([
  "where-object",
  "where",
  "?",
  "select-object",
  "select",
  "foreach-object",
  "%",
  "sort-object",
  "sort",
  "xargs",
]);

function reasonFor(
  rawTokens: readonly string[],
  cwd: string,
  project: string,
  piped: readonly string[],
): string | null {
  const tokens = rawTokens.filter((token) => !/^\d?>/u.test(token));
  const name = program(tokens[0]);
  const rawArgs = tokens.slice(1);
  const args = lower(rawArgs);

  if (name === "git") {
    const sub = gitSubcommand(args)[0];
    if (sub === "push" && (hasFlag(args, "--force", "-f", "--force-with-lease") || args.some((a) => a.startsWith("+"))))
      return "force-pushes, rewriting the remote branch's history";
    if (sub === "reset" && hasFlag(args, "--hard")) return "discards all uncommitted changes";
    if (sub === "clean" && (hasShortFlag(args, "f") || hasFlag(args, "--force"))) return "deletes untracked files";
    if (sub === "checkout" && (args.includes("--") || gitSubcommand(args)[1] === "."))
      return "discards uncommitted changes to files";
    if (sub === "restore" && !hasFlag(args, "--staged", "-s") && gitSubcommand(args).length > 1)
      return "discards uncommitted changes to files";
    // `-D` (force) differs from `-d` (merged branches only), so this one flag is read case-sensitively;
    // `-d -f`, `-df` and `--delete --force` force it too.
    if (
      sub === "branch" &&
      (hasShortFlag(rawArgs, "D") ||
        (hasFlag(args, "--delete") && hasFlag(args, "--force")) ||
        (hasShortFlag(args, "d") && hasShortFlag(args, "f")))
    )
      return "deletes a branch with work that may not be merged";
    if (sub === "stash" && (gitSubcommand(args)[1] === "drop" || gitSubcommand(args)[1] === "clear"))
      return "deletes stashed work";
    if (sub === "filter-branch" || sub === "filter-repo") return "rewrites the repository's history";
    return null;
  }

  if (name === "rm") {
    const recursive = hasShortFlag(args, "r") || hasShortFlag(args, "R") || hasFlag(args, "--recursive");
    if (!recursive) return null;
    const targets = removalTargets(tokens, false);
    for (const target of targets.length > 0 ? targets : piped) {
      const where = outsideTarget(target, cwd, project);
      if (where) return `deletes ${where} recursively`;
    }
    return null;
  }

  if (
    ["remove-item", "ri", "set-itemproperty", "new-itemproperty", "remove-itemproperty", "new-item"].includes(name) &&
    rawArgs.some((arg) => REGISTRY_PATH_RE.test(arg))
  ) {
    return "changes the Windows registry";
  }

  // PowerShell and cmd deletion: Remove-Item/ri/rd/rmdir/del/erase with a recursive switch.
  if (["remove-item", "ri", "rd", "rmdir", "del", "erase"].includes(name)) {
    const recursive = args.some(
      (arg) => arg === "-recurse" || arg === "-recurse:$true" || arg === "-r" || arg === "/s",
    );
    if (!recursive) return null;
    const cmdStyle = ["rd", "rmdir", "del", "erase"].includes(name) && args.some((arg) => arg.startsWith("/"));
    const targets = removalTargets(tokens, cmdStyle);
    for (const target of targets.length > 0 ? targets : piped) {
      const where = outsideTarget(target, cwd, project);
      if (where) return `deletes ${where} recursively`;
    }
    return null;
  }

  if (["format-volume", "clear-disk", "diskpart", "initialize-disk"].includes(name) || /^mkfs(\.|$)/u.test(name))
    return "formats or wipes a disk";
  if (name === "format" && args.some((arg) => /^[a-z]:$/u.test(arg))) return "formats a disk";
  if (name === "dd" && args.some((arg) => arg.startsWith("of=/dev/"))) return "overwrites a disk device";

  if (["shutdown", "reboot", "halt", "poweroff", "restart-computer", "stop-computer"].includes(name))
    return "shuts down or restarts the machine";

  if (name === "reg" && ["delete", "add", "import"].includes(args[0] ?? "")) return "changes the Windows registry";

  return null;
}

/** Why `command` is destructive (for the approval prompt), or null when it is not. */
export function destructiveCommandReason(command: string, cwd: string): string | null {
  // A `cd` earlier in the same command line moves where later relative paths point.
  let where = cwd;
  // What a listing command in the pipeline named, for a removal that takes its targets from the pipe.
  let piped: string[] = [];
  for (const tokens of splitShellCommands(command)) {
    const name = program(tokens[0]);
    if (["cd", "set-location", "sl", "chdir", "pushd"].includes(name)) {
      // `cd`, `cd ~` and `cd $HOME` go home; `cd -P dir` and `cd -- dir` still go to dir; `cd -` is unknown.
      const target = tokens
        .slice(1)
        .find((token) => !token.startsWith("-"))
        ?.replace(/^["']|["']$/gu, "");
      if (target !== undefined || !tokens.slice(1).includes("-"))
        where = target ? resolveTarget(target, where) : homedir();
      continue;
    }
    const reason = reasonFor(tokens, where, cwd, piped);
    if (reason) return reason;
    if (LISTING_COMMANDS.has(name)) {
      const named = tokens.slice(1).filter((token) => !token.startsWith("-") && !token.startsWith("/"));
      piped = named.length > 0 ? named : ["."];
    } else if (!PASS_THROUGH_COMMANDS.has(name)) {
      piped = [];
    }
  }
  return null;
}
