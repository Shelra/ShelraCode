import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addedCheckSources,
  changedCheckDefinitions,
  changeMadeByTurn,
  checkEditsAllowedBy,
  isShortFollowUp,
  recordDefinitionFiles,
  runsChangedDefinition,
  snapshotCheckDefinitions,
} from "./check-definitions";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "shelra-check-definitions-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) put(dir, name, text);
  return dir;
}

function put(root: string, name: string, text: string): void {
  mkdirSync(dirname(join(root, name)), { recursive: true });
  writeFileSync(join(root, name), text);
}

const pkg = (scripts: Record<string, string>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "p", scripts, ...extra });

/** The descriptions of what changed between a snapshot taken now and the workspace after `edit`. */
function changesAfter(cwd: string, edit: () => void, allowed: string[] = []): string[] {
  const before = snapshotCheckDefinitions(cwd);
  edit();
  return changedCheckDefinitions(before, cwd, new Set(allowed as never[])).map((change) => change.description);
}

describe("what a check runs, as the turn started with it (audit doc 17, S10)", () => {
  it("sees a check script rewritten to pass whatever the code does", () => {
    const cwd = workspace({ "package.json": pkg({ test: "bun test" }), "bun.lock": "" });
    expect(changesAfter(cwd, () => put(cwd, "package.json", pkg({ test: "echo 1 pass" })))).toEqual([
      "what `bun run test` runs changed (package.json)",
    ]);
  });

  it("follows called scripts, pre and post scripts, bare yarn calls, npm-run-all globs and flags before the verb", () => {
    const cwd = workspace({ "package.json": pkg({ test: "npm run unit", unit: "vitest run" }) });
    expect(
      changesAfter(cwd, () => put(cwd, "package.json", pkg({ test: "npm run unit", unit: "echo ok" }))),
    ).toHaveLength(1);
    put(cwd, "package.json", pkg({ test: "npm run unit", unit: "vitest run" }));
    expect(
      changesAfter(cwd, () =>
        put(cwd, "package.json", pkg({ test: "npm run unit", unit: "vitest run", pretest: "exit 0" })),
      ),
    ).toHaveLength(1);

    const yarn = workspace({ "package.json": pkg({ test: "yarn unit", unit: "jest" }), "yarn.lock": "" });
    expect(
      changesAfter(yarn, () => put(yarn, "package.json", pkg({ test: "yarn unit", unit: "echo 1 pass" }))),
    ).toHaveLength(1);

    const all = workspace({ "package.json": pkg({ test: "npm-run-all test:*", "test:unit": "vitest run" }) });
    expect(
      changesAfter(all, () => put(all, "package.json", pkg({ test: "npm-run-all test:*", "test:unit": "echo ok" }))),
    ).toHaveLength(1);

    const flags = workspace({ "package.json": pkg({ test: "npm --silent run unit", unit: "vitest run" }) });
    expect(
      changesAfter(flags, () => put(flags, "package.json", pkg({ test: "npm --silent run unit", unit: "true" }))),
    ).toHaveLength(1);
  });

  it("follows nested packages, table rows with arguments, workspace filters and a root without the script", () => {
    const nested = workspace({
      "package.json": pkg({ test: "cd packages/core && npm test" }),
      "packages/core/package.json": pkg({ test: "vitest run" }),
    });
    expect(changesAfter(nested, () => put(nested, "packages/core/package.json", pkg({ test: "echo 1 pass" })))).toEqual(
      ["what `npm run test` runs changed (packages/core/package.json)"],
    );

    const table = workspace({
      "AGENTS.md": "| Action | Command |\n| --- | --- |\n| Test | `npm test -- --run` |\n",
      "package.json": pkg({ test: "vitest" }),
    });
    expect(changesAfter(table, () => put(table, "package.json", pkg({ test: "echo 1 pass" })))).toEqual([
      "what `npm test -- --run` runs changed (package.json, named in AGENTS.md)",
    ]);

    // The usual npm monorepo: the root has no test script; `npm test --workspaces` runs each package's.
    const mono = workspace({
      "AGENTS.md": "| Action | Command |\n| --- | --- |\n| Test | `npm test --workspaces` |\n",
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
      "packages/core/package.json": pkg({ test: "node check.js" }),
    });
    expect(
      changesAfter(mono, () => put(mono, "packages/core/package.json", pkg({ test: "echo 1 pass" }))),
    ).toHaveLength(1);
  });

  it("follows Make prerequisites, variables and includes, and ignores a recipe no check runs", () => {
    const makefile = (unit: string, fmt = "black .", pytest = "pytest -q") =>
      `PYTEST = ${pytest}\n\ntest: unit\n\nunit:\n\t${unit}\n\nfmt:\n\t${fmt}\n`;
    const cwd = workspace({ Makefile: makefile("$(PYTEST)") });
    expect(changesAfter(cwd, () => put(cwd, "Makefile", makefile("$(PYTEST)", "black -l 100 .")))).toEqual([]);
    expect(changesAfter(cwd, () => put(cwd, "Makefile", makefile("$(PYTEST)", "black .", "true")))).toHaveLength(1);
    put(cwd, "Makefile", makefile("$(PYTEST)"));
    expect(changesAfter(cwd, () => put(cwd, "Makefile", makefile("@echo 1 pass")))).toHaveLength(1);
    put(cwd, "Makefile", makefile("$(PYTEST)"));
    expect(changesAfter(cwd, () => put(cwd, "Makefile", `-include local.mk\n${makefile("$(PYTEST)")}`))).toHaveLength(
      1,
    );
  });

  it("covers the tooling a check executes and what it loads, the shell and manager settings, and a shim's target", () => {
    const tooling = workspace({
      "package.json": pkg({ test: "node scripts/run-tests.js" }),
      "scripts/run-tests.js": "require('./lib/runner');\n",
      "scripts/lib/runner.js": "process.exit(require('child_process').spawnSync('bun', ['test']).status);\n",
    });
    expect(changesAfter(tooling, () => put(tooling, "scripts/lib/runner.js", "console.log('1 pass');\n"))).toEqual([
      "what `npm run test` runs changed (scripts/lib/runner.js)",
    ]);

    const shell = workspace({ "package.json": pkg({ test: 'node -e "process.exit(1)"' }), "pnpm-lock.yaml": "" });
    expect(changesAfter(shell, () => put(shell, "pnpm-workspace.yaml", "scriptShell: true\n"))).toHaveLength(1);
    expect(
      changesAfter(shell, () =>
        put(shell, "package.json", pkg({ test: 'node -e "process.exit(1)"' }, { packageManager: "pnpm@9.0.0" })),
      ),
    ).toHaveLength(1);

    const shim = workspace({
      "package.json": pkg({ test: "vitest run" }),
      "node_modules/.bin/vitest.cmd": '@"%~dp0\\..\\vitest\\vitest.mjs" %*\r\n',
      "node_modules/vitest/vitest.mjs": "run();\n",
    });
    expect(changesAfter(shim, () => put(shim, "node_modules/vitest/vitest.mjs", "process.exit(0);\n"))).toHaveLength(1);
  });

  it("covers the test runner's configuration and modules that would shadow pytest", () => {
    const python = workspace({
      "pyproject.toml": "[tool.pytest.ini_options]\n",
      "tests/test_slug.py": "def test(): assert False\n",
    });
    expect(changesAfter(python, () => put(python, "pytest.ini", "[pytest]\naddopts = --collect-only\n"))).toHaveLength(
      1,
    );
    expect(
      changesAfter(python, () => put(python, "conftest.py", "def pytest_pyfunc_call(pyfuncitem): return True\n")),
    ).toHaveLength(1);
    expect(changesAfter(python, () => put(python, "tests/conftest.py", "import os\nos._exit(0)\n"))).toHaveLength(1);
    expect(changesAfter(python, () => put(python, "_pytest.py", "raise SystemExit(0)\n"))).toHaveLength(1);

    const js = workspace({ "package.json": pkg({ test: "vitest run" }), "vitest.config.ts": "export default {};\n" });
    expect(
      changesAfter(js, () =>
        put(js, "vitest.config.ts", "export default { test: { passWithNoTests: true, include: [] } };\n"),
      ),
    ).toHaveLength(1);
  });

  it("does not count the code under test, a test file, or a new script no check runs", () => {
    const cwd = workspace({
      "package.json": pkg({ test: "bun test", dev: "bun run src/index.ts" }),
      "bun.lock": "",
      "src/index.ts": "export {};\n",
    });
    expect(
      changesAfter(cwd, () => {
        put(cwd, "src/index.ts", "export const x = 1;\n");
        put(cwd, "package.json", pkg({ test: "bun test", dev: "bun --watch src/index.ts", lint: "biome check ." }));
      }),
    ).toEqual([]);
  });

  it("keeps the same script the same check when a lockfile the turn created changes the package manager", () => {
    const cwd = workspace({ "package.json": pkg({ test: "vitest run" }) });
    const before = snapshotCheckDefinitions(cwd);
    expect(before[0]?.command).toBe("npm run test");
    put(cwd, "bun.lock", "");
    expect(changedCheckDefinitions(before, cwd)).toEqual([]);
  });

  it("reads a package.json saved with a byte-order mark as npm and bun do", () => {
    const cwd = workspace({ "package.json": pkg({ test: "bun test" }), "bun.lock": "" });
    expect(changesAfter(cwd, () => put(cwd, "package.json", `﻿${pkg({ test: "bun test" })}`))).toEqual([]);
    expect(changesAfter(cwd, () => put(cwd, "package.json", `﻿${pkg({ test: "echo 1 pass" })}`))).toHaveLength(1);
  });

  it("takes a runner updated with its dependency as the same check, and an edited runner as a change", () => {
    const runner = (version: string, body: string) => ({
      "node_modules/vitest/package.json": JSON.stringify({ name: "vitest", version }),
      "node_modules/vitest/vitest.mjs": body,
    });
    const cwd = workspace({
      "package.json": pkg({ test: "vitest run" }),
      "node_modules/.bin/vitest.cmd": '@"%~dp0\\..\\vitest\\vitest.mjs" %*\r\n',
      ...runner("3.2.4", "run();\n"),
    });
    const install = (files: Record<string, string>) => () => {
      for (const [name, text] of Object.entries(files)) put(cwd, name, text);
    };
    expect(changesAfter(cwd, install(runner("3.3.0", "run({ next: true });\n")))).toEqual([]);
    expect(changesAfter(cwd, install(runner("3.3.0", "process.exit(0);\n")))).toHaveLength(1);
  });

  it("accepts steps appended after the old ones, never a new first step", () => {
    const cwd = workspace({
      "package.json": pkg({ test: "vitest run --exclude src/a.test.ts && bun test src/a.test.ts" }),
    });
    expect(
      changesAfter(cwd, () =>
        put(
          cwd,
          "package.json",
          pkg({
            test: "vitest run --exclude src/a.test.ts --exclude src/b.test.ts && bun test src/a.test.ts && bun test src/b.test.ts",
          }),
        ),
      ),
    ).toEqual([]);
    for (const weakened of [
      "vitest run --exclude src/a.test.ts || true",
      "exit 0 && vitest run --exclude src/a.test.ts && bun test src/a.test.ts",
      "cd src/sanity && vitest run --exclude src/a.test.ts && bun test src/a.test.ts",
      "vitest run --exclude src/a.test.ts --exclude src/b.test.ts && bun test src/a.test.ts && echo src/b.test.ts",
    ]) {
      put(cwd, "package.json", pkg({ test: "vitest run --exclude src/a.test.ts && bun test src/a.test.ts" }));
      expect(
        changesAfter(cwd, () => put(cwd, "package.json", pkg({ test: weakened }))),
        weakened,
      ).toHaveLength(1);
    }
  });

  it("repairs a check that was missing only with a real runner, and a skipped step never hides the rest", () => {
    const table = { "AGENTS.md": "| Action | Command |\n| --- | --- |\n| Test | `npm test` |\n" };
    const empty = workspace({ ...table, "package.json": pkg({}) });
    expect(changesAfter(empty, () => put(empty, "package.json", pkg({ test: "vitest run" })))).toEqual([]);
    put(empty, "package.json", pkg({}));
    expect(changesAfter(empty, () => put(empty, "package.json", pkg({ test: "echo 1 pass" })))).toHaveLength(1);

    const script = workspace({
      "AGENTS.md": "| Action | Command |\n| --- | --- |\n| Test | `sh ./scripts/test.sh` |\n",
    });
    expect(changesAfter(script, () => put(script, "scripts/test.sh", "echo 1 pass\n"))).toHaveLength(1);

    const ifPresent = workspace({
      "package.json": pkg({ test: "npm run build --if-present && bun test" }),
      "package-lock.json": "",
    });
    expect(changesAfter(ifPresent, () => put(ifPresent, "package.json", pkg({ test: "echo 1 pass" })))).toHaveLength(1);
  });

  it("lets a kind the request allows change, and nothing else", () => {
    const cwd = workspace({ "package.json": pkg({ test: "jest", lint: "eslint ." }), "package-lock.json": "" });
    expect(
      changesAfter(cwd, () => put(cwd, "package.json", pkg({ test: "vitest run", lint: "eslint ." })), ["test"]),
    ).toEqual([]);
    put(cwd, "package.json", pkg({ test: "jest", lint: "eslint ." }));
    expect(
      changesAfter(cwd, () => put(cwd, "package.json", pkg({ test: "vitest run", lint: "true" })), ["test"]),
    ).toEqual(["what `npm run lint` runs changed (package.json)"]);
  });

  it("names a check source the turn added, so it does not become the next turn's definition of done", () => {
    const cwd = workspace({ "package.json": pkg({ test: "bun test" }), "bun.lock": "" });
    const before = snapshotCheckDefinitions(cwd);
    put(cwd, "AGENTS.md", "| Action | Command |\n| --- | --- |\n| Test | `bun test src/sanity` |\n| Lint | `true` |\n");
    expect(addedCheckSources(before, cwd)).toEqual([
      "the test check is now `bun test src/sanity` (AGENTS.md), not `bun run test`",
      "a new lint check `true` (AGENTS.md)",
    ]);
    expect(addedCheckSources(before, cwd, new Set(["test", "lint"]))).toEqual([]);
  });
});

