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

/** Why removing `target` recursively is destructive, or null when it stays inside the project. */
function outsideTarget(target: string, cwd: string, project: string): string | null {
  const bare = target.replace(/^["']|["']$/gu, "");
  if (!bare) return null;
  const lowered = bare.toLowerCase();
  if (HOME_TOKENS.has(lowered) || /^(?:~|\$home|\$env:userprofile|%userprofile%)[\\/]/u.test(lowered)) {
    return "your home folder";
  }
  if (bare === "/" || bare === "/*" || /^[A-Za-z]:[\\/]?\*?$/u.test(bare)) return "the root of a drive";
  if (bare === "*" || bare === "." || bare === "./" || bare === ".\\") return "everything in the project";
  const full = isAbsolute(bare) ? bare : resolve(cwd, bare);
  const rel = relative(resolve(project), resolve(full));
  if (rel === "") return "the whole project";
  if (rel.startsWith("..") || isAbsolute(rel)) return `${bare}, outside the project`;
  return null;
}

/** Arguments that name what to delete: everything that is not a switch. cmd's switches start with `/`. */
function removalTargets(tokens: readonly string[], cmdStyle: boolean): string[] {
  return tokens.slice(1).filter((token) => !token.startsWith("-") && !(cmdStyle && token.startsWith("/")));
}

const REGISTRY_PATH_RE = /^(?:-path:?)?(?:registry::)?hk(?:lm|cu|cr|u|cc)(?::|\\|$)/iu;

function reasonFor(rawTokens: readonly string[], cwd: string, project: string): string | null {
  const tokens = rawTokens.filter((token) => !/^\d?>/u.test(token));
  const name = program(tokens[0]);
  const rawArgs = tokens.slice(1);
  const args = lower(rawArgs);

  if (name === "git") {
    const sub = args[0];
    if (sub === "push" && (hasFlag(args, "--force", "-f", "--force-with-lease") || args.some((a) => a.startsWith("+"))))
      return "force-pushes, rewriting the remote branch's history";
    if (sub === "reset" && hasFlag(args, "--hard")) return "discards all uncommitted changes";
    if (sub === "clean" && (hasShortFlag(args, "f") || hasFlag(args, "--force"))) return "deletes untracked files";
    if (sub === "checkout" && (args.includes("--") || args[1] === ".")) return "discards uncommitted changes to files";
    if (sub === "restore" && !hasFlag(args, "--staged", "-s") && args.length > 1)
      return "discards uncommitted changes to files";
    // `-D` (force) differs from `-d` (merged branches only), so this one flag is read case-sensitively.
    if (sub === "branch" && (hasShortFlag(rawArgs, "D") || (hasFlag(args, "--delete") && hasFlag(args, "--force"))))
      return "deletes a branch with work that may not be merged";
    if (sub === "stash" && (args[1] === "drop" || args[1] === "clear")) return "deletes stashed work";
    if (sub === "filter-branch" || sub === "filter-repo") return "rewrites the repository's history";
    return null;
  }

  if (name === "rm") {
    const recursive = hasShortFlag(args, "r") || hasShortFlag(args, "R") || hasFlag(args, "--recursive");
    if (!recursive) return null;
    for (const target of removalTargets(tokens, false)) {
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
    const recursive = args.some((arg) => arg === "-recurse" || arg === "-r" || arg === "/s");
    if (!recursive) return null;
    const cmdStyle = ["rd", "rmdir", "del", "erase"].includes(name) && args.some((arg) => arg.startsWith("/"));
    for (const target of removalTargets(tokens, cmdStyle)) {
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
  for (const tokens of splitShellCommands(command)) {
    const name = program(tokens[0]);
    if (["cd", "set-location", "sl", "chdir", "pushd"].includes(name) && tokens[1] && !tokens[1].startsWith("-")) {
      where = resolve(where, tokens[1].replace(/^["']|["']$/gu, ""));
      continue;
    }
    const reason = reasonFor(tokens, where, cwd);
    if (reason) return reason;
  }
  return null;
}
