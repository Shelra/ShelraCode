/**
 * Decides, from the command text alone, whether a shell command can only read. It is deny-by-default: a command runs
 * for a read-only agent only if every simple command in it is on a short list of programs, each called with flags that
 * cannot write, execute another program, or reach the network. Redirections, command substitution, background jobs,
 * assignments before a command, interpreters, `xargs`, `tee`, `sed -i` and every unlisted program are refused.
 *
 * It is a text classifier, so it is not an operating-system sandbox: where the Shuru sandbox exists it is the stronger
 * boundary (docs/architecture/24-EXTENSIONS.md §Read-only agents). What it guarantees is that a prompt cannot talk a
 * read-only agent into writing: the host refuses the call before it reaches a shell.
 */

export interface ShellVerdict {
  allowed: boolean;
  /** Why it was refused, written for the model so it can pick another approach. */
  reason?: string;
}

const MAX_COMMAND_LENGTH = 4000;

/** Programs that only read when called with ordinary arguments; the flags that break that are checked below. */
const READ_PROGRAMS = new Set([
  "ls",
  "dir",
  "cat",
  "type",
  "head",
  "tail",
  "wc",
  "pwd",
  "echo",
  "which",
  "where",
  "whoami",
  "date",
  "uname",
  "stat",
  "file",
  "du",
  "df",
  "tree",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "cut",
  "tr",
  "diff",
  "cmp",
  "comm",
  "nl",
  "rev",
  "seq",
  "printenv",
  "id",
  "hostname",
  "rg",
  "grep",
  "egrep",
  "fgrep",
  "findstr",
  "jq",
  "md5sum",
  "sha1sum",
  "sha256sum",
  "cksum",
  "sort",
  "uniq",
  "find",
  "column",
  "fold",
  "tac",
  "strings",
  "od",
  "git",
  "sed",
  "cd",
  "true",
  "false",
]);

const POWERSHELL_PROGRAMS = new Set([
  "get-childitem",
  "gci",
  "get-content",
  "gc",
  "select-string",
  "sls",
  "get-location",
  "gl",
  "get-item",
  "gi",
  "test-path",
  "resolve-path",
  "get-filehash",
  "measure-object",
  "measure",
  "sort-object",
  "select-object",
  "select",
  "where-object",
  "format-table",
  "ft",
  "format-list",
  "fl",
  "out-string",
  "get-date",
  "get-command",
  "write-output",
  "compare-object",
  "split-path",
  "join-path",
  "get-process",
]);

const GIT_SUBCOMMANDS = new Set([
  "status",
  "log",
  "show",
  "diff",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "rev-list",
  "branch",
  "tag",
  "remote",
  "config",
  "describe",
  "shortlog",
  "cat-file",
  "for-each-ref",
  "grep",
  "merge-base",
  "name-rev",
  "show-ref",
  "stash",
  "worktree",
  "reflog",
  "count-objects",
  "submodule",
]);

const NULL_REDIRECTS = [
  /^2>\/dev\/null/u,
  /^2>&1/u,
  /^>\/dev\/null/u,
  /^1>\/dev\/null/u,
  /^2>nul\b/iu,
  /^>nul\b/iu,
  /^2>\$null\b/iu,
  /^>\$null\b/iu,
  /^1>&2/u,
];

const GROUPING_REFUSED =
  "parentheses and braces outside quotes are not allowed (they run or expand into other commands)";

function refuse(reason: string): ShellVerdict {
  return { allowed: false, reason };
}

interface SimpleCommand {
  words: string[];
}