describe("evidence from a check the turn changed", () => {
  it("does not count a run of a script the turn changed, in the root or in a nested package", () => {
    const cwd = workspace({ "package.json": pkg({ test: "bun test" }), "bun.lock": "" });
    const recorded = recordDefinitionFiles(cwd);
    expect(runsChangedDefinition("bun run test", cwd, cwd, recorded, new Set())).toBe(false);
    put(cwd, "package.json", pkg({ test: "echo 1 pass" }));
    expect(runsChangedDefinition("bun run test", cwd, cwd, recorded, new Set())).toBe(true);
    expect(runsChangedDefinition("bun test", cwd, cwd, recorded, new Set())).toBe(false);

    const placeholder = workspace({ "package.json": pkg({ test: 'echo "Error: no test specified" && exit 1' }) });
    const start = recordDefinitionFiles(placeholder);
    put(placeholder, "package.json", pkg({ test: "echo 1 pass" }));
    expect(runsChangedDefinition("npm test", placeholder, placeholder, start, new Set())).toBe(true);

    const mono = workspace({
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
      "packages/slug/package.json": pkg({ test: "bun test" }),
    });
    const monoStart = recordDefinitionFiles(mono);
    put(mono, "packages/slug/package.json", pkg({ test: "echo 1 pass" }));
    expect(runsChangedDefinition("cd packages/slug && npm test", mono, mono, monoStart, new Set())).toBe(true);
    expect(runsChangedDefinition("npm test", join(mono, "packages", "slug"), mono, monoStart, new Set())).toBe(true);
  });

  it("does not count a run whose tooling or shadowing module the turn changed", () => {
    const cwd = workspace({
      "package.json": pkg({ verify: "node scripts/verify.js" }),
      "scripts/verify.js": "check();\n",
    });
    const recorded = recordDefinitionFiles(cwd);
    put(cwd, "scripts/verify.js", "console.log('1 pass');\n");
    expect(runsChangedDefinition("npm run verify", cwd, cwd, recorded, new Set(["scripts/verify.js"]))).toBe(true);
    expect(runsChangedDefinition("python -m pytest", cwd, cwd, recorded, new Set(["pytest.py"]))).toBe(true);
  });
});

