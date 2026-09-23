import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Check discovery (audit doc 15, Phase 1.2): the commands a project itself uses to test, type-check,
 * lint and build, read deterministically from what the project states. The host learns them from the
 * repository instead of the model guessing them. One command per kind, by precedence:
 *
 * 1. a command table in AGENTS.md or CLAUDE.md (the project's own words),
 * 2. package.json scripts, run with the package manager its lockfile names,
 * 3. Makefile and justfile targets,
 * 4. the conventions of the language's manifest (pyproject.toml, Cargo.toml, go.mod).
 *
 * Discovery only lists. Which checks run, and when, is the contract's decision: a build can have side
 * effects (this repository's `bun run build` reinstalls the person's `shelra`).
 */

export type CheckKind = "test" | "typecheck" | "lint" | "build";

export interface DiscoveredCheck {
  kind: CheckKind;
  command: string;
  /** Where the command came from, such as "package.json scripts.test" or "AGENTS.md". */
  source: string;
  /** What a package script runs (`bun test` for `bun run test`): running that directly is the same check. */
  runs?: string;
}

/** Whether a command someone ran is this check, exactly: a filtered or partial run is not. */
export function isSameCheck(command: string, check: { command: string; runs?: string }): boolean {
  const normalized = normalizeCommand(command);
  return (
    normalized === normalizeCommand(check.command) ||
    (check.runs !== undefined && normalized === normalizeCommand(check.runs))
  );
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/gu, " ");
}

const KINDS: readonly CheckKind[] = ["test", "typecheck", "lint", "build"];

export function discoverChecks(workspace: string): DiscoveredCheck[] {
  const found = new Map<CheckKind, DiscoveredCheck>();
  const offer = (check: DiscoveredCheck) => {
    if (!found.has(check.kind)) found.set(check.kind, check);
  };
  for (const source of [fromInstructions, fromPackageJson, fromMakeTargets, fromLanguageManifests]) {
    for (const check of source(workspace)) offer(check);
  }
  return KINDS.flatMap((kind) => {
    const check = found.get(kind);
    return check ? [check] : [];
  });
}

