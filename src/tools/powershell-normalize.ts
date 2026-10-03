import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { translateChains } from "../exec/shell";

/**
 * sh and cmd syntax, rewritten for Windows PowerShell before the bash tool runs a command there.
 *
 * On Windows the bash tool runs Windows PowerShell 5.1, and its description says so, but free models still write
 * other shells' syntax. Of 304 `bash` calls in free-model runs on 2026-10-03, 15 failed only for that: inline
 * `bun -e "…"` scripts whose inner double quotes PowerShell 5.1 strips when it hands an argument to a program, cmd's
 * `del /s` and `rmdir /s`, `&&`, `ls -la`, `2>/dev/null`. Each rewrite here covers a shape PowerShell cannot run as
 * written; anything else, and anything this module cannot read with certainty, runs as it was. What changed comes
 * back in `changes` for the tool result, so the model sees the PowerShell form.
 *
 * Pure: it writes nothing. An inline script comes back in `files`, for the caller to write before it runs `command`.
 */

export interface ScriptFile {
  /** Where the caller writes it, as UTF-8, before running the command. */
  path: string;
  content: string;
}

export interface PowerShellNormalization {
  /** The command to run: the input itself when nothing changed. */
  command: string;
  /** What changed, one short phrase each, for the tool result; empty when nothing changed. */
  changes: string[];
  /** Inline scripts the command now reads from a file. */
  files: ScriptFile[];
}

export interface PowerShellNormalizeOptions {
  /** Defaults to the host's; on anything but win32 every command is left as it is. */
  platform?: NodeJS.Platform;
  /** The folder inline scripts are written to; defaults to `shelra-scripts` in the OS temp folder. */
  scriptDir?: string;
}

function unchanged(command: string): PowerShellNormalization {
  return { command, changes: [], files: [] };
}

export function normalizeForPowerShell(
  command: string,
  options: PowerShellNormalizeOptions = {},
): PowerShellNormalization {
  if ((options.platform ?? process.platform) !== "win32") return unchanged(command);
  try {
    return normalize(command, options.scriptDir ?? path.join(os.tmpdir(), "shelra-scripts"));
  } catch {
    // A command this module cannot read runs as written.
    return unchanged(command);
  }
}

/** The line the tool result carries, or null when nothing changed. */
export function normalizationNote(result: PowerShellNormalization): string | null {
  if (result.changes.length === 0) return null;
  return `Shelra ran this as Windows PowerShell: ${result.changes.join("; ")}.`;
}

