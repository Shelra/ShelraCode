import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { classifyTurn, compileContextPacket } from "./compiler";

const roots: string[] = [];
const ceiling = process.env.GIT_CEILING_DIRECTORIES;

// A scratch folder must not be read as part of a repository that happens to contain the temp folder.
beforeAll(() => {
  process.env.GIT_CEILING_DIRECTORIES = tmpdir();
});

afterAll(() => {
  if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
  else process.env.GIT_CEILING_DIRECTORIES = ceiling;
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(prefix: string, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function git(root: string, ...args: string[]): void {
  const result = spawnSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "init.defaultBranch=main", ...args],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function repository(prefix: string, files: Record<string, string>): string {
  const root = scratch(prefix, files);
  git(root, "init", "--template=");
  git(root, "add", ".");
  git(root, "commit", "--no-verify", "-m", "Initial state");
  return root;
}

describe("host context compiler", () => {
  it("classifies without ever carrying a tool policy", () => {
    expect(classifyTurn("What is a closure?")).toEqual({
      kind: "conversation",
      reason: "no repository or mutation signal",
    });
    expect(classifyTurn("Fix parser.ts in the repository")).toEqual({
      kind: "coding",
      reason: "mutation request with repository scope",
    });
    for (const prompt of ["Make the tests pass", "git status", "Why does the login page crash?"]) {
      // These read as "conversation" to a keyword heuristic; the classification is informational
      // only and must never be able to remove tools from the turn.
      expect(classifyTurn(prompt)).not.toHaveProperty("toolPolicy");
    }
  });

  it.each([
    "revisa el proyecto",
    "analiza el repositorio",
    "lee los archivos de la carpeta src",
  ])("classifies Spanish repository requests as repository turns: %s", (prompt) => {
    expect(classifyTurn(prompt)).toMatchObject({ kind: "repository" });
  });

  it("attaches nothing to a conversation turn", () => {
    const root = scratch("shelra-context-chat-", { "package.json": '{"scripts":{"test":"bun test"}}' });
    expect(compileContextPacket(root, "What is a closure?")).toEqual({
      classification: { kind: "conversation", reason: "no repository or mutation signal" },
      promptAppendix: "",
      files: [],
      truncated: false,
    });
  });

  it("supplies the project's checks, its git state and the files the request names", () => {
    const root = repository("shelra-context-git-", {
      "package.json": JSON.stringify({ scripts: { test: "bun test", lint: "biome check .", build: "bun build" } }),
      "src/parser.ts": "export function parse() {}\n",
      "src/other.ts": "export function other() {}\n",
      "src/unrelated.ts": "export const unrelated = 1;\n",
      ".gitignore": "vendor/\n",
    });
    writeFileSync(join(root, "src", "parser.ts"), "export function parse() {\n  return 1;\n}\n");
    writeFileSync(join(root, "notes.md"), "draft\n");
    mkdirSync(join(root, "vendor"));
    writeFileSync(join(root, "vendor", "parser.ts"), "ignored copy\n");

    const packet = compileContextPacket(root, "Fix the bug in parser.ts, then update `src/other.ts:12`.");

    expect(packet.files).toEqual(["src/other.ts", "src/parser.ts"]);
    expect(packet.promptAppendix).toContain(`Workspace root: ${root}`);
    expect(packet.promptAppendix).toContain("- test: `bun run test` (package.json scripts.test)");
    expect(packet.promptAppendix).toContain("- lint: `bun run lint` (package.json scripts.lint)");
    // A build is not a check: it can have side effects, and the contract never runs it.
    expect(packet.promptAppendix).not.toContain("bun run build");
    expect(packet.promptAppendix).toContain("Git branch: main");
    expect(packet.promptAppendix).toMatch(
      /Uncommitted changes \(1 file changed, 3 insertions\(\+\), 1 deletion\(-\)\):/u,
    );
    expect(packet.promptAppendix).toContain(" M src/parser.ts");
    expect(packet.promptAppendix).toContain("?? notes.md");
    expect(packet.promptAppendix).toMatch(/Recent commits:\n {2}[0-9a-f]{7,} Initial state/u);
    expect(packet.promptAppendix).toContain("Files the request names:\n- src/other.ts\n- src/parser.ts");
    // A project this small gets its whole file list, the ignored folder left out, and never file contents.
    expect(packet.promptAppendix).toContain(
      "Files in this project (6):\n- .gitignore\n- notes.md\n- package.json\n- src/other.ts\n- src/parser.ts\n- src/unrelated.ts",
    );
    expect(packet.promptAppendix).not.toContain("vendor/parser.ts");
    expect(packet.promptAppendix).not.toContain('"scripts"');
    expect(packet.truncated).toBe(false);
  });

  it("lists a small project's files, never their contents, for a request that names none", () => {
    const root = repository("shelra-context-unnamed-", {
      "package.json": '{"name":"fixture"}',
      "README.md": "README BODY SHOULD NOT BE INJECTED",
      "src/index.ts": "export const a = 1;\n",
    });

    const packet = compileContextPacket(root, "revisa el proyecto");

    expect(packet.files).toEqual([]);
    expect(packet.promptAppendix).toContain("The project states no test, type-check or lint command.");
    expect(packet.promptAppendix).toContain("Uncommitted changes: none.");
    expect(packet.promptAppendix).toContain("Files in this project (3):\n- README.md\n- package.json\n- src/index.ts");
    expect(packet.promptAppendix).not.toContain("README BODY");
  });

  it("leaves tool state out of a small project's list, and lists nothing it could not walk to the end", () => {
    // A project that forgot to ignore .shelra: git lists it, the packet does not.
    const tracked = repository("shelra-context-tool-state-", {
      "package.json": '{"name":"fixture"}',
      "src/index.ts": "export const a = 1;\n",
      ".shelra/memory/MEMORY.md": "- [x](x.md)\n",
    });
    const packet = compileContextPacket(tracked, "revisa el proyecto");
    expect(packet.promptAppendix).toContain("Files in this project (2):\n- package.json\n- src/index.ts");
    expect(packet.promptAppendix).not.toContain(".shelra");

    // Review round 3 (2026-09-24): a folder named like build output below the root is the project's source.
    const cli = repository("shelra-context-build-command-", {
      "package.json": '{"name":"fixture"}',
      "src/commands/build/index.ts": "export const build = 1;\n",
      "src/commands/build/index.test.ts": "test('build', () => {});\n",
      "internal/target/target.go": "package target\n",
      "build/out.js": "console.log(1);\n",
    });
    expect(compileContextPacket(cli, "revisa el proyecto").promptAppendix).toContain(
      "Files in this project (4):\n- internal/target/target.go\n- package.json\n- src/commands/build/index.test.ts\n- src/commands/build/index.ts",
    );

    // A project with no .gitignore: git lists bytecode and dependencies at any depth, the packet does not.
    const script = repository("shelra-context-no-gitignore-", {
      "app/calc.py": "def add(a, b):\n    return a + b\n",
      "app/__pycache__/calc.cpython-312.pyc": "x",
      "web/node_modules/dep/index.js": "module.exports = 1;\n",
    });
    const listed = compileContextPacket(script, "revisa el proyecto").promptAppendix;
    expect(listed).toContain("Files in this project (1):\n- app/calc.py");
    expect(listed).not.toContain("__pycache__");
    expect(listed).not.toContain("node_modules");

    // Outside git, a folder deeper than the bounded walk goes means the list would be wrong: none is given.
    const deep = scratch("shelra-context-deep-", {
      "pom.xml": "<project/>",
      "src/main/java/com/example/app/service/impl/Service.java": "class Service {}\n",
    });
    const truncated = compileContextPacket(deep, "revisa el proyecto");
    expect(truncated.promptAppendix).not.toContain("Files in this project");
  });

  it("gives a larger project no file list, only the tests of the files the request names", () => {
    const filler = Object.fromEntries(
      Array.from({ length: 45 }, (_, index) => [`src/module${index}.ts`, `export const m${index} = ${index};\n`]),
    );
    const root = repository("shelra-context-large-", {
      ...filler,
      "package.json": '{"scripts":{"test":"bun test"}}',
      "src/queue.ts": "export function runQueue() {}\n",
      "src/queue.test.ts": "import { runQueue } from './queue';\n",
      "test/queue.spec.ts": "import { runQueue } from '../src/queue';\n",
      "src/queues.test.ts": "// another module's tests\n",
    });

    const packet = compileContextPacket(root, "Implement runQueue in src/queue.ts");

    expect(packet.files).toEqual(["src/queue.ts"]);
    expect(packet.promptAppendix).not.toContain("Files in this project");
    expect(packet.promptAppendix).not.toContain("src/module1.ts");
    expect(packet.promptAppendix).toContain(
      "Tests of the files the request names:\n- src/queue.test.ts\n- test/queue.spec.ts",
    );
    expect(packet.promptAppendix).not.toContain("src/queues.test.ts");
  });

  it("ignores names outside the workspace and names that do not exist", () => {
    const root = scratch("shelra-context-outside-", { "src/index.ts": "export const a = 1;\n" });

    const packet = compileContextPacket(root, "Read ../secret.txt, missing.ts, https://example.com/a.ts and src/*.ts");

    expect(packet.files).toEqual([]);
    expect(packet.promptAppendix).not.toContain("Files the request names");
  });

  it("finds a bare name outside git with a bounded walk that survives a directory cycle", () => {
    const root = scratch("shelra-context-cycle-", {
      "package.json": '{"name":"cycle"}',
      "src/index.ts": "export const a = 1;\n",
      "lib/index.ts": "export const b = 2;\n",
    });
    // `loop` points back at the directory that contains it.
    symlinkSync(root, join(root, "src", "loop"), "junction");

    const packet = compileContextPacket(root, "fix index.ts and read the src/ folder");

    expect(packet.files).toEqual(["src/", "lib/index.ts", "src/index.ts"]);
    expect(packet.promptAppendix).toContain("- index.ts: lib/index.ts, src/index.ts");
    expect(packet.promptAppendix).toContain("Git: this workspace is not in a git repository.");
  });

  it("stays within the character budget", () => {
    const root = scratch("shelra-context-budget-", { "package.json": '{"scripts":{"test":"bun test"}}' });
    const packet = compileContextPacket(root, "Fix the project", 60);
    expect(packet.promptAppendix.length).toBeLessThanOrEqual(60 + "\n[context truncated by host]".length);
    expect(packet.truncated).toBe(true);
  });
});
