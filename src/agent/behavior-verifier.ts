/**
 * An independent check of the request (docs/EXECUTION-PLAN.md, the false-completion finding of 2026-10-03: seven of
 * eight self-caused losses were turns that reported done with a stated behavior broken).
 *
 * A turn checks its own work with the tests it wrote, and those tests share its misreading of the request. Here a
 * sub-agent with a fresh context, the same model, writes tests from the request alone; the host runs them itself,
 * and a failure goes back to the turn for a bounded repair. The sub-agent's word counts for nothing: only the host's
 * run of its tests does. Its test lives under `.shelra/verify/`, which no workspace scan counts, and is on disk only
 * while it runs: a project runner such as Vitest would otherwise pick it up in the project's own checks.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Where the independent check writes its test, relative to the session's workspace. */
export const VERIFY_DIR = ".shelra/verify";
/** Steps the checking sub-agent may take: enough to read the code, write one file and run it a few times. */
export const VERIFIER_MAX_STEPS = 24;

export interface VerifierReport {
  testFile: string;
  command: string;
  behaviors: string[];
  result: "passed" | "failed" | "error";
}

/** How a test file in VERIFY_DIR can be run in this project, or null when a test cannot live outside the package. */
export function testRunnerHint(workspace: string, changedFiles: readonly string[]): string | null {
  // Go and Rust tests live inside the package they test; a JVM or .NET test needs the build's own layout.
  const packaged = changedFiles.some((file) => /\.(?:go|rs|java|kt|kts|scala|cs|fs|swift)$/u.test(file));
  const scripted = changedFiles.some((file) => /\.(?:py|m?js|cjs|ts|mts|cts|tsx|jsx)$/u.test(file));
  if (packaged && !scripted) return null;
  const manifest = readJson(join(workspace, "package.json"));
  const pyproject = readText(join(workspace, "pyproject.toml"));
  const python =
    pyproject !== null ||
    ["setup.py", "setup.cfg", "pytest.ini", "tox.ini", "requirements.txt"].some((file) =>
      existsSync(join(workspace, file)),
    ) ||
    changedFiles.some((file) => file.endsWith(".py"));
  if (manifest) {
    const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
    const test = typeof scripts.test === "string" ? scripts.test : "";
    const deps = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) } as Record<string, unknown>;
    const bun = existsSync(join(workspace, "bun.lock")) || existsSync(join(workspace, "bun.lockb"));
    const runPackage = bun ? "bunx" : "npx";
    if (/\bvitest\b/u.test(test) || "vitest" in deps) return `Vitest: \`${runPackage} vitest run <file>\``;
    if (/\bjest\b/u.test(test) || "jest" in deps) return `Jest: \`${runPackage} jest <file>\``;
    if (/\bbun test\b/u.test(test) || bun) {
      return "Bun's test runner: `bun test ./<file>` (with the `./`, or Bun reads it as a name filter and skips the hidden folder), importing from `bun:test`";
    }
    if (/\bnode\b.*--test\b/u.test(test) || !python) {
      return "Node's test runner: `node --test <file>`, with `node:test` and `node:assert/strict`";
    }
  }
  if (python) {
    return /\bpytest\b/u.test(pyproject ?? "") || existsSync(join(workspace, "pytest.ini"))
      ? "pytest: `python -m pytest <file>` (run from the project root, so its modules import by name)"
      : "pytest when it is installed (`python -m pytest <file>`, run from the project root); if it is not, a unittest file run directly (`python <file>`) that puts the project root on `sys.path` first and ends with `unittest.main()`";
  }
  if (changedFiles.some((file) => /\.(?:m?js|cjs|ts|mts|cts|tsx|jsx)$/u.test(file))) {
    return "Node's test runner: `node --test <file>`, with `node:test` and `node:assert/strict`";
  }
  return null;
}

/** The checking sub-agent's brief: the request, verbatim, and nothing of the turn's reasoning. */
export function verifierPrompt(input: {
  request: string;
  requirements: readonly string[];
  changedFiles: readonly string[];
  runner: string;
  workspace: string;
}): string {
  const files = input.changedFiles.slice(0, 20);
  return [
    "You are an independent checker. Another agent changed this project to carry out the request below and says it is done. You did not write that code and must not trust it: find out, from the request alone, whether each behavior it asks for really works.",
    "",
    "The request, as the user wrote it:",
    "<<<",
    input.request.length > 6_000 ? `${input.request.slice(0, 6_000)}…` : input.request,
    ">>>",
    "",
    "The behaviors it states:",
    ...input.requirements.map(
      (requirement, index) =>
        `${index + 1}. ${requirement.length > 240 ? `${requirement.slice(0, 239)}…` : requirement}`,
    ),
    "",
    `Files the other agent changed: ${files.join(", ")}${input.changedFiles.length > files.length ? ` and ${input.changedFiles.length - files.length} more` : ""}.`,
    `The project root is ${input.workspace}; run every command from there.`,
    "",
    "What to do:",
    "1. Read the changed files only to learn how to call the code: module paths, exported names, signatures. Take every expected result from the request, never from the implementation: when the request says what a call returns, assert exactly that, whatever the code does.",
    `2. Write ONE test file in \`${VERIFY_DIR}/\` under the project root (\`${join(input.workspace, VERIFY_DIR)}\`; create the folder), with one test per behavior, each named after the behavior it checks, covering the cases and limits the request names. Use ${input.runner}. The file sits two folders below the project root: import the project's code with a relative path from there.`,
    "3. Run it with one command, nothing chained before or after it. If it cannot run (a syntax error, a wrong import path), fix the test file and run it again. If an assertion fails, read the request again: when the request states that result, keep the assertion, because a failing test is the finding you are here for. Change an assertion only when you misread the request.",
    "4. Change no other file: not the project's code, its tests or its configuration. Install nothing.",
    "5. Leave out a behavior no test can check from here (how something looks, a real external service).",
    "",
    "End your answer with this JSON on its own last line, and nothing after it:",
    `{"testFile": "${VERIFY_DIR}/<name>", "command": "<the exact command you ran>", "behaviors": ["<each behavior a test checks>"], "result": "passed" | "failed" | "error"}`,
    '"error" means the test file could not be made to run.',
  ].join("\n");
}