/** Splits into simple commands and rejects every construct that can write or run something else. */
function split(command: string): { commands: SimpleCommand[] } | { error: string } {
  const commands: SimpleCommand[] = [];
  let words: string[] = [];
  let word = "";
  let hasWord = false;
  let quote: "'" | '"' | null = null;
  const pushWord = () => {
    if (hasWord) words.push(word);
    word = "";
    hasWord = false;
  };
  const pushCommand = () => {
    pushWord();
    if (words.length > 0) commands.push({ words });
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const char = command[i] as string;
    const rest = command.slice(i);
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
      hasWord = true;
      continue;
    }
    if (quote === '"') {
      if (char === "`" || rest.startsWith("$(") || rest.startsWith("${"))
        return { error: "command substitution is not allowed" };
      if (char === "\\" && i + 1 < command.length) {
        word += command[i + 1];
        i++;
      } else if (char === '"') quote = null;
      else word += char;
      hasWord = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      hasWord = true;
      continue;
    }
    if (
      char === "`" ||
      rest.startsWith("$(") ||
      rest.startsWith("${") ||
      rest.startsWith("<(") ||
      rest.startsWith(">(")
    ) {
      return { error: "command substitution and process substitution are not allowed" };
    }
    // Parentheses group and run what is inside (PowerShell, this host's shell, evaluates `(cmd)` and `@(cmd)`), and braces
    // expand into words the flag checks below never saw (`sort {-o,out} in`): neither is read-only. Quoted, they are text.
    if (char === "(" || char === ")" || char === "{" || char === "}") {
      return { error: GROUPING_REFUSED };
    }
    if (char === "\\" && "(){}".includes(command[i + 1] ?? " ")) {
      return { error: GROUPING_REFUSED };
    }
    if (char === "\\" && i + 1 < command.length) {
      // A caret or backslash before a newline continues a line; anywhere else it escapes the next character.
      if (command[i + 1] !== "\n" && command[i + 1] !== "\r") {
        word += command[i + 1];
        hasWord = true;
      }
      i++;
      continue;
    }
    if (
      char === ">" ||
      char === "<" ||
      (char === "&" && command[i + 1] !== "&") ||
      ((char === "1" || char === "2") && command[i + 1] === ">")
    ) {
      const target = NULL_REDIRECTS.find((pattern) => pattern.test(rest));
      if (target) {
        const match = target.exec(rest) as RegExpExecArray;
        // Only a redirection that starts a word (after a space) is the null-device form.
        if (word === "" && !hasWord) {
          i += match[0].length - 1;
          continue;
        }
      }
      if (char === "&") return { error: "background jobs are not allowed" };
      if (char === "<") return { error: "input redirection is not allowed" };
      if (char === ">" || command[i + 1] === ">") return { error: "redirecting output to a file is not allowed" };
    }
    if (char === "\n" || char === "\r" || char === ";") {
      pushCommand();
      continue;
    }
    if (char === "|") {
      pushCommand();
      if (command[i + 1] === "|") i++;
      continue;
    }
    if (char === "&" && command[i + 1] === "&") {
      pushCommand();
      i++;
      continue;
    }
    if (/\s/u.test(char)) {
      pushWord();
      continue;
    }
    word += char;
    hasWord = true;
  }
  if (quote) return { error: "an unclosed quote" };
  pushCommand();
  return { commands };
}

function programName(word: string): string {
  const base = word.replace(/\\/gu, "/").split("/").pop() ?? word;
  return base.toLowerCase().replace(/\.(exe|cmd|bat|ps1|com)$/u, "");
}

function flagsOf(args: string[]): string[] {
  return args.filter((arg) => arg.startsWith("-") && arg !== "-");
}

function positional(args: string[]): string[] {
  return args.filter((arg) => !arg.startsWith("-") || arg === "-");
}

