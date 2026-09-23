/**
 * What counts as "the agent verified its work": a shell command that exercises the real
 * program (tests, build, type-check, lint, a real request), a rendered-output observation, or
 * a delegated verification sub-agent. Reading a file back, listing a directory, or restating
 * the diff never counts — that is the model's own claim, not evidence.
 *
 * Shared by the turn loop's completion gate (`agent.ts`) and the benchmark harness
 * (`src/bench/agent-executor.ts`) so the product and its measurement never disagree about what
 * verification means. The list is deliberately broad across ecosystems: a missing runner here
 * silently turns every real check a project runs into "no evidence" (found live 2026-09-17 —
 * `bun test`, the runner of this very repository, was absent, so the gate looped a task through
 * 50 model steps and 1.6M tokens while the agent kept running its tests).
 */
export const VERIFICATION_COMMAND_RE =
  /(?:^|[\s;&|(])(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|http|xh|pytest|py\.test|jest|vitest|mocha|ava|tap|uvu|playwright|cypress|karma|bun\s+(?:test|run\s+(?:test|build|check|lint|typecheck|verify|e2e|coverage)[\w:-]*)|bunx\s+(?:vitest|jest|tsc|playwright|biome|eslint)|npm\s+(?:test|run\s+(?:test|build|check|lint|typecheck|verify|e2e|coverage)[\w:-]*)|npx\s+(?:vitest|jest|tsc|playwright|mocha|biome|eslint)|yarn\s+(?:test|build|lint|typecheck|check|verify|e2e)|pnpm\s+(?:test|build|lint|typecheck|check|verify|e2e|run\s+\S+)|deno\s+(?:test|check|lint)|go\s+(?:test|build|vet)|cargo\s+(?:test|build|check|clippy|run)|python3?\s+-m\s+(?:pytest|unittest)|dotnet\s+(?:test|build)|mvn\s+(?:test|verify|package)|gradlew?\s+(?:test|build|check)|make\s+(?:test|check|build|lint)|ctest|rspec|phpunit|mix\s+test|swift\s+test|flutter\s+test|tsc\b|biome\s+(?:check|lint)|eslint|ruff\s+(?:check|format)|mypy|pyright|black\s+--check|prettier\s+--check|gofmt|rustfmt\s+--check)\b/i;

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
  if (!command || !VERIFICATION_COMMAND_RE.test(command)) return null;
  return VERIFICATION_COMMAND_RE.test(decidingChain(command)) ? null : command;
}

/** Files a command can run, directly or through an interpreter. */
const RUNNABLE_FILE = /\.(?:ps1|psm1|bat|cmd|sh|bash|zsh|js|mjs|cjs|ts|mts|cts|py|rb|pl|php|lua)$/i;
/** Programs that run the file named after them (`node x.js`, `powershell -File x.ps1`). */
const INTERPRETER =
  /^(?:powershell|pwsh|cmd|bash|sh|zsh|node|bun|deno|tsx|ts-node|python3?|py|uv|ruby|perl|php|lua)(?:\.exe)?$/i;
/** Tokens right before a file that mean "run it": the call operator, dot-sourcing, `-File`, `run`. */
const RUN_MARKER = /^(?:&|\.|-file|-f|\/c|run)$/i;

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
 * `changedFiles` are the files the turn changed; running one of them counts as checking it.
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
    if (VERIFICATION_COMMAND_RE.test(deciding)) return `bash: ${command.slice(0, 120)}`;
    const ran = runsChangedFile(deciding, changedFiles);
    return ran ? `bash: ran the changed file ${ran}` : null;
  }
  if (toolName === "computer_screenshot" || toolName === "computer_snapshot") {
    return `${toolName}: observed rendered output`;
  }
  if (toolName === "task") {
    try {
      const agentName = (JSON.parse(argsJson) as { agent?: string }).agent ?? "";
      if (agentName === "verify" || agentName === "ui-verify" || agentName === "computer") {
        return `task(${agentName}): delegated verification completed`;
      }
    } catch {
      // malformed args; no evidence either way
    }
    return null;
  }
  return null;
}