/** The report at the end of the sub-agent's answer, or null when there is none it can be held to. */
export function parseVerifierReport(output: string): VerifierReport | null {
  const starts = [...output.matchAll(/\{\s*"testFile"\s*:/gu)];
  const start = starts.at(-1)?.index;
  if (start === undefined) return null;
  let end = output.indexOf("}", start);
  while (end !== -1) {
    try {
      const value = JSON.parse(output.slice(start, end + 1)) as Record<string, unknown>;
      const behaviors = Array.isArray(value.behaviors)
        ? value.behaviors.filter((item): item is string => typeof item === "string" && item.trim() !== "")
        : [];
      if (
        typeof value.testFile !== "string" ||
        typeof value.command !== "string" ||
        behaviors.length === 0 ||
        (value.result !== "passed" && value.result !== "failed" && value.result !== "error")
      ) {
        return null;
      }
      return {
        testFile: value.testFile.trim().replaceAll("\\", "/").replace(/^\.\//u, ""),
        command: value.command.trim(),
        behaviors,
        result: value.result,
      };
    } catch {
      end = output.indexOf("}", end + 1);
    }
  }
  return null;
}

/** Runners the host will start on the sub-agent's file, as token sequences that must begin the command. */
const RUNNERS: readonly (readonly string[])[] = [
  ["bun", "test"],
  ["bunx", "vitest", "run"],
  ["npx", "vitest", "run"],
  ["npx", "--no-install", "vitest", "run"],
  ["pnpm", "vitest", "run"],
  ["pnpm", "exec", "vitest", "run"],
  ["yarn", "vitest", "run"],
  ["bunx", "jest"],
  ["npx", "jest"],
  ["npx", "--no-install", "jest"],
  ["pnpm", "jest"],
  ["yarn", "jest"],
  ["node"],
  ["deno", "test"],
  ["python", "-m", "pytest"],
  ["python3", "-m", "pytest"],
  ["py", "-m", "pytest"],
  ["pytest"],
  // A unittest file run directly: `python -m unittest` cannot import a file in a hidden folder.
  ["python"],
  ["python3"],
  ["py"],
];
const SHELL_SYNTAX = /[;&|<>`$\r\n()]/u;
const FLAG = /^--?[A-Za-z][\w.-]*(?:=[\w.:/@,-]+)?$/u;
const TEST_FILE = /^\.shelra\/verify\/[\w.-]+$/u;

/**
 * Why the host will not run this command, or null when it will: a known test runner started on exactly the
 * sub-agent's file, with flags and nothing else. The host runs it in the user's shell, so nothing chained.
 */
export function verifierCommandProblem(command: string, testFile: string): string | null {
  if (!TEST_FILE.test(testFile) || testFile.includes("..")) return `the test file is not a file in ${VERIFY_DIR}/`;
  if (SHELL_SYNTAX.test(command)) return "the command chains or redirects";
  const tokens = command.trim().split(/\s+/u);
  const runner = RUNNERS.filter((prefix) => prefix.every((token, index) => tokens[index] === token)).sort(
    (a, b) => b.length - a.length,
  )[0];
  if (!runner) return "the command does not start a known test runner";
  const rest = tokens.slice(runner.length);
  if (runner[0] === "node" && !rest.includes("--test")) return "node runs only with --test";
  const files = rest.filter((token) => !FLAG.test(token));
  if (files.length !== 1 || files[0]?.replace(/^\.\//u, "").replaceAll("\\", "/") !== testFile) {
    return "the command does not run exactly the test file";
  }
  return null;
}

/**
 * The command as the host runs it: Bun reads a bare path as a name filter, which never matches a file in a hidden
 * folder, so its file goes as `./<file>`.
 */
export function runnableVerifierCommand(command: string, testFile: string): string {
  const tokens = command.trim().split(/\s+/u);
  if (tokens[0] !== "bun" || tokens[1] !== "test") return command.trim();
  return tokens.map((token, index) => (index > 1 && token === testFile ? `./${testFile}` : token)).join(" ");
}

/** A host run that ran no test at all: the check could not run here, which says nothing about the code. */
export function ranNoTest(output: string): boolean {
  return [
    /No test files found/iu,
    /did not match any test files/iu,
    /collected 0 items/iu,
    /\bRan 0 tests\b/u,
    /no tests? (?:found|ran|were found)/iu,
    /\b0 pass\b[\s\S]*\b0 fail\b/u,
    /command not found/iu,
    /is not recognized as (?:an internal or external command|the name of a cmdlet)/iu,
    /No module named '?pytest/iu,
    /could not determine executable to run/iu,
  ].some((pattern) => pattern.test(output));
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readJson(path: string): Record<string, Record<string, unknown> | undefined> | null {
  const text = readText(path);
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? (value as Record<string, Record<string, unknown> | undefined>) : null;
  } catch {
    return null;
  }
}