function checkGit(args: string[]): ShellVerdict {
  let index = 0;
  while (index < args.length && (args[index] as string).startsWith("-")) {
    const option = args[index] as string;
    if (option === "--no-pager" || option === "--no-optional-locks" || option === "-P") index++;
    else if (option === "-C" && index + 1 < args.length) index += 2;
    else
      return refuse(
        `git option ${option} before the subcommand is not allowed (it can run programs or redirect the repository)`,
      );
  }
  const sub = args[index];
  if (!sub) return refuse("git needs a subcommand");
  if (!GIT_SUBCOMMANDS.has(sub))
    return refuse(`git ${sub} can change the repository or reach the network; it is not on the read-only list`);
  const rest = args.slice(index + 1);
  const flags = flagsOf(rest);
  const has = (...names: string[]) =>
    flags.some((flag) => names.includes(flag) || names.some((name) => flag.startsWith(`${name}=`)));
  if (flag0(flags, "--output")) return refuse("--output writes a file");
  if (has("--ext-diff", "--open-files-in-pager", "-O", "--upload-pack", "--exec", "--receive-pack"))
    return refuse("that git option runs another program");
  // `git grep -O<command>` (value attached) runs the command through a shell.
  // Git accepts any unambiguous prefix of a long option, so every spelling of --open-files-in-pager (--op, --open-f…).
  if (sub === "grep" && flags.some((flag) => /^-[A-Za-z]*O/u.test(flag) || /^--op/u.test(flag)))
    return refuse("git grep -O runs another program");
  if (sub === "diff" && !(has("--no-ext-diff") && has("--no-textconv")))
    return refuse("git diff can run diff drivers configured in the repository: add --no-ext-diff --no-textconv");
  if (sub === "show" && !has("--no-textconv"))
    return refuse("git show can run textconv filters configured in the repository: add --no-textconv");
  if (
    sub === "log" &&
    flags.some((flag) =>
      /^(-p|-u|--patch|--stat|--numstat|--shortstat|--dirstat|--cc|-c|-m|--word-diff|--raw)\b/u.test(flag),
    ) &&
    !has("--no-textconv")
  )
    return refuse("git log with a patch can run textconv filters configured in the repository: add --no-textconv");
  if (sub === "cat-file" && has("--textconv", "--filters")) return refuse("that git option runs configured filters");
  if (sub === "branch") {
    const listing = has(
      "--list",
      "-l",
      "--show-current",
      "--contains",
      "--merged",
      "--no-merged",
      "-a",
      "--all",
      "-r",
      "--remotes",
      "-v",
      "-vv",
    );
    const writes = has(
      "-d",
      "-D",
      "-m",
      "-M",
      "-c",
      "-C",
      "--delete",
      "--move",
      "--copy",
      "-f",
      "--force",
      "--set-upstream-to",
      "-u",
      "--unset-upstream",
      "--edit-description",
    );
    if (writes || (positional(rest).length > 0 && !has("--list", "-l", "--contains", "--merged", "--no-merged")))
      return refuse("git branch with a name or a modifying flag changes the repository");
    if (!listing && positional(rest).length > 0) return refuse("git branch with a name creates a branch");
  }
  if (sub === "tag" && (!has("-l", "--list") || has("-a", "-d", "-f", "-s", "-m", "-u", "--delete", "--force")))
    return refuse("git tag is allowed only with --list");
  if (
    sub === "remote" &&
    !(rest.length === 0 || (rest.length === 1 && rest[0] === "-v") || (rest[0] === "get-url" && rest.length === 2))
  )
    return refuse("git remote is allowed only bare, with -v, or as get-url");
  if (
    sub === "config" &&
    !(
      has("--get", "--get-all", "--get-regexp", "--list", "-l") &&
      !has(
        "--add",
        "--unset",
        "--unset-all",
        "--replace-all",
        "--edit",
        "-e",
        "--rename-section",
        "--remove-section",
        "--file",
        "-f",
        "--global",
        "--system",
        "--worktree",
      )
    )
  )
    return refuse("git config is allowed only to read (--get, --get-all, --get-regexp, --list)");
  if (sub === "stash" && !(rest[0] === "list" || rest[0] === "show"))
    return refuse("git stash is allowed only as list or show");
  if (sub === "worktree" && rest[0] !== "list") return refuse("git worktree is allowed only as list");
  if (sub === "reflog" && !(rest.length === 0 || rest[0] === "show" || (rest[0] ?? "").startsWith("-")))
    return refuse("git reflog is allowed only to show");
  if (sub === "submodule" && !(rest[0] === "status" || rest[0] === "summary"))
    return refuse("git submodule is allowed only as status or summary");
  return { allowed: true };
}