describe("who changed a check", () => {
  it("blames the turn only when its own write changed the check, not when another session had", () => {
    const cwd = workspace({ "package.json": pkg({ test: "bun test" }), "bun.lock": "" });
    const [change] = changedCheckDefinitions(
      snapshotCheckDefinitions(cwd),
      (() => {
        put(cwd, "package.json", pkg({ test: "bun test --coverage" }, { dependencies: { zod: "^3" } }));
        return cwd;
      })(),
    );
    if (!change) throw new Error("expected a change");
    // Another session changed the script, then the turn wrote package.json to add zod.
    expect(changeMadeByTurn(change, cwd, () => pkg({ test: "bun test --coverage" }))).toBe(false);
    // The turn itself changed the script.
    expect(changeMadeByTurn(change, cwd, () => pkg({ test: "bun test" }))).toBe(true);
    // The file tools never wrote it (a shell command or a merge did).
    expect(changeMadeByTurn(change, cwd, () => undefined)).toBe(false);
  });
});

describe("which check changes the request asks for", () => {
  const kinds = (request: string) => [...checkEditsAllowedBy(request)].sort();

  it("allows the kinds a request acts on through their script, command, runner or configuration", () => {
    expect(kinds("Replace Jest with Vitest.")).toEqual(["test"]);
    expect(kinds("Upgrade ESLint to v9.")).toEqual(["lint"]);
    expect(kinds("Make npm test also run the integration tests.")).toEqual(["test"]);
    expect(kinds("Update the test script in package.json to use vitest.")).toEqual(["test"]);
    expect(kinds("Convert the test suite to Vitest.")).toEqual(["test"]);
    expect(kinds("Drop Jest in favor of Vitest.")).toEqual(["test"]);
    expect(kinds("Cambia el script de lint para que use biome.")).toEqual(["lint"]);
    expect(kinds("Migrate the tests from jest to vitest. Do not modify the tests.")).toEqual(["test"]);
    expect(kinds("Migrate the tests from jest to vitest, but don't change the lint script.")).toEqual(["test"]);
    expect(kinds("git merge origin/main and set a to 2 in src/a.ts.")).toEqual(["lint", "test", "typecheck"]);
  });

  it("allows a check change the user accepts in the words the [Not verified] note gives", () => {
    expect(kinds("Keep the check changes and finish slugify.")).toEqual(["lint", "test", "typecheck"]);
    expect(kinds("Keep the new test script.")).toEqual(["test"]);
    expect(kinds("Accept the lint config change.")).toEqual(["lint"]);
    expect(kinds("Acepta los cambios de los checks.")).toEqual(["lint", "test", "typecheck"]);
    expect(kinds("Keep the tests passing while you refactor.")).toEqual([]);
    expect(kinds("Keep the test command fast.")).toEqual([]);
  });

  it("allows nothing for ordinary requests, however they mention checks, or under a prohibition", () => {
    for (const request of [
      "Implement slugify in src/slug.ts so it trims and lowercases.",
      "Add zod to package.json, and implement slugify in src/slug.ts so it trims and lowercases.",
      "Fix the failing test in src/slug.test.ts.",
      "Make sure npm test passes before you finish.",
      "Open a pull request with the fix.",
      "Implement slugify in src/slug.ts so it trims and lowercases. Use the existing test setup.",
      "Merge the helpers into slugify in src/slug.ts.",
      "Fix the parser so the vitest suite passes.",
      "Implement slugify. Do not change the test script.",
      "Implement slugify in src/slug.ts. You are not allowed to change the test script.",
      "Implement slugify so it trims and lowercases, and please don’t change the test script.",
      "Implementa slugify sin cambiar los scripts de package.json.",
      "Upgrade eslint to v9 but leave the scripts alone.",
    ]) {
      expect(kinds(request), request).toEqual([]);
    }
  });

  it("treats a short approval as a follow-up to the request before it, and nothing else", () => {
    expect(isShortFollowUp("yes, go ahead")).toBe(true);
    expect(isShortFollowUp("ok gracias, continúa")).toBe(true);
    expect(isShortFollowUp("dale, usa globals")).toBe(true);
    expect(isShortFollowUp("Now rewrite the parser")).toBe(false);
    expect(
      isShortFollowUp("Implement slugify in src/slug.ts so it trims, lowercases and replaces runs of spaces."),
    ).toBe(false);
  });
});
