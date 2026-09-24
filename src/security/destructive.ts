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
 * `git push` without force and `git restore --staged` stay unguarded. They aim at what a model plausibly
 * writes, on Windows' default shell (PowerShell) too: a command wrapped in `cmd /c`, `powershell -Command`
 * or `bash -c`, a target behind a variable, a removal inside a `ForEach-Object` block. They are a net for
 * mistakes, not a sandbox against a determined adversary.
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

function unquote(token: string): string {
  return token.replace(/^["']|["']$/gu, "");
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable reference, not a template
const HOME_TOKENS = new Set(["~", "$home", "%userprofile%", "$env:userprofile", "${home}"]);
const HOME_PREFIX_RE = /^(?:~|\$home|\$\{home\}|\$env:userprofile|%userprofile%)[\\/]/iu;
/** A path that starts with a variable: `$env:TEMP`, `${env:TEMP}`, `%TEMP%`, `$TMPDIR`, `${TMPDIR}`. */
const VARIABLE_PREFIX_RE = /^(?:\$env:(\w+)|\$\{env:(\w+)\}|%(\w+)%|\$\{(\w+)\}|\$(\w+))(?=$|[\\/])/iu;
/** What a `ForEach-Object` block calls the item the pipe hands it. */
const PIPED_ITEM_RE = /^\$(?:_|psitem)(?:\.\w+)?$/iu;

/** Variables a command line sets before using them (`OUT=dist; rm -rf "$OUT"`, `$d = "..\x"`), by lower-cased name. */
type Variables = Map<string, string>;

/** A variable's value: set earlier in the command line, or in the environment (case-insensitive on Windows). */
function variableValue(name: string, variables: Variables): string | undefined {
  const local = variables.get(name.toLowerCase());
  if (local !== undefined) return local;
  const direct = process.env[name];
  if (direct !== undefined || process.platform !== "win32") return direct;
  const key = Object.keys(process.env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? process.env[key] : undefined;
}

/**
 * A path as the shell would resolve it from `cwd`, the home folder's spellings and variables included; null
 * when it depends on a variable whose value is not known here, or on a folder the command did not spell out.
 */
function resolveTarget(bare: string, cwd: string | null, variables: Variables): string | null {
  if (HOME_TOKENS.has(bare.toLowerCase())) return homedir();
  if (HOME_PREFIX_RE.test(bare)) return resolve(homedir(), bare.replace(/^[^\\/]+[\\/]/u, ""));
  const variable = VARIABLE_PREFIX_RE.exec(bare);
  if (variable) {
    const name = variable.slice(1).find(Boolean) as string;
    const rest = bare.slice(variable[0].length).replace(/^[\\/]/u, "");
    if (name.toLowerCase() === "pwd") return cwd === null ? null : resolve(cwd, rest);
    const value = variableValue(name, variables);
    if (!value) return null;
    const base = unquote(value);
    if (isAbsolute(base)) return resolve(base, rest);
    return cwd === null ? null : resolve(cwd, base, rest);
  }
  if (isAbsolute(bare)) return bare;
  return cwd === null ? null : resolve(cwd, bare);
}

interface Where {
  /** The folder later relative paths resolve from; null after a `cd` to a place the command does not spell out. */
  cwd: string | null;
  project: string;
  variables: Variables;
}

/** Why removing `target` recursively is destructive, or null when it stays inside the project. */
function outsideTarget(target: string, where: Where): string | null {
  const bare = unquote(target);
  if (!bare) return null;
  const lowered = bare.toLowerCase();
  if (HOME_TOKENS.has(lowered) || HOME_PREFIX_RE.test(bare)) return "your home folder";
  if (bare === "/" || bare === "/*" || /^[A-Za-z]:[\\/]?\*?$/u.test(bare)) return "the root of a drive";
  if (where.cwd === where.project && (bare === "*" || bare === "." || bare === "./" || bare === ".\\"))
    return "everything in the project";
  // `./*`, `.\*` and `<folder>/*`: everything under that folder.
  const everythingUnder = /^(.+?)[\\/]\*+$/u.exec(bare) ?? (bare === "*" ? [bare, "."] : null);
  const full = resolveTarget(everythingUnder?.[1] ?? bare, where.cwd, where.variables);
  if (full === null) return `${bare}, a location the command does not spell out,`;
  const rel = relative(resolve(where.project), resolve(full));
  if (rel === "") return everythingUnder ? "everything in the project" : "the whole project";
  if (rel.startsWith("..") || isAbsolute(rel)) return `${bare}, outside the project`;
  // The repository's history: nothing inside the project brings it back.
  if (/(?:^|[\\/])\.git$/iu.test(rel)) return "the repository's history (.git)";
  return null;
}

/**
 * Arguments that name what to delete: everything that is not a switch (cmd's switches start with `/`),
 * with PowerShell's lists (`@('a','b')`, `a,b`) read as their items and the piped item as what the pipe held.
 * A removal that names nothing deletes what the pipe held.
 */
function removalTargets(tokens: readonly string[], cmdStyle: boolean, piped: readonly string[]): string[] {
  const named = tokens
    .slice(1)
    .filter((token) => !token.startsWith("-") && !(cmdStyle && token.startsWith("/")))
    .flatMap((token) =>
      token
        .replace(/^@\(|\)$/gu, "")
        .split(",")
        .map((item) => unquote(item.trim()))
        .filter(Boolean),
    );
  const targets = named.flatMap((token) => (PIPED_ITEM_RE.test(token) ? [...piped] : [token]));
  return targets.length > 0 ? targets : [...piped];
}

function removalReason(targets: readonly string[], where: Where): string | null {
  for (const target of targets) {
    const outside = outsideTarget(target, where);
    if (outside) return `deletes ${outside} recursively`;
  }
  return null;
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
const PASS_THROUGH_COMMANDS = new Set(["where-object", "where", "?", "select-object", "select", "sort-object", "sort"]);
/** Commands that change the folder later relative paths resolve from. */
const CHANGE_DIRECTORY = new Set(["cd", "set-location", "sl", "chdir", "pushd", "push-location"]);
const RETURN_DIRECTORY = new Set(["popd", "pop-location"]);
/** `ForEach-Object` and its aliases: the removal is inside the block. */
const FOR_EACH = new Set(["foreach-object", "foreach", "%"]);
/** `find` tests that narrow what `-delete` removes. */
const FIND_ACTIONS = new Set(["-delete", "-depth", "-print", "-print0", "-exec", "-execdir", "-ok"]);

function reasonFor(rawTokens: readonly string[], where: Where, piped: readonly string[]): string | null {
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
    if (sub === "checkout" && (args.includes("--") || gitSubcommand(args)[1] === "." || hasFlag(args, "-f", "--force")))
      return "discards uncommitted changes to files";
    if (sub === "switch" && hasFlag(args, "-f", "--force", "--discard-changes"))
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
    return removalReason(removalTargets(tokens, false, piped), where);
  }

  if (
    ["remove-item", "ri", "set-itemproperty", "new-itemproperty", "remove-itemproperty", "new-item"].includes(name) &&
    rawArgs.some((arg) => REGISTRY_PATH_RE.test(arg))
  ) {
    return "changes the Windows registry";
  }

  // PowerShell and cmd deletion: Remove-Item and its aliases (rd, rmdir, del and erase are Remove-Item in
  // PowerShell), with a recursive switch in either shell's spelling.
  if (["remove-item", "ri", "rd", "rmdir", "del", "erase"].includes(name)) {
    const recursive = args.some(
      (arg) => arg === "-recurse" || arg === "-recurse:$true" || arg === "-r" || arg === "/s",
    );
    if (!recursive) return null;
    const cmdStyle = ["rd", "rmdir", "del", "erase"].includes(name) && args.some((arg) => arg.startsWith("/"));
    return removalReason(removalTargets(tokens, cmdStyle, piped), where);
  }

  // `find <roots> … -delete` or `-exec rm …`: a search root outside the project, or the whole project with
  // nothing that narrows what is deleted.
  if (
    name === "find" &&
    (args.includes("-delete") || args.some((arg, index) => arg === "-exec" && program(args[index + 1]) === "rm"))
  ) {
    const firstTest = rawArgs.findIndex((arg) => /^[-(!]/u.test(arg));
    const roots = firstTest < 0 ? rawArgs : rawArgs.slice(0, firstTest);
    const narrowed = args.slice(roots.length).some((arg) => arg.startsWith("-") && !FIND_ACTIONS.has(arg));
    for (const root of roots.length > 0 ? roots : ["."]) {
      const outside = outsideTarget(root, where);
      if (!outside) continue;
      if (narrowed && (outside === "everything in the project" || outside === "the whole project")) continue;
      return `deletes files under ${outside}`;
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

/** Prefix commands that run the rest of their arguments: which of their options take a value. */
const PREFIX_COMMANDS: Record<string, { valued: RegExp; assignments?: boolean; operands?: number }> = {
  sudo: { valued: /^-[ugpChrtD]$/u },
  doas: { valued: /^-[uC]$/u },
  nohup: { valued: /^$/u },
  time: { valued: /^-[fo]$/u },
  nice: { valued: /^-n$/u },
  env: { valued: /^(?:-u|--unset|-C|--chdir|-S)$/u, assignments: true },
  // The first operand is the duration.
  timeout: { valued: /^(?:-s|--signal|-k|--kill-after)$/u, operands: 1 },
  xargs: { valued: /^-[IdLnPsE]$/u },
};

/**
 * The command a wrapper runs: `cmd /c …`, `bash -c "…"`, `powershell -Command …` (or its base64
 * `-EncodedCommand`), `iex "…"`, or a prefix such as `sudo`, `env A=b`, `nohup`, `timeout 60` or `xargs -0`.
 * Null when the tokens are not a wrapper.
 */
function unwrap(tokens: readonly string[]): { command: string; fromPipe: boolean } | null {
  const name = program(tokens[0]);
  const rest = tokens.slice(1);
  const lowered = lower(rest);
  if (name === "cmd") {
    const index = lowered.findIndex((token) => token === "/c" || token === "/k");
    return index >= 0 ? { command: rest.slice(index + 1).join(" "), fromPipe: false } : null;
  }
  if (["bash", "sh", "zsh", "dash"].includes(name)) {
    const index = lowered.findIndex((token) => /^-[a-z]*c$/u.test(token));
    return index >= 0 && rest[index + 1] !== undefined ? { command: rest[index + 1] as string, fromPipe: false } : null;
  }
  if (name === "powershell" || name === "pwsh") {
    const encoded = lowered.findIndex((token) => /^-(?:e|ec|enc|encodedcommand)$/u.test(token));
    if (encoded >= 0 && rest[encoded + 1]) {
      return { command: Buffer.from(rest[encoded + 1] as string, "base64").toString("utf16le"), fromPipe: false };
    }
    const index = lowered.findIndex((token) => /^-(?:c|command)$/u.test(token));
    return index >= 0 ? { command: rest.slice(index + 1).join(" "), fromPipe: false } : null;
  }
  if (name === "iex" || name === "invoke-expression") {
    const command = rest.filter((token) => !/^-command$/iu.test(token)).join(" ");
    return command ? { command, fromPipe: false } : null;
  }
  const prefix = PREFIX_COMMANDS[name];
  if (!prefix) return null;
  let index = 0;
  let operands = prefix.operands ?? 0;
  while (index < rest.length) {
    const token = rest[index] as string;
    if (token.startsWith("-")) index += prefix.valued.test(token) ? 2 : 1;
    else if (prefix.assignments && /^\w+=/u.test(token)) index += 1;
    else if (operands > 0) {
      operands -= 1;
      index += 1;
    } else break;
  }
  return index < rest.length ? { command: rest.slice(index).join(" "), fromPipe: name === "xargs" } : null;
}

/** A variable assignment on its own (`OUT=dist`, `export OUT=dist`, `$out = "dist"`, `set OUT=dist`). */
function assignment(tokens: readonly string[]): Array<[string, string]> | null {
  const first = tokens[0] ?? "";
  const powershell = /^\$(?:env:)?(\w+)$/iu.exec(first);
  if (powershell && tokens[1] === "=") return [[powershell[1] as string, unquote(tokens.slice(2).join(" "))]];
  const words = ["export", "set", "declare", "local"].includes(first.toLowerCase()) ? tokens.slice(1) : tokens;
  if (words.length === 0 || !words.every((token) => /^\w+=/u.test(token))) return null;
  return words.map((token) => {
    const at = token.indexOf("=");
    return [token.slice(0, at), unquote(token.slice(at + 1))];
  });
}

const MAX_WRAPPING = 4;

function lineReason(command: string, start: Where, depth: number, inherited: readonly string[]): string | null {
  // A `cd` earlier in the same command line moves where later relative paths point.
  const where: Where = { ...start, variables: new Map(start.variables) };
  const stack: Array<string | null> = [];
  // What a listing command in the pipeline named, for a removal that takes its targets from the pipe.
  let piped: string[] = [...inherited];
  for (const simple of splitShellCommands(command)) {
    const assigned = assignment(simple);
    if (assigned) {
      for (const [key, value] of assigned) where.variables.set(key.toLowerCase(), value);
      continue;
    }
    // `A=1 rm -rf …`: assignments for one command only, then the command itself.
    const firstWord = simple.findIndex((token) => !/^\w+=/u.test(token));
    const tokens = firstWord > 0 ? simple.slice(firstWord) : simple;
    const name = program(tokens[0]);
    if (CHANGE_DIRECTORY.has(name)) {
      // `cd`, `cd ~` and `cd $HOME` go home; `cd -P dir` and `cd -- dir` still go to dir; `cd -` is unknown.
      const target = tokens.slice(1).find((token) => !token.startsWith("-"));
      if (name === "pushd" || name === "push-location") stack.push(where.cwd);
      if (target !== undefined) where.cwd = resolveTarget(unquote(target), where.cwd, where.variables);
      else if (tokens.slice(1).includes("-")) where.cwd = null;
      else where.cwd = homedir();
      continue;
    }
    if (RETURN_DIRECTORY.has(name)) {
      where.cwd = stack.length > 0 ? (stack.pop() ?? null) : null;
      continue;
    }
    const wrapped = depth < MAX_WRAPPING ? unwrap(tokens) : null;
    if (wrapped) {
      const inner = lineReason(wrapped.command, where, depth + 1, wrapped.fromPipe ? piped : []);
      if (inner) return inner;
      piped = [];
      continue;
    }
    const head = tokens[0] ?? "";
    if (FOR_EACH.has(name) || (head.includes("{") && FOR_EACH.has(head.slice(0, head.indexOf("{")).toLowerCase()))) {
      // `ForEach-Object { Remove-Item $_.FullName -Recurse }`: the block's first command, run on each item.
      const opened = tokens.findIndex((token) => token.includes("{"));
      const block =
        opened < 0
          ? []
          : tokens
              .slice(opened)
              .map((token, index) => (index === 0 ? token.slice(token.indexOf("{") + 1) : token))
              .map((token) => token.replace(/\}$/u, ""))
              .filter(Boolean);
      const inner = block.length > 0 ? reasonFor(block, where, piped) : null;
      if (inner) return inner;
      continue;
    }
    const reason = reasonFor(tokens, where, piped);
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

/** Why `command` is destructive (for the approval prompt), or null when it is not. */
export function destructiveCommandReason(command: string, cwd: string): string | null {
  return lineReason(command, { cwd, project: cwd, variables: new Map() }, 0, []);
}
