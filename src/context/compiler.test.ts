import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { listWorkspaceFiles } from "../contract/workspace-files";
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

  it("reads a request to carry the work on as about the repository, not as chat (doc 21 §5.7)", () => {
    for (const request of [
      "Continue.",
      "Continue where we left off.",
      "sigue con lo que estabas haciendo",
      "¿Qué estábamos haciendo?",
    ]) {
      expect(classifyTurn(request).kind, request).toBe("repository");
    }
    expect(classifyTurn("thanks, that is all").kind).toBe("conversation");
  });

  it("attaches nothing to a conversation turn", async () => {
    const root = scratch("shelra-context-chat-", { "package.json": '{"scripts":{"test":"bun test"}}' });
    expect(await compileContextPacket(root, "What is a closure?")).toEqual({
      classification: { kind: "conversation", reason: "no repository or mutation signal" },
      promptAppendix: "",
      files: [],
      truncated: false,
    });
  });

  it("supplies the project's checks, its git state and the files the request names", async () => {
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

    const packet = await compileContextPacket(root, "Fix the bug in parser.ts, then update `src/other.ts:12`.");

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

  it("lists a small project's files, never their contents, for a request that names none", async () => {
    const root = repository("shelra-context-unnamed-", {
      "package.json": '{"name":"fixture"}',
      "README.md": "README BODY SHOULD NOT BE INJECTED",
      "src/index.ts": "export const a = 1;\n",
    });

    const packet = await compileContextPacket(root, "revisa el proyecto");

    expect(packet.files).toEqual([]);
    expect(packet.promptAppendix).toContain("The project states no test, type-check or lint command.");
    expect(packet.promptAppendix).toContain("Uncommitted changes: none.");
    expect(packet.promptAppendix).toContain("Files in this project (3):\n- README.md\n- package.json\n- src/index.ts");
    expect(packet.promptAppendix).not.toContain("README BODY");
  });

  it("leaves tool state out of a small project's list, and lists nothing it could not walk to the end", async () => {
    // A project that forgot to ignore .shelra: git lists it, the packet does not.
    const tracked = repository("shelra-context-tool-state-", {
      "package.json": '{"name":"fixture"}',
      "src/index.ts": "export const a = 1;\n",
      ".shelra/memory/MEMORY.md": "- [x](x.md)\n",
    });
    const packet = await compileContextPacket(tracked, "revisa el proyecto");
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
    expect((await compileContextPacket(cli, "revisa el proyecto")).promptAppendix).toContain(
      "Files in this project (4):\n- internal/target/target.go\n- package.json\n- src/commands/build/index.test.ts\n- src/commands/build/index.ts",
    );

    // A project with no .gitignore: git lists bytecode and dependencies at any depth, the packet does not.
    const script = repository("shelra-context-no-gitignore-", {
      "app/calc.py": "def add(a, b):\n    return a + b\n",
      "app/__pycache__/calc.cpython-312.pyc": "x",
      "web/node_modules/dep/index.js": "module.exports = 1;\n",
    });
    const listed = (await compileContextPacket(script, "revisa el proyecto")).promptAppendix;
    expect(listed).toContain("Files in this project (1):\n- app/calc.py");
    expect(listed).not.toContain("__pycache__");
    expect(listed).not.toContain("node_modules");

    // Outside git, a folder deeper than the bounded walk goes means the list would be wrong: none is given.
    const deep = scratch("shelra-context-deep-", {
      "pom.xml": "<project/>",
      "src/main/java/com/example/app/service/impl/Service.java": "class Service {}\n",
    });
    const truncated = await compileContextPacket(deep, "revisa el proyecto");
    expect(truncated.promptAppendix).not.toContain("Files in this project");
    // Three repositories and a walk: 2.5 s alone, past the default 5 s on a busy machine running the full suite.
  }, 20_000);

  it("gives a larger project no file list, only the tests of the files the request names", async () => {
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

    const packet = await compileContextPacket(root, "Implement runQueue in src/queue.ts");

    expect(packet.files).toEqual(["src/queue.ts"]);
    expect(packet.promptAppendix).not.toContain("Files in this project");
    expect(packet.promptAppendix).not.toContain("src/module1.ts");
    expect(packet.promptAppendix).toContain(
      "Tests of the files the request names:\n- src/queue.test.ts\n- test/queue.spec.ts",
    );
    expect(packet.promptAppendix).not.toContain("src/queues.test.ts");
  });

  it("exposes an incomplete no-Git inventory instead of implying complete project coverage", async () => {
    const filler = Object.fromEntries(
      Array.from({ length: 450 }, (_, index) => [
        `src/f${String(index).padStart(3, "0")}.ts`,
        `export const f${index} = ${index};\n`,
      ]),
    );
    const root = scratch("shelra-context-incomplete-", { ...filler, "z-target.ts": "export const target = 20;\n" });
    expect(listWorkspaceFiles(root).files.some((file) => file.path === "z-target.ts")).toBe(false);
    const packet = await compileContextPacket(root, "investiga el repositorio y sus consumidores");
    expect(packet.truncated).toBe(true);
    expect(packet.promptAppendix).toContain("Project file inventory is incomplete");
    expect(packet.promptAppendix).toContain("grep");
    expect(packet.promptAppendix).not.toContain("Files in this project");
  }, 20_000);

  it("hands the model a named package's source, declared consumers and nested documentation", async () => {
    const root = repository("shelra-context-packages-", {
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*", "apps/*"] }),
      "packages/auth/package.json": JSON.stringify({ name: "@fixture/auth", scripts: { test: "bun test" } }),
      "packages/auth/src/login.ts": "export const login = true;\n",
      "packages/auth/README.md": "# Authentication\n",
      "packages/auth/docs/adr/001.md": "Why authentication has its own package.\n",
      "apps/web/package.json": JSON.stringify({ name: "web", dependencies: { "@fixture/auth": "workspace:*" } }),
    });
    const packet = await compileContextPacket(root, "Fix packages/auth/src/login.ts");
    expect(packet.project?.owners).toEqual([
      { file: "packages/auth/src/login.ts", manifest: "packages/auth/package.json" },
    ]);
    expect(packet.promptAppendix).toContain("PROJECT PACKAGE STRUCTURE");
    expect(packet.promptAppendix).toContain("packages/auth/README.md");
    expect(packet.promptAppendix).toContain("packages/auth/docs/adr/001.md");
    expect(packet.promptAppendix).toContain('"manifest":"apps/web/package.json"');
    expect(packet.promptAppendix).toContain('"resolution":"name-match"');
  }, 20_000);

  it("does not report a filesystem inventory as complete when its root could not be read", () => {
    const root = scratch("shelra-context-unreadable-", {});
    expect(listWorkspaceFiles(join(root, "missing-directory"))).toEqual({ files: [], truncated: true });
  });

  it("ignores names outside the workspace and names that do not exist", async () => {
    const root = scratch("shelra-context-outside-", { "src/index.ts": "export const a = 1;\n" });

    const packet = await compileContextPacket(
      root,
      "Read ../secret.txt, missing.ts, https://example.com/a.ts and src/*.ts",
    );

    expect(packet.files).toEqual([]);
    expect(packet.promptAppendix).not.toContain("Files the request names");
  });

  it("finds a bare name outside git with a bounded walk that survives a directory cycle", async () => {
    const root = scratch("shelra-context-cycle-", {
      "package.json": '{"name":"cycle"}',
      "src/index.ts": "export const a = 1;\n",
      "lib/index.ts": "export const b = 2;\n",
    });
    // `loop` points back at the directory that contains it.
    symlinkSync(root, join(root, "src", "loop"), "junction");

    const packet = await compileContextPacket(root, "fix index.ts and read the src/ folder");

    expect(packet.files).toEqual(["src/", "lib/index.ts", "src/index.ts"]);
    expect(packet.promptAppendix).toContain("- index.ts: lib/index.ts, src/index.ts");
    expect(packet.promptAppendix).toContain("Git: this workspace is not in a git repository.");
  });

  it("stays within the character budget", async () => {
    const root = scratch("shelra-context-budget-", { "package.json": '{"scripts":{"test":"bun test"}}' });
    const packet = await compileContextPacket(root, "Fix the project", 60);
    expect(packet.promptAppendix.length).toBeLessThanOrEqual(60 + "\n[context truncated by host]".length);
    expect(packet.truncated).toBe(true);
  });
});

describe("host context compiler and the event loop", () => {
  it("lets the terminal run while git answers, instead of holding it for every command", async () => {
    const eol = String.fromCharCode(10);
    const files: Record<string, string> = { "src/queue.ts": `export const q = 1;${eol}` };
    for (let i = 0; i < 300; i += 1) files[`src/generated-${i}.ts`] = `export const v${i} = ${i};${eol}`;
    const root = repository("shelra-context-loop-", files);
    writeFileSync(join(root, "src/queue.ts"), `export const q = 2;${eol}`);
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 1);
    try {
      const packet = await compileContextPacket(root, "Fix the bug in src/queue.ts");
      expect(packet.promptAppendix).toContain("src/queue.ts");
    } finally {
      clearInterval(timer);
    }
    // The blocking version let none of them run until it had finished.
    expect(ticks).toBeGreaterThan(2);
  });
});