/** A here-string (`@"` or `@'` at the end of a line) is PowerShell's own: such a command is left alone. */
const HERE_STRING = /@["'][ \t]*\r?\n/u;

function normalize(command: string, scriptDir: string): PowerShellNormalization {
  if (HERE_STRING.test(command)) return unchanged(command);
  const changes: string[] = [];
  const files: ScriptFile[] = [];
  const withScripts = extractInlineScripts(command, scriptDir, changes, files);
  if (withScripts === null) return unchanged(command);
  const rewritten = rewriteStatements(withScripts, changes);
  if (rewritten === null) return unchanged(command);
  let result = rewritten.command;
  if (rewritten.and || rewritten.or) {
    const translated = translateChains(result);
    // A chain mixing && and || has no faithful rewrite here: the command runs as written, and the shell's parse
    // hint names the fix (`powerShellParseHint`).
    if (translated === result) return unchanged(command);
    result = translated;
    if (rewritten.and) changes.push("`&&` became `; if ($?) { … }`");
    if (rewritten.or) changes.push("`||` became `; if (-not $?) { … }`");
  }
  if (result === command) return unchanged(command);
  return { command: result, changes: [...new Set(changes)], files };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading PowerShell: strings, statements, words.

/** PowerShell also reads typographic quotes as quotes. */
const DOUBLE_QUOTES = '"\u201C\u201D\u201E';
const SINGLE_QUOTES = "'\u2018\u2019\u201A\u201B";

function isQuote(char: string): boolean {
  return DOUBLE_QUOTES.includes(char) || SINGLE_QUOTES.includes(char);
}

/**
 * Where the PowerShell string that opens at `at` ends (the index after its closing quote), or -1 when it does not end
 * or holds a subexpression `$(…)`, which may hold quotes of its own.
 */
function endOfString(text: string, at: number): number {
  const double = DOUBLE_QUOTES.includes(text[at] as string);
  const quotes = double ? DOUBLE_QUOTES : SINGLE_QUOTES;
  for (let index = at + 1; index < text.length; index += 1) {
    const char = text[index] as string;
    if (double && char === "`") {
      index += 1;
      continue;
    }
    if (double && char === "$" && text[index + 1] === "(") return -1;
    if (quotes.includes(char)) {
      // A doubled quote stands for one quote.
      const next = text[index + 1];
      if (next !== undefined && quotes.includes(next)) {
        index += 1;
        continue;
      }
      return index + 1;
    }
  }
  return -1;
}

interface Statement {
  start: number;
  end: number;
  /** The separator before it ("" for the first) and after it ("" for the last). */
  before: string;
  after: string;
}

/** Called where a command starts (after a separator, `{` or `(`): where to resume scanning, ABORT, or null. */
type CommandStartHook = (at: number, before: string) => number | null;
const ABORT = -1;

function separatorAt(text: string, index: number): string | null {
  const pair = text.slice(index, index + 2);
  if (pair === "&&" || pair === "||" || pair === "\r\n") return pair;
  const char = text[index] as string;
  return char === "|" || char === ";" || char === "\n" ? char : null;
}

/**
 * The top-level statements of a command line, split on `&&`, `||`, `|`, `;` and line breaks outside strings, blocks
 * and parentheses. Null when a string does not end, the brackets do not balance, or the hook aborts.
 */
function scanStatements(command: string, hook?: CommandStartHook): Statement[] | null {
  const statements: Statement[] = [];
  let depth = 0;
  let start = 0;
  let before = "";
  // The separator that opened the command not reached yet; null once inside a command.
  let opener: string | null = "";
  let index = 0;
  while (index < command.length) {
    const char = command[index] as string;
    if (opener !== null && char !== " " && char !== "\t") {
      const openedBy = opener;
      opener = null;
      const resume = hook ? hook(index, openedBy) : null;
      if (resume === ABORT) return null;
      if (resume !== null) {
        index = resume;
        continue;
      }
    }
    if (isQuote(char)) {
      const end = endOfString(command, index);
      if (end < 0) return null;
      index = end;
      continue;
    }
    if (char === "`") {
      index += 2;
      continue;
    }
    if (char === "#" && (index === 0 || /[\s;|&({]/u.test(command[index - 1] as string))) {
      while (index < command.length && command[index] !== "\n") index += 1;
      continue;
    }
    if (char === "(" || char === "{") {
      depth += 1;
      opener = char;
      index += 1;
      continue;
    }
    if (char === ")" || char === "}") {
      depth -= 1;
      if (depth < 0) return null;
      index += 1;
      continue;
    }
    const separator = separatorAt(command, index);
    if (separator) {
      if (depth === 0) {
        statements.push({ start, end: index, before, after: separator });
        start = index + separator.length;
        before = separator;
      }
      opener = separator;
      index += separator.length;
      continue;
    }
    index += 1;
  }
  if (depth !== 0) return null;
  statements.push({ start, end: command.length, before, after: "" });
  return statements;
}

interface Word {
  text: string;
  start: number;
}

/** A simple command's words, strings kept whole; null when a string does not end. */
function splitWords(text: string): Word[] | null {
  const words: Word[] = [];
  let index = 0;
  while (index < text.length) {
    if (/\s/u.test(text[index] as string)) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < text.length && !/\s/u.test(text[index] as string)) {
      const char = text[index] as string;
      if (isQuote(char)) {
        const end = endOfString(text, index);
        if (end < 0) return null;
        index = end;
      } else index += char === "`" ? 2 : 1;
    }
    words.push({ text: text.slice(start, index), start });
  }
  return words;
}

// ---------------------------------------------------------------------------------------------------------------
// Inline scripts: `bun -e "…"`, `node -e '…'`, `python -c "…"`.

type Program = "bun" | "node" | "python";

interface InlineScript {
  start: number;
  end: number;
  /** The program as written (`node`, `python3`, `bun.exe`), its options before the script, and the script flag. */
  runner: string;
  program: Program;
  options: string;
  flag: string;
  content: string;
}

const RUNNER = /^(bun|node|python3?|py)(?:\.exe)?(?=[ \t])/iu;
const SCRIPT_FLAG = /^((?:[ \t]+-[^\s'"`;|&]*)*?)[ \t]+(-e|--eval|-c)[ \t]+(?=["'])/u;
const EXTENSIONS: Record<Program, string> = { bun: ".ts", node: ".js", python: ".py" };

/** What the script argument at `at` holds when it must move to a file; null when it runs as written; or abort. */
type ScriptArgument = { end: number; content: string } | null | "abort";

/**
 * `'…'`: literal text, `''` standing for `'`. Windows PowerShell 5.1 hands a program the text with its double quotes
 * stripped (and ends the string early at a typographic single quote), so such a script moves to a file. A `\"` in it
 * was written for that quirk, which turns `\"` back into `"`: it already runs.
 */
function singleQuotedScript(command: string, at: number): ScriptArgument {
  let content = "";
  let typographic = false;
  for (let index = at + 1; index < command.length; index += 1) {
    const char = command[index] as string;
    if (char === "'") {
      if (command[index + 1] === "'") {
        content += "'";
        index += 1;
        continue;
      }
      if (content.includes('\\"')) return typographic ? "abort" : null;
      if (!content.includes('"') && !typographic) return null;
      return { end: index + 1, content };
    }
    if ("\u2018\u2019\u201A\u201B".includes(char)) typographic = true;
    content += char;
  }
  return null;
}

/** `$name`, `${…}`, `$(…)`, `$1`: text both sh and PowerShell would expand inside double quotes. */
const EXPANSION = /[A-Za-z_{(\d?^$:]/u;

/** A double-quoted argument read as sh reads it: `\"`, `\\`, `\$` and `` \` `` are escapes. */
function shDoubleQuoted(command: string, at: number) {
  let content = "";
  let escapedQuote = false;
  let otherEscape = false;
  let backtick = false;
  let expansion = false;
  let typographic = false;
  for (let index = at + 1; index < command.length; index += 1) {
    const char = command[index] as string;
    const next = command[index + 1] ?? "";
    if (char === "\\" && next !== "" && '"\\$`\n'.includes(next)) {
      if (next === '"') escapedQuote = true;
      else otherEscape = true;
      if (next !== "\n") content += next;
      index += 1;
      continue;
    }
    if (char === '"') return { end: index + 1, content, escapedQuote, otherEscape, backtick, expansion, typographic };
    if (char === "`") backtick = true;
    if (char === "$" && EXPANSION.test(next)) expansion = true;
    if ("\u201C\u201D\u201E".includes(char)) typographic = true;
    content += char;
  }
  return null;
}

const POWERSHELL_ESCAPES: Record<string, string> = {
  "0": "\0",
  a: "\u0007",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "`": "`",
  '"': '"',
  "'": "'",
  $: "$",
};

/** A double-quoted argument read as PowerShell reads it: `` `x `` escapes, `""` stands for `"`. */
function powerShellDoubleQuoted(command: string, at: number) {
  let content = "";
  let escapedQuote = false;
  let unknownEscape = false;
  let expansion = false;
  for (let index = at + 1; index < command.length; index += 1) {
    const char = command[index] as string;
    const next = command[index + 1] ?? "";
    if (char === "`" && next !== "") {
      const escaped = POWERSHELL_ESCAPES[next];
      if (next === '"') escapedQuote = true;
      if (escaped === undefined) unknownEscape = true;
      content += escaped ?? next;
      index += 1;
      continue;
    }
    if (char === '"') {
      if (next === '"') {
        escapedQuote = true;
        content += '"';
        index += 1;
        continue;
      }
      return { end: index + 1, content, escapedQuote, unknownEscape, expansion };
    }
    if (char === "$" && EXPANSION.test(next)) expansion = true;
    content += char;
  }
  return null;
}

/**
 * `"…"` with double quotes inside, written either for sh (`\"`) or for PowerShell (`""`, `` `" ``). Either way
 * PowerShell 5.1 strips the inner quotes when it hands the text to the program. A script that expands a variable or
 * holds a backtick is left alone: which text the model meant depends on the shell it had in mind.
 */
function doubleQuotedScript(command: string, at: number): ScriptArgument {
  const sh = shDoubleQuoted(command, at);
  if (!sh) return null;
  if (sh.escapedQuote || sh.typographic) {
    // PowerShell would end this string elsewhere: it is moved to a file, or the whole command is left alone.
    if (sh.backtick || sh.expansion || (!sh.escapedQuote && sh.otherEscape)) return "abort";
    return { end: sh.end, content: sh.content };
  }
  const powershell = powerShellDoubleQuoted(command, at);
  if (!powershell?.escapedQuote || powershell.expansion || powershell.unknownEscape) return null;
  return { end: powershell.end, content: powershell.content };
}

function inlineScriptAt(command: string, at: number): InlineScript | null | "abort" {
  const rest = command.slice(at);
  const runner = RUNNER.exec(rest);
  if (!runner) return null;
  const name = (runner[1] as string).toLowerCase();
  const program: Program = name === "bun" ? "bun" : name === "node" ? "node" : "python";
  const flag = SCRIPT_FLAG.exec(rest.slice(runner[0].length));
  if (!flag) return null;
  if ((program === "python") !== (flag[2] === "-c")) return null;
  const quoteAt = at + runner[0].length + flag[0].length;
  const argument =
    command[quoteAt] === "'" ? singleQuotedScript(command, quoteAt) : doubleQuotedScript(command, quoteAt);
  if (argument === null || argument === "abort") return argument;
  return {
    start: at,
    end: argument.end,
    runner: runner[0],
    program,
    options: flag[1] as string,
    flag: flag[2] as string,
    content: argument.content,
  };
}

function quoteLiteral(value: string): string {
  let quoted = "'";
  for (const char of value) quoted += SINGLE_QUOTES.includes(char) ? `${char}${char}` : char;
  return `${quoted}'`;
}

function scriptPath(dir: string, name: string): string {
  const separator = dir.includes("\\") || !dir.includes("/") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/u, "")}${separator}${name}`;
}

/**
 * The script goes to a UTF-8 file and reaches the program on stdin (`node -`, `bun run -`, `python -`), which keeps
 * what the inline form had and a file argument would lose: imports resolve from the working folder (a `bun <file>`
 * in the temp folder cannot find `./src/…`). PowerShell 5.1 pipes text to a program as ASCII unless
 * `$OutputEncoding` says otherwise.
 */
function runFromFile(script: InlineScript, scriptDir: string): { text: string; file: ScriptFile; change: string } {
  const digest = createHash("sha256").update(script.content).digest("hex").slice(0, 16);
  const file = scriptPath(scriptDir, `${digest}${EXTENSIONS[script.program]}`);
  const run =
    script.program === "bun" ? `${script.runner} run${script.options} -` : `${script.runner}${script.options} -`;
  return {
    text: `$OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-Content -LiteralPath ${quoteLiteral(file)} -Raw -Encoding UTF8 | ${run}`,
    file: { path: file, content: script.content },
    change: `the \`${script.runner} ${script.flag}\` script was saved as UTF-8 to ${file} and piped to \`${run}\` (Windows PowerShell 5.1 strips the double quotes inside a program's argument)`,
  };
}

/** The command with each inline script that needs it moved to a file; null to leave the command as it is. */
function extractInlineScripts(
  command: string,
  scriptDir: string,
  changes: string[],
  files: ScriptFile[],
): string | null {
  const rewrites: Array<{ start: number; end: number; text: string }> = [];
  const statements = scanStatements(command, (at, before) => {
    const script = inlineScriptAt(command, at);
    if (script === null) return null;
    // Piped input is the script's stdin, which the rewrite needs for the script itself.
    if (script === "abort" || before === "|") return ABORT;
    const moved = runFromFile(script, scriptDir);
    rewrites.push({ start: script.start, end: script.end, text: moved.text });
    files.push(moved.file);
    changes.push(moved.change);
    return script.end;
  });
  if (statements === null) return null;
  let result = command;
  for (const rewrite of rewrites.reverse()) {
    result = `${result.slice(0, rewrite.start)}${rewrite.text}${result.slice(rewrite.end)}`;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Simple commands.

function rewriteStatements(command: string, changes: string[]): { command: string; and: boolean; or: boolean } | null {
  const statements = scanStatements(command);
  if (statements === null) return null;
  let result = "";
  let and = false;
  let or = false;
  for (const statement of statements) {
    const text = command.slice(statement.start, statement.end);
    const lead = /^\s*/u.exec(text)?.[0] ?? "";
    const core = text.slice(lead.length).trimEnd();
    const trail = text.slice(lead.length + core.length);
    const rewritten = core ? rewriteCommand(core, statement, changes) : core;
    result += `${lead}${rewritten}${trail}${statement.after}`;
    if (statement.after === "&&") and = true;
    if (statement.after === "||") or = true;
  }
  return { command: result, and, or };
}

function clip(text: string, max = 60): string {
  const line = text.replace(/\s+/gu, " ");
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

function rewriteCommand(core: string, statement: Statement, changes: string[]): string {
  const redirected = rewriteDevNull(core, changes);
  // An assignment cannot take part in a pipeline, so environment rewrites need a statement of their own.
  const standalone = statement.before !== "|" && statement.after !== "|";
  const rewritten = rewriteWords(redirected, standalone);
  if (rewritten === null || rewritten === redirected) return redirected;
  changes.push(`\`${clip(redirected)}\` became \`${clip(rewritten)}\``);
  return rewritten;
}

/** `>/dev/null`, `2>/dev/null`, `&>/dev/null` outside strings. */
const DEV_NULL = /(?:(&)|(\d|\*))?>>?[ \t]*\/dev\/null(?![\w/.-])/uy;

function rewriteDevNull(core: string, changes: string[]): string {
  if (!core.includes("/dev/null")) return core;
  let out = "";
  let index = 0;
  while (index < core.length) {
    const char = core[index] as string;
    if (isQuote(char)) {
      const end = endOfString(core, index);
      if (end < 0) return core;
      out += core.slice(index, end);
      index = end;
      continue;
    }
    if (char === "`") {
      out += core.slice(index, index + 2);
      index += 2;
      continue;
    }
    const startsWord = index === 0 || /\s/u.test(core[index - 1] as string);
    if (char === ">" || (/[&\d*]/u.test(char) && startsWord)) {
      DEV_NULL.lastIndex = index;
      const match = DEV_NULL.exec(core);
      if (match) {
        const replacement = `${match[1] ? "*" : (match[2] ?? "")}>$null`;
        changes.push(`\`${match[0]}\` became \`${replacement}\``);
        out += replacement;
        index += match[0].length;
        continue;
      }
    }
    out += char;
    index += 1;
  }
  return out;
}

const REDIRECTION = /^(?:\d|\*)?>/u;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/su;

/** A value sh would read as literal text, unquoted; null when it expands something or its quoting is unclear. */
function literalValue(raw: string): string | null {
  if (/^'[^']*'$/u.test(raw)) return raw.slice(1, -1);
  if (/^"[^"`$\\]*"$/u.test(raw)) return raw.slice(1, -1);
  if (/^[^'"`$\s\u2018-\u201E]*$/u.test(raw)) return raw;
  return null;
}

function powerShellString(value: string): string {
  return /["`$\u201C-\u201E]/u.test(value) ? quoteLiteral(value) : `"${value}"`;
}

function environmentAssignment(word: string): string | null {
  const match = ASSIGNMENT.exec(word);
  if (!match) return null;
  const value = literalValue(match[2] as string);
  return value === null ? null : `$env:${match[1]} = ${powerShellString(value)}`;
}

/** The rewritten command, or null when it is not a shape this module rewrites. */
function rewriteWords(core: string, standalone: boolean): string | null {
  const words = splitWords(core);
  if (!words || words.length === 0) return null;
  // Redirections at the end stay where they are; one in the middle of the arguments leaves the command alone.
  let cut = words.length;
  while (cut > 0) {
    const word = (words[cut - 1] as Word).text;
    const operator = words[cut - 2]?.text ?? "";
    if (REDIRECTION.test(word)) cut -= 1;
    else if (/^(?:\d|\*)?>>?$/u.test(operator)) cut -= 2;
    else break;
  }
  const args = words.slice(0, Math.max(cut, 0));
  if (args.length === 0 || args.some((word) => REDIRECTION.test(word.text))) return null;
  const redirections = cut < words.length ? ` ${core.slice((words[cut] as Word).start)}` : "";
  const name = (args[0] as Word).text.toLowerCase();
  const rest = args.slice(1);

  // `NODE_ENV=test bun test`: the variable for this command only, in sh; here, for the rest of the command line.
  let assignments = 0;
  while (assignments < args.length && ASSIGNMENT.test((args[assignments] as Word).text)) assignments += 1;
  if (assignments > 0) {
    if (!standalone || assignments === args.length) return null;
    const set = args.slice(0, assignments).map((word) => environmentAssignment(word.text));
    if (set.some((line) => line === null)) return null;
    const command = core.slice((args[assignments] as Word).start);
    return `${set.join("; ")}; ${rewriteWords(command, standalone) ?? command}`;
  }

  if (name === "export") {
    if (!standalone || rest.length === 0 || redirections) return null;
    const set = rest.map((word) => environmentAssignment(word.text));
    return set.some((line) => line === null) ? null : set.join("; ");
  }

  const flags = rest.filter((word) => word.text.startsWith("-")).map((word) => word.text);
  const operands = rest.filter((word) => !word.text.startsWith("-")).map((word) => word.text);

  if (name === "ls") {
    if (flags.length === 0 || operands.length > 1 || !flags.every((flag) => /^-[lahA]+$/u.test(flag))) return null;
    const all = flags.some((flag) => /a/iu.test(flag));
    // `ls -h` is -Hidden and `ls -l <dir>` is -LiteralPath in PowerShell: both already run.
    if (!all && flags.every((flag) => flag === "-h" || (flag === "-l" && operands.length === 1))) return null;
    return `Get-ChildItem${all ? " -Force" : ""}${operands[0] ? ` ${operands[0]}` : ""}${redirections}`;
  }

  if (name === "rm") {
    if (flags.length === 0 || operands.length === 0) return null;
    if (!flags.every((flag) => /^-[rRf]+$/u.test(flag) || flag === "--recursive" || flag === "--force")) return null;
    // `rm -r <path>` is Remove-Item -Recurse in PowerShell: it already runs.
    if (flags.every((flag) => /^-r$/iu.test(flag))) return null;
    if (operands.some((operand) => /^[{(@$]/u.test(operand))) return null;
    const short = flags.filter((flag) => !flag.startsWith("--")).join("");
    const recurse = /r/iu.test(short) || flags.includes("--recursive");
    const force = short.includes("f") || flags.includes("--force");
    return `Remove-Item${recurse ? " -Recurse" : ""}${force ? " -Force" : ""} ${operands.join(", ")}${redirections}`;
  }

  if (["del", "erase", "rd", "rmdir"].includes(name)) {
    // cmd's switches; in PowerShell these names are Remove-Item, which reads `/s` as a path.
    const switches = rest.filter((word) => /^\/[A-Za-z]$/u.test(word.text)).map((word) => word.text.toLowerCase());
    const paths = rest.filter((word) => !/^\/[A-Za-z]$/u.test(word.text)).map((word) => word.text);
    if (switches.length === 0 || paths.length === 0) return null;
    if (!switches.every((flag) => flag === "/s" || flag === "/q" || flag === "/f")) return null;
    if (paths.some((target) => /^[-/{(@$]/u.test(target))) return null;
    const recurse = switches.includes("/s");
    // `del /s *.log` deletes matching files in every subfolder, which Remove-Item -Recurse does not do faithfully.
    if (recurse && (name === "del" || name === "erase") && paths.some((target) => /[*?]/u.test(target))) return null;
    const force = switches.includes("/q") || switches.includes("/f");
    return `Remove-Item${recurse ? " -Recurse" : ""}${force ? " -Force" : ""} ${paths.join(", ")}${redirections}`;
  }

  if (name === "which" && rest.length === 1 && flags.length === 0) {
    return `(Get-Command ${operands[0]}).Source${redirections}`;
  }

  return null;
}
