/**
 * What counts as "the agent verified its work": a shell command whose *program* exercises the real
 * code (tests, build, type-check, lint, a request against the app running on this machine), running a
 * file the turn changed, a rendered-output observation, or a delegated verification sub-agent that
 * itself ran such a check. Reading a file back, listing a directory, printing text or restating the
 * diff never counts — that is the model's own claim, not evidence.
 *
 * The decision is made on the program a command runs, never on words in its text: the audit of
 * 2026-09-23 reproduced `echo "all good, tsc passes"`, `curl https://example.com` and
 * `tsc --version` all passing an earlier word-matching version of this check.
 *
 * Shared by the turn loop's completion gate (`agent.ts`) and the benchmark harness
 * (`src/bench/agent-executor.ts`) so the product and its measurement never disagree about what
 * verification means. The list is deliberately broad across ecosystems: a missing runner here
 * silently turns every real check a project runs into "no evidence" (found live 2026-09-17 —
 * `bun test`, the runner of this very repository, was absent, so the gate looped a task through
 * 50 model steps and 1.6M tokens while the agent kept running its tests).
 */

/** Package scripts and make/just targets whose name says they check the code. */
const CHECK_SCRIPT_RE =
  /^(?:test|tests|spec|specs|check|checks|lint|typecheck|type-check|types|tsc|build|verify|validate|e2e|coverage|ci)(?:[:._-].*)?$/i;

/** Programs that are checks whatever their arguments (unless only asked for a version or help). */
const CHECK_PROGRAMS = new Set([
  "vitest",
  "jest",
  "mocha",
  "ava",
  "tap",
  "uvu",
  "playwright",
  "cypress",
  "karma",
  "pytest",
  "py.test",
  "rspec",
  "phpunit",
  "ctest",
  "tsc",
  "vue-tsc",
  "eslint",
  "mypy",
  "pyright",
  "shellcheck",
  "unittest",
  "nextest",
]);

/** Programs that are checks only with one of these subcommands or flags. */
const CHECK_SUBCOMMANDS: Record<string, readonly string[]> = {
  bun: ["test"],
  deno: ["test", "check", "lint"],
  go: ["test", "vet", "build"],
  cargo: ["test", "build", "check", "clippy", "run", "nextest"],
  dotnet: ["test", "build"],
  mvn: ["test", "verify", "package"],
  gradle: ["test", "build", "check"],
  gradlew: ["test", "build", "check"],
  mix: ["test"],
  swift: ["test", "build"],
  flutter: ["test", "analyze"],
  biome: ["check", "lint", "ci"],
  ruff: ["check"],
  node: ["--test"],
};

/** Formatters that are checks only when asked to check, not to rewrite. */
const CHECK_FLAGS: Record<string, readonly string[]> = {
  black: ["--check"],
  prettier: ["--check", "-c"],
  rustfmt: ["--check"],
  gofmt: ["-l", "-d"],
  ruff: ["--check"],
};

/** Package managers whose `run <script>` (or bare `<script>`) runs a package script. */
const SCRIPT_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);
/** Task runners whose target names follow the same convention as package scripts. */
const TARGET_RUNNERS = new Set(["make", "just", "task"]);
/** Runners that execute the program named after them. */
const EXEC_WRAPPERS: Record<string, readonly string[]> = {
  npx: [],
  bunx: [],
  pnpx: [],
  bun: ["x"],
  npm: ["exec"],
  pnpm: ["exec", "dlx"],
  yarn: ["exec", "dlx"],
  uv: ["run"],
  poetry: ["run"],
  pipenv: ["run"],
};
/** HTTP clients: a request counts only against a server running on this machine. */
const HTTP_CLIENTS = new Set([
  "curl",
  "wget",
  "invoke-webrequest",
  "iwr",
  "invoke-restmethod",
  "irm",
  "http",
  "https",
  "xh",
]);
const LOCAL_URL_RE =
  /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[\w.-]+\.localhost)(?::\d+)?(?:[/?#]|$)/i;
/** A command that only asks for a version or help runs nothing. */
const VERSION_OR_HELP = new Set(["--version", "-v", "-V", "version", "--help", "-h", "help", "-?", "/?"]);

/** Files a command can run, directly or through an interpreter. */
const RUNNABLE_FILE = /\.(?:ps1|psm1|bat|cmd|sh|bash|zsh|js|mjs|cjs|ts|mts|cts|py|rb|pl|php|lua)$/i;
/** Programs that run the file named after them (`node x.js`, `powershell -File x.ps1`). */
const INTERPRETER =
  /^(?:powershell|pwsh|cmd|bash|sh|zsh|node|bun|deno|tsx|ts-node|python3?|py|uv|ruby|perl|php|lua)(?:\.exe)?$/i;
/** Tokens right before a file that mean "run it": the call operator, dot-sourcing, `-File`, `run`. */
const RUN_MARKER = /^(?:&|\.|-file|-f|\/c|run)$/i;

/**
 * The part of a command whose exit status is the whole command's: its last `&&` chain. After a
 * pipe, `;`, `||` or a line break, the status is what runs next, so a check there proves nothing
 * (seen live 2026-09-23: a type-check that failed in a clone without dependencies counted as
 * passing, because `bun run typecheck 2>&1 | head -50` exited with `head`'s 0).
 */
function decidingChain(command: string): string {
  let start = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "`") {
      index += 1;
    } else if (char === "&" && command[index + 1] === "&") {
      index += 1;
    } else if (char === "|" || char === ";" || char === "\n") {
      if (char === "|" && command[index + 1] === "|") index += 1;
      start = index + 1;
    }
  }
  return command.slice(start);
}