function read(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

const TABLE_LABELS: ReadonlyArray<[RegExp, CheckKind]> = [
  [/^tests?$/iu, "test"],
  [/^type[\s-]?check(?:ing)?$/iu, "typecheck"],
  [/^lint(?:ing)?$/iu, "lint"],
  [/^build$/iu, "build"],
];

/** Rows such as `| Typecheck | \`bun run typecheck\` |` in the project's instruction files. */
function fromInstructions(workspace: string): DiscoveredCheck[] {
  const checks: DiscoveredCheck[] = [];
  for (const file of ["AGENTS.md", "CLAUDE.md"]) {
    const text = read(join(workspace, file));
    if (!text) continue;
    for (const line of text.split(/\r?\n/u)) {
      const cells = line.split("|").map((cell) => cell.trim());
      if (cells.length < 4 || cells[0] !== "") continue;
      const label = (cells[1] ?? "").replace(/[*_`]/gu, "").trim();
      const kind = TABLE_LABELS.find(([pattern]) => pattern.test(label))?.[1];
      const command = /`([^`]+)`/u.exec(cells[2] ?? "")?.[1]?.trim();
      if (kind && command) checks.push({ kind, command, source: file });
    }
  }
  return checks;
}

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

function packageManager(workspace: string, scripts: Record<string, string>): PackageManager {
  if (existsSync(join(workspace, "bun.lock")) || existsSync(join(workspace, "bun.lockb"))) return "bun";
  if (existsSync(join(workspace, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(workspace, "yarn.lock"))) return "yarn";
  if (existsSync(join(workspace, "package-lock.json"))) return "npm";
  if (existsSync(join(workspace, "bunfig.toml"))) return "bun";
  if (Object.values(scripts).some((script) => /^bunx?\s/u.test(script.trim()))) return "bun";
  return "npm";
}

function runScript(manager: PackageManager, script: string): string {
  return manager === "yarn" ? `yarn ${script}` : `${manager} run ${script}`;
}

const SCRIPT_NAMES: Record<CheckKind, readonly string[]> = {
  test: ["test"],
  typecheck: ["typecheck", "type-check", "types", "check-types", "tsc"],
  lint: ["lint"],
  build: ["build"],
};

function fromPackageJson(workspace: string): DiscoveredCheck[] {
  const text = read(join(workspace, "package.json"));
  if (!text) return [];
  let scripts: Record<string, string> = {};
  try {
    const manifest = JSON.parse(text) as { scripts?: Record<string, unknown> };
    scripts = Object.fromEntries(
      Object.entries(manifest.scripts ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return [];
  }
  const manager = packageManager(workspace, scripts);
  const checks: DiscoveredCheck[] = [];
  for (const kind of KINDS) {
    const name = SCRIPT_NAMES[kind].find((candidate) => {
      const script = scripts[candidate];
      // npm init's placeholder is not a test suite.
      return script !== undefined && !/no test specified/iu.test(script);
    });
    if (name) {
      checks.push({
        kind,
        command: runScript(manager, name),
        source: `package.json scripts.${name}`,
        runs: scripts[name],
      });
    }
  }
  return checks;
}

const TARGET_KINDS: ReadonlyArray<[string, CheckKind]> = [
  ["test", "test"],
  ["typecheck", "typecheck"],
  ["lint", "lint"],
  ["check", "lint"],
  ["build", "build"],
];

function fromMakeTargets(workspace: string): DiscoveredCheck[] {
  const checks: DiscoveredCheck[] = [];
  for (const [file, runner] of [
    ["Makefile", "make"],
    ["justfile", "just"],
  ] as const) {
    const text = read(join(workspace, file));
    if (!text) continue;
    const targets = new Set(
      [...text.matchAll(/^([A-Za-z][\w-]*)\s*:(?!=)/gmu)].map((match) => match[1]).filter(Boolean) as string[],
    );
    for (const [target, kind] of TARGET_KINDS) {
      if (targets.has(target)) checks.push({ kind, command: `${runner} ${target}`, source: `${file} ${target}` });
    }
  }
  return checks;
}

function hasPythonTests(workspace: string, pyproject: string | null): boolean {
  if (pyproject?.includes("[tool.pytest")) return true;
  if (existsSync(join(workspace, "pytest.ini")) || existsSync(join(workspace, "conftest.py"))) return true;
  if (read(join(workspace, "setup.cfg"))?.includes("[tool:pytest]")) return true;
  if (read(join(workspace, "tox.ini"))?.includes("[pytest]")) return true;
  try {
    const tests = join(workspace, "tests");
    return existsSync(tests) && readdirSync(tests).some((name) => /^test_.*\.py$|_test\.py$/u.test(name));
  } catch {
    return false;
  }
}

function fromLanguageManifests(workspace: string): DiscoveredCheck[] {
  const checks: DiscoveredCheck[] = [];
  const pyproject = read(join(workspace, "pyproject.toml"));
  const isPython =
    pyproject !== null ||
    existsSync(join(workspace, "setup.py")) ||
    existsSync(join(workspace, "setup.cfg")) ||
    existsSync(join(workspace, "requirements.txt"));
  if (isPython) {
    if (hasPythonTests(workspace, pyproject)) {
      checks.push({ kind: "test", command: "python -m pytest", source: "pytest configuration" });
    }
    if (pyproject?.includes("[tool.mypy") || existsSync(join(workspace, "mypy.ini"))) {
      checks.push({ kind: "typecheck", command: "mypy .", source: "mypy configuration" });
    } else if (pyproject?.includes("[tool.pyright") || existsSync(join(workspace, "pyrightconfig.json"))) {
      checks.push({ kind: "typecheck", command: "pyright", source: "pyright configuration" });
    }
    if (pyproject?.includes("[tool.ruff") || existsSync(join(workspace, "ruff.toml"))) {
      checks.push({ kind: "lint", command: "ruff check .", source: "ruff configuration" });
    }
  }
  if (existsSync(join(workspace, "Cargo.toml"))) {
    checks.push(
      { kind: "test", command: "cargo test", source: "Cargo.toml" },
      { kind: "typecheck", command: "cargo check", source: "Cargo.toml" },
      { kind: "lint", command: "cargo clippy", source: "Cargo.toml" },
      { kind: "build", command: "cargo build", source: "Cargo.toml" },
    );
  }
  if (existsSync(join(workspace, "go.mod"))) {
    checks.push(
      { kind: "test", command: "go test ./...", source: "go.mod" },
      { kind: "typecheck", command: "go build ./...", source: "go.mod" },
      { kind: "lint", command: "go vet ./...", source: "go.mod" },
      { kind: "build", command: "go build ./...", source: "go.mod" },
    );
  }
  return checks;
}
