import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverChecks } from "./discover";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shelra-discover-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function project(name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const commands = (workspace: string) =>
  Object.fromEntries(discoverChecks(workspace).map((check) => [check.kind, check.command]));

describe("discoverChecks", () => {
  it("reads a Bun project's scripts, even without a lockfile (the benchmark fixtures)", () => {
    const dir = project("bun", { "package.json": JSON.stringify({ scripts: { test: "bun test" } }) });
    expect(commands(dir)).toEqual({ test: "bun run test" });
  });

  it("uses the package manager the lockfile names, and skips npm's placeholder test", () => {
    const npm = project("npm", {
      "package.json": JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1', "type-check": "tsc --noEmit", lint: "eslint ." },
      }),
      "package-lock.json": "{}",
    });
    expect(commands(npm)).toEqual({ typecheck: "npm run type-check", lint: "npm run lint" });
    const pnpm = project("pnpm", {
      "package.json": JSON.stringify({ scripts: { test: "vitest run", build: "vite build" } }),
      "pnpm-lock.yaml": "",
    });
    expect(commands(pnpm)).toEqual({ test: "pnpm run test", build: "pnpm run build" });
    const yarn = project("yarn", {
      "package.json": JSON.stringify({ scripts: { test: "jest" } }),
      "yarn.lock": "",
    });
    expect(commands(yarn)).toEqual({ test: "yarn test" });
  });

  it("reads Python, Rust and Go conventions", () => {
    const python = project("python", {
      "pyproject.toml": "[tool.pytest.ini_options]\n[tool.ruff]\n[tool.mypy]\n",
    });
    expect(commands(python)).toEqual({ test: "python -m pytest", typecheck: "mypy .", lint: "ruff check ." });
    const pythonTestsOnly = project("python-tests", {
      "requirements.txt": "requests\n",
      "tests/test_app.py": "def test_ok():\n    assert True\n",
    });
    expect(commands(pythonTestsOnly)).toEqual({ test: "python -m pytest" });
    expect(commands(project("rust", { "Cargo.toml": "[package]\nname = 'x'\n" }))).toEqual({
      test: "cargo test",
      typecheck: "cargo check",
      lint: "cargo clippy",
      build: "cargo build",
    });
    expect(commands(project("go", { "go.mod": "module x\n" }))).toMatchObject({ test: "go test ./..." });
  });

  it("prefers the project's own words: an AGENTS.md table, then scripts, then Make targets", () => {
    const dir = project("stated", {
      "AGENTS.md":
        "| Action | Command |\n| --- | --- |\n| Test | `bun run test:all` (everything) |\n| Lint | `bun run lint` |\n",
      "package.json": JSON.stringify({ scripts: { test: "bun test", typecheck: "tsc --noEmit" } }),
      "bun.lock": "",
      Makefile: "build:\n\tbun build src/index.ts\nlint:\n\techo nope\n",
    });
    const checks = discoverChecks(dir);
    expect(checks).toEqual([
      { kind: "test", command: "bun run test:all", source: "AGENTS.md" },
      { kind: "typecheck", command: "bun run typecheck", source: "package.json scripts.typecheck" },
      { kind: "lint", command: "bun run lint", source: "AGENTS.md" },
      { kind: "build", command: "make build", source: "Makefile build" },
    ]);
  });

  it("finds nothing in a folder that states no checks", () => {
    expect(discoverChecks(project("empty", { "notes.txt": "hello" }))).toEqual([]);
  });

  it("finds this repository's own checks", () => {
    const repository = resolve(__dirname, "..", "..");
    expect(commands(repository)).toMatchObject({
      test: "bun run test",
      typecheck: "bun run typecheck",
      lint: "bun run lint",
    });
  });
});