/** A command line's simple commands as token lists: split on top-level `&&`, `||`, `|`, `;` and line breaks. */
export function splitShellCommands(command: string): string[][] {
  return simpleCommands(command);
}

/** The simple commands of a chain: split on top-level `&&`, `||`, `|`, `;` and line breaks. */
function simpleCommands(chain: string): string[][] {
  const commands: string[][] = [];
  let tokens: string[] = [];
  let token = "";
  let quoted = false;
  let quote: "'" | '"' | null = null;
  const endToken = () => {
    if (token || quoted) tokens.push(token);
    token = "";
    quoted = false;
  };
  const endCommand = () => {
    endToken();
    if (tokens.length > 0) commands.push(tokens);
    tokens = [];
  };
  for (let index = 0; index < chain.length; index += 1) {
    const char = chain[index] as string;
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      quoted = true;
    } else if (char === "`" && index + 1 < chain.length) {
      token += chain[index + 1];
      index += 1;
    } else if (char === "&" && chain[index + 1] === "&") {
      endCommand();
      index += 1;
    } else if (char === "|" || char === ";" || char === "\n") {
      endCommand();
      if (char === "|" && chain[index + 1] === "|") index += 1;
    } else if (/\s/u.test(char)) {
      endToken();
    } else if (char === "#" && token === "") {
      // A comment runs to the end of the line.
      while (index + 1 < chain.length && chain[index + 1] !== "\n") index += 1;
    } else {
      token += char;
    }
  }
  endCommand();
  return commands;
}

function programName(token: string): string {
  return (token.replace(/\\/g, "/").split("/").pop() ?? token).toLowerCase().replace(/\.(?:exe|cmd|bat)$/u, "");
}

/** Tokens after the program with redirections and a leading call operator removed. */
function cleanArguments(tokens: readonly string[]): string[] {
  return tokens.filter((token) => !/^\d?>>?/u.test(token) && !/^\d?>&\d$/u.test(token) && !/^</u.test(token));
}

/** Drops environment assignments (`CI=1 bun test`) and PowerShell's call operator. */
function stripPrefix(tokens: readonly string[]): string[] {
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index] as string)) index += 1;
  if (tokens[index] === "&") index += 1;
  return tokens.slice(index);
}

/** The program and arguments a wrapper (`npx`, `bun x`, `python -m`, `uv run`) actually runs. */
function unwrap(tokens: readonly string[]): string[] {
  let current = [...tokens];
  for (let depth = 0; depth < 3; depth += 1) {
    const program = programName(current[0] ?? "");
    const rest = current.slice(1);
    const subcommands = EXEC_WRAPPERS[program];
    if (subcommands) {
      const withSub = subcommands.length === 0 ? rest : subcommands.includes(rest[0] ?? "") ? rest.slice(1) : null;
      if (withSub) {
        const next = withSub.findIndex((token) => !token.startsWith("-"));
        if (next >= 0) {
          current = withSub.slice(next);
          continue;
        }
      }
    }
    if (/^(?:python3?|py)$/u.test(program)) {
      const module = rest.indexOf("-m");
      if (module >= 0 && rest[module + 1]) {
        current = rest.slice(module + 1);
        continue;
      }
    }
    break;
  }
  return current;
}

function onlyVersionOrHelp(args: readonly string[]): boolean {
  return args.length > 0 && args.every((arg) => VERSION_OR_HELP.has(arg));
}