function flag0(flags: string[], name: string): boolean {
  return flags.some((flag) => flag === name || flag.startsWith(`${name}=`));
}

function checkSed(args: string[]): ShellVerdict {
  const flags = flagsOf(args);
  if (!flags.includes("-n")) return refuse("sed is allowed only as `sed -n '<range>p' file` (a read-only print)");
  if (flags.some((flag) => flag !== "-n")) return refuse("sed flags other than -n can write files or run programs");
  const script = positional(args)[0] ?? "";
  if (!/^(\d+|\$)?(,(\d+|\$))?p$/u.test(script) && !/^\/[^/;\\]*\/p$/u.test(script))
    return refuse("sed is allowed only with a simple print script such as 10,20p or /pattern/p");
  return { allowed: true };
}

function checkFind(args: string[]): ShellVerdict {
  const banned = ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"];
  const hit = args.find((arg) => banned.includes(arg));
  return hit ? refuse(`find ${hit} can change files or run programs`) : { allowed: true };
}

function checkProgram(program: string, args: string[]): ShellVerdict {
  const flags = flagsOf(args);
  switch (program) {
    case "git":
      return checkGit(args);
    case "sed":
      return checkSed(args);
    case "find":
      return checkFind(args);
    case "sort":
      return flags.some(
        (flag) =>
          flag.startsWith("--output") ||
          flag.startsWith("--compress-program") ||
          (!flag.startsWith("--") && /^-[A-Za-z]*o/u.test(flag)),
      )
        ? refuse("sort -o / --output writes a file")
        : { allowed: true };
    case "uniq":
      return positional(args).length > 1 ? refuse("uniq with two file arguments writes the second") : { allowed: true };
    case "tree":
      return flags.some((flag) => flag === "-o" || flag.startsWith("--output") || flag === "--fromfile")
        ? refuse("tree -o writes a file")
        : { allowed: true };
    case "rg":
      return flags.some((flag) => flag.startsWith("--pre") || flag.startsWith("--hostname-bin"))
        ? refuse("rg --pre runs another program")
        : { allowed: true };
    case "date":
      return flags.some((flag) => flag === "-s" || flag.startsWith("--set"))
        ? refuse("date -s sets the clock")
        : { allowed: true };
    case "hostname":
      return args.length > 0 ? refuse("hostname with an argument sets the name") : { allowed: true };
    case "file":
      return flags.includes("-C") ? refuse("file -C writes a file") : { allowed: true };
    case "cd":
      return args.length > 1 ? refuse("cd takes one path") : { allowed: true };
    case "jq":
      return { allowed: true };
    default:
      return { allowed: true };
  }
}

function checkPowerShell(words: string[]): ShellVerdict {
  if (words.some((word) => /[{}]/u.test(word))) return refuse("script blocks are not allowed");
  return { allowed: true };
}

export function classifyReadOnlyShell(command: string): ShellVerdict {
  const text = command.trim();
  if (!text) return refuse("an empty command");
  if (text.length > MAX_COMMAND_LENGTH) return refuse("the command is too long to check");
  if (text.includes("\0")) return refuse("the command contains a NUL byte");
  const split_ = split(text);
  if ("error" in split_) return refuse(split_.error);
  if (split_.commands.length === 0) return refuse("an empty command");
  for (const simple of split_.commands) {
    const first = simple.words[0] as string;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(first))
      return refuse("assigning variables before a command is not allowed (it can change what the command does)");
    const program = programName(first);
    const args = simple.words.slice(1);
    if (POWERSHELL_PROGRAMS.has(program)) {
      const verdict = checkPowerShell(simple.words);
      if (!verdict.allowed) return verdict;
      continue;
    }
    if (!READ_PROGRAMS.has(program)) {
      return refuse(
        `\`${program}\` is not on the read-only list (it could write, run another program or reach the network)`,
      );
    }
    const verdict = checkProgram(program, args);
    if (!verdict.allowed) return verdict;
  }
  return { allowed: true };
}
