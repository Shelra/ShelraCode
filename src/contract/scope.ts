import { type Dirent, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ContractCheck } from "./contract";
import { isTestFile } from "./test-protection";

/**
 * A project check scoped to what a turn changed, for a project whose full check runs longer than the host can wait
 * (2026-10-03: in SWE-bench Pro's task images, with one CPU, `make test`, `go test ./...` and whole pytest suites run
 * for tens of minutes). The scoped run is the project's own runner on the packages or tests the change touches: what an
 * engineer runs while working on a large codebase. Null when no such run can be told from the project.
 */

/** Marks, in a scoped check's source, a check the host narrowed itself. */
export const SCOPED = "scoped to the files this turn changed";

const MAX_TARGETS = 30;
const SKIPPED_DIRS = new Set([".git", ".shelra", "node_modules", "vendor", "dist", "build", "target", "__pycache__"]);
const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/u;

function quote(path: string): string {
  return /^[\w./@+-]+$/u.test(path) ? path : JSON.stringify(path);
}

function posix(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

/** The Go packages the changed files are in, as `./dir` arguments; vendored code and test data left out. */
function goPackages(changed: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const file of changed.map(posix)) {
    if (!file.endsWith(".go") || /(?:^|\/)(?:vendor|testdata)\//u.test(file)) continue;
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".";
    dirs.add(dir === "." ? "." : `./${dir}`);
  }
  return [...dirs].sort();
}

/** Test files named for the changed Python modules (`test_x.py`, `x_test.py`), and the changed tests themselves. */
function pythonTests(changed: readonly string[], workspace: string): string[] {
  const tests = new Set(changed.map(posix).filter((file) => file.endsWith(".py") && isTestFile(file)));
  const wanted = new Set<string>();
  for (const file of changed.map(posix)) {
    if (!file.endsWith(".py") || isTestFile(file)) continue;
    const stem = file.slice(file.lastIndexOf("/") + 1, -3);
    if (stem === "__init__") continue;
    wanted.add(`test_${stem}.py`);
    wanted.add(`${stem}_test.py`);
  }
  if (wanted.size > 0) {
    let budget = 50_000;
    const walk = (dir: string, depth: number) => {
      if (depth > 8 || budget <= 0) return;
      let entries: Dirent[];
      try {
        entries = readdirSync(join(workspace, dir), { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        budget -= 1;
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(path, depth + 1);
        } else if (wanted.has(entry.name)) tests.add(path);
      }
    };
    walk("", 0);
  }
  return [...tests].filter((file) => existsSync(join(workspace, file))).sort();
}

/** How this package manager runs a binary the project installed. */
function execPrefix(command: string): string {
  if (/^yarn\b/u.test(command)) return "yarn";
  if (/^pnpm\b/u.test(command)) return "pnpm exec";
  if (/^bunx?\b/u.test(command)) return "bunx";
  return "npx";
}

export function scopedCheck(
  check: ContractCheck,
  changedFiles: readonly string[],
  workspace: string,
): ContractCheck | null {
  if (check.kind !== "test" && check.kind !== "lint" && check.kind !== "typecheck") return null;
  const scoped = (command: string): ContractCheck => ({
    kind: check.kind,
    command,
    source: `${check.source}, ${SCOPED}`,
  });
  const command = check.command.trim();
  const runs = check.runs ?? "";

  // Go: the project's own `go test ./...`, or a make or just target in a Go module, narrowed to the changed packages.
  if (
    existsSync(join(workspace, "go.mod")) &&
    /^(?:go (?:test|vet|build) \.\/\.\.\.|make \S+|just \S+)$/u.test(command)
  ) {
    const packages = goPackages(changedFiles);
    if (packages.length === 0 || packages.length > MAX_TARGETS) return null;
    const tool = check.kind === "test" ? "go test" : check.kind === "lint" ? "go vet" : "go build";
    return scoped(`${tool} ${packages.join(" ")}`);
  }

  if (check.kind !== "test") return null;

  // pytest: the tests named for the changed modules.
  const pytest = /^((?:python3? -m )?pytest)$/u.exec(command)?.[1];
  if (pytest) {
    const tests = pythonTests(changedFiles, workspace);
    if (tests.length === 0 || tests.length > MAX_TARGETS) return null;
    return scoped(`${pytest} ${tests.map(quote).join(" ")}`);
  }

  // Jest and Vitest find the tests that import the changed files themselves.
  const sources = changedFiles
    .map(posix)
    .filter((file) => SCRIPT_FILE.test(file) && !file.startsWith("node_modules/") && existsSync(join(workspace, file)));
  if (sources.length === 0 || sources.length > MAX_TARGETS) return null;
  const runner = /\bvitest\b/u.test(`${command} ${runs}`)
    ? "vitest"
    : /\bjest\b/u.test(`${command} ${runs}`)
      ? "jest"
      : null;
  if (runner === "vitest") {
    return scoped(`${execPrefix(command)} vitest related --run ${sources.map(quote).join(" ")}`);
  }
  if (runner === "jest") {
    return scoped(`${execPrefix(command)} jest --findRelatedTests ${sources.map(quote).join(" ")}`);
  }
  return null;
}