/** Whether one simple command runs a check, and a short label for it. */
function checkOf(rawTokens: readonly string[]): boolean {
  const tokens = unwrap(stripPrefix(cleanArguments(rawTokens)));
  const program = programName(tokens[0] ?? "");
  const args = tokens.slice(1);
  if (!program || onlyVersionOrHelp(args)) return false;
  if (HTTP_CLIENTS.has(program)) return args.some((arg) => LOCAL_URL_RE.test(arg));
  if (CHECK_PROGRAMS.has(program)) return true;
  const flags = CHECK_FLAGS[program];
  if (flags && args.some((arg) => flags.includes(arg))) return true;
  const subcommands = CHECK_SUBCOMMANDS[program];
  if (subcommands?.includes(args[0] ?? "")) return true;
  if (SCRIPT_RUNNERS.has(program)) {
    const script = args[0] === "run" || args[0] === "run-script" ? args[1] : args[0];
    if (script === "t") return true;
    if (script && CHECK_SCRIPT_RE.test(script)) return true;
  }
  if (TARGET_RUNNERS.has(program)) return args.some((arg) => !arg.startsWith("-") && CHECK_SCRIPT_RE.test(arg));
  return false;
}

/** True when some simple command in `command` runs a check (tests, build, type-check, lint, a local request). */
export function isVerificationCommand(command: string): boolean {
  return simpleCommands(command).some(checkOf);
}

function bashCommand(argsJson: string): string | null {
  try {
    return (JSON.parse(argsJson) as { command?: string }).command ?? "";
  } catch {
    return null;
  }
}

/** A bash command that ran a check whose exit status a later command replaced, or `null`. */
export function maskedVerificationCommand(toolName: string, argsJson: string): string | null {
  if (toolName !== "bash") return null;
  const command = bashCommand(argsJson);
  if (!command || !isVerificationCommand(command)) return null;
  return isVerificationCommand(decidingChain(command)) ? null : command;
}

function baseName(token: string): string {
  return (token.replace(/\\/g, "/").split("/").pop() ?? token).toLowerCase();
}

/**
 * Whether `command` executes one of the files changed this turn. Running a script the agent just
 * wrote is the real check for that script: a diagnostic helper written outside any project has no
 * test suite, so without this the gate asked three times for "the project's real checks" while the
 * model kept running the script (seen live 2026-09-22). Reading the file back (`Get-Content x.ps1`,
 * `cat x.sh`) is still not evidence.
 */
function runsChangedFile(command: string, changedFiles: readonly string[]): string | null {
  const runnable = new Set(changedFiles.filter((file) => RUNNABLE_FILE.test(file)).map(baseName));
  if (runnable.size === 0) return null;
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const tokens = (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) => token.replace(/^["']|["']$/g, ""));
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index] as string;
      const name = baseName(token);
      if (!runnable.has(name)) continue;
      if (index === 0 || /^\.[\\/]/.test(token)) return name;
      if (RUN_MARKER.test(tokens[index - 1] as string)) return name;
      // `node --inspect x.js`, `python -u x.py`: skip the interpreter's own flags.
      let previous = index - 1;
      while (previous > 0 && (tokens[previous] as string).startsWith("-")) previous -= 1;
      if (INTERPRETER.test(baseName(tokens[previous] as string))) return name;
    }
  }
  return null;
}

/**
 * Human-readable evidence line for a verification-shaped tool call, or `null` when it is not one.
 * `changedFiles` are the files the turn changed; running one of them counts as checking it. A `task`
 * call counts only through its result (see `describeDelegatedEvidence`), never by its name alone.
 */
export function describeVerificationEvidence(
  toolName: string,
  argsJson: string,
  changedFiles: readonly string[] = [],
): string | null {
  if (toolName === "bash") {
    const command = bashCommand(argsJson);
    if (!command) return null;
    const deciding = decidingChain(command);
    if (isVerificationCommand(deciding)) return `bash: ${command.slice(0, 120)}`;
    const ran = runsChangedFile(deciding, changedFiles);
    return ran ? `bash: ran the changed file ${ran}` : null;
  }
  if (toolName === "computer_screenshot" || toolName === "computer_snapshot") {
    return `${toolName}: observed rendered output`;
  }
  return null;
}

/**
 * Evidence from a delegated sub-agent: it counts only when the sub-agent itself ran a check. A
 * `verify` sub-agent that finished without running anything (on Windows every one of its commands
 * failed because its sandbox needs macOS) used to count as "delegated verification completed".
 */
export function describeDelegatedEvidence(agent: string, childEvidence: readonly string[] | undefined): string | null {
  if (!childEvidence || childEvidence.length === 0) return null;
  return `task(${agent}): ${childEvidence.length} check(s) run by the sub-agent, first: ${childEvidence[0]}`;
}
