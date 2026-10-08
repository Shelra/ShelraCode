import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseVerifierReport,
  ranNoTest,
  runnableVerifierCommand,
  testRunnerHint,
  verifierCommandProblem,
  verifierPrompt,
  verifierTestFile,
} from "./behavior-verifier";

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "shelra-verifier-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
  return root;
}

describe("the independent check's brief", () => {
  it("gives the request verbatim and asks for expectations taken from it, never from the code", () => {
    const prompt = verifierPrompt({
      request: "Implement slugify. It must trim whitespace, lowercase letters and remove trailing hyphens.",
      requirements: ["It must trim whitespace", "lowercase letters", "remove trailing hyphens"],
      changedFiles: ["src/slug.ts"],
      runner: "Bun's test runner: `bun test <file>`",
      workspace: "/work/app",
    });
    expect(prompt).toContain("Implement slugify. It must trim whitespace");
    expect(prompt).toContain("3. remove trailing hyphens");
    expect(prompt).toContain("Files the other agent changed: src/slug.ts.");
    expect(prompt).toContain("never from the implementation");
    expect(prompt).toContain("`.shelra/verify/`");
    expect(prompt).toContain("Change no other file");
  });
});

describe("the checker's report", () => {
  it("reads the JSON on the last line, after any prose and fences", () => {
    const output = [
      "I wrote four tests; two fail.",
      "```json",
      '{"testFile": "./.shelra/verify/slug.test.ts", "command": "bun test .shelra/verify/slug.test.ts", "behaviors": ["trims", "lowercases"], "result": "failed"}',
      "```",
    ].join("\n");
    expect(parseVerifierReport(output)).toEqual({
      testFile: ".shelra/verify/slug.test.ts",
      command: "bun test .shelra/verify/slug.test.ts",
      behaviors: ["trims", "lowercases"],
      result: "failed",
    });
  });

  it("takes the last report when the answer quotes the template first", () => {
    const output = [
      'The format is {"testFile": "<name>", "command": "<cmd>", "behaviors": [], "result": "error"}.',
      '{"testFile": ".shelra/verify/a.test.ts", "command": "node --test .shelra/verify/a.test.ts", "behaviors": ["x"], "result": "passed"}',
    ].join("\n");
    expect(parseVerifierReport(output)?.result).toBe("passed");
  });

  it("holds the checker to nothing when the report is missing, malformed or names no behavior", () => {
    expect(parseVerifierReport("All good, the code works.")).toBeNull();
    expect(parseVerifierReport('{"testFile": ".shelra/verify/a.test.ts", "command": "bun test"')).toBeNull();
    expect(
      parseVerifierReport(
        '{"testFile": ".shelra/verify/a.test.ts", "command": "bun test .shelra/verify/a.test.ts", "behaviors": [], "result": "passed"}',
      ),
    ).toBeNull();
    expect(
      parseVerifierReport(
        '{"testFile": ".shelra/verify/a.test.ts", "command": "bun test .shelra/verify/a.test.ts", "behaviors": ["x"], "result": "maybe"}',
      ),
    ).toBeNull();
  });
});

describe("the command the host will run", () => {
  const file = ".shelra/verify/slug.test.ts";

  it("runs a known runner on exactly the checker's file", () => {
    for (const command of [
      `bun test ${file}`,
      `bun test ./${file}`,
      `bunx vitest run ${file}`,
      `bunx --no-install vitest run ${file}`,
      `npx vitest run ${file} --reporter=verbose`,
      `npx --no-install vitest run ${file} --reporter=verbose`,
      `npx jest ${file}`,
      `bunx --no-install jest ${file} --runInBand`,
      `pnpm exec vitest run ${file}`,
      `yarn jest ${file} --ci`,
      `node --test ${file}`,
      `node --experimental-strip-types --test ${file}`,
    ]) {
      expect(verifierCommandProblem(command, file), command).toBeNull();
    }
    const python = ".shelra/verify/test_slug.py";
    expect(verifierCommandProblem(`python -m pytest -q ${python}`, python)).toBeNull();
    expect(verifierCommandProblem(`python ${python}`, python)).toBeNull();
    // `python -m unittest <path>` turns the path into a module name, which a hidden folder cannot be.
    expect(verifierCommandProblem(`python -m unittest ${python}`, python)).toBe(
      "the command does not run exactly the test file",
    );
    expect(verifierCommandProblem("python -m http.server", python)).toBe(
      "the command does not run exactly the test file",
    );
  });

  it("gives Bun the file as a path: a bare one is a name filter, which never matches a hidden folder", () => {
    expect(runnableVerifierCommand(`bun test ${file}`, file)).toBe(`bun test ./${file}`);
    expect(runnableVerifierCommand(`bun test ./${file}`, file)).toBe(`bun test ./${file}`);
    expect(runnableVerifierCommand(`bun test --bail ${file}`, file)).toBe(`bun test --bail ./${file}`);
    expect(runnableVerifierCommand(`bun test .shelra\\verify\\slug.test.ts`, file)).toBe(`bun test ./${file}`);
    expect(runnableVerifierCommand(`npx vitest run ${file}`, file)).toBe(`npx --no-install vitest run ${file}`);
    expect(runnableVerifierCommand(`bunx jest ${file}`, file)).toBe(`bunx --no-install jest ${file}`);
    expect(runnableVerifierCommand(`bunx --no-install vitest run ${file}`, file)).toBe(
      `bunx --no-install vitest run ${file}`,
    );
    expect(runnableVerifierCommand(`npx --no-install jest ${file}`, file)).toBe(`npx --no-install jest ${file}`);
  });

  it("permits only the explicitly safe flags of the selected runner", () => {
    for (const command of [
      `bun test ${file} --timeout=10000 --bail`,
      `npx vitest run ${file} --reporter=dot --testTimeout=10000`,
      `bunx jest ${file} --runInBand --verbose --testTimeout=10000`,
      `node --test ${file} --test-reporter=tap --test-timeout=10000`,
      `python -m pytest ${file.replace("slug.test.ts", "test_slug.py")} -q -x`,
      `python -B ${file.replace("slug.test.ts", "test_slug.py")}`,
    ]) {
      const testFile = verifierTestFile(command);
      expect(testFile, command).not.toBeNull();
      expect(verifierCommandProblem(command, testFile ?? ""), command).toBeNull();
      const canonical = runnableVerifierCommand(command, testFile ?? "");
      expect(verifierCommandProblem(canonical, testFile ?? ""), canonical).toBeNull();
    }
    expect(verifierCommandProblem(`bun test ${file} --timeout=0`, file)).not.toBeNull();
    expect(verifierCommandProblem(`python ${file} --runInBand`, file)).not.toBeNull();
  });

  it.each([
    ["bun test", "--preload=./.shelra/verify/preload.ts"],
    ["bun test", "--test-name-pattern=smoke"],
    ["bun test", "--update-snapshots"],
    ["node --test", "--require=./.shelra/verify/hook.cjs"],
    ["node --test", "--import=./.shelra/verify/hook.mjs"],
    ["node --test", "--loader=./.shelra/verify/hook.mjs"],
    ["node --test", "--test-name-pattern=smoke"],
    ["bunx vitest run", "--config=.shelra/verify/config.ts"],
    ["bunx vitest run", "--testNamePattern=smoke"],
    ["bunx vitest run", "--passWithNoTests"],
    ["bunx vitest run", "--update"],
    ["bunx vitest run", "--reporter=.shelra/verify/reporter.ts"],
    ["npx jest", "--testNamePattern=smoke"],
    ["npx jest", "--updateSnapshot"],
    ["npx jest", "--setupFiles=.shelra/verify/setup.ts"],
    ["python -m pytest", "--ignore=src/slug.py"],
    ["python -m pytest", "--override-ini=testpaths:empty"],
    ["deno test", "--allow-all"],
    ["bun test", "--arbitrary=anything"],
  ])("refuses execution or test-selection flags: %s %s", (runner, flag) => {
    expect(verifierCommandProblem(`${runner} ${file} ${flag}`, file)).toContain("is not allowed");
  });

  it("cannot request installation through a package launcher or runner flag", () => {
    for (const command of [
      `npx --yes vitest run ${file}`,
      `bunx --install vitest run ${file}`,
      `bunx -p other-package vitest run ${file}`,
      `npx vitest run ${file} --install`,
      `bunx vitest run ${file} --yes`,
    ]) {
      expect(verifierCommandProblem(command, file), command).not.toBeNull();
    }
    for (const launcher of ["npx", "bunx"]) {
      const canonical = runnableVerifierCommand(`${launcher} vitest run ${file}`, file);
      expect(canonical).toBe(`${launcher} --no-install vitest run ${file}`);
      expect(runnableVerifierCommand(canonical, file)).toBe(canonical);
    }
  });

  it("finds a single valid test token without treating it as command authorization", () => {
    expect(verifierTestFile(`bun test ./${file}`)).toBe(file);
    expect(verifierTestFile("bun test .shelra\\verify\\slug.test.ts")).toBe(file);
    expect(verifierTestFile(`bun test ${file} .shelra/verify/other.test.ts`)).toBeNull();
    expect(verifierTestFile("bun test .shelra/verify/../slug.test.ts")).toBeNull();
    expect(verifierTestFile("bun test src/slug.test.ts")).toBeNull();
    const invalid = `bun test ${file} && echo done`;
    expect(verifierTestFile(invalid)).toBe(file);
    expect(verifierCommandProblem(invalid, verifierTestFile(invalid) ?? "")).not.toBeNull();
  });

  it("rejects the filter that hides a required failing behavior in Bun's real runner", () => {
    const dir = mkdtempSync(join(tmpdir(), "shelra-verifier-filter-"));
    try {
      mkdirSync(join(dir, ".shelra", "verify"), { recursive: true });
      writeFileSync(
        join(dir, file),
        "import { test, expect } from 'bun:test';\ntest('smoke', () => expect(1).toBe(1));\ntest('required behavior', () => expect(' A ').toBe('a'));\n",
      );
      const full = spawnSync("bun", ["test", `./${file}`], { cwd: dir, encoding: "utf8", windowsHide: true });
      const filtered = spawnSync("bun", ["test", `./${file}`, "--test-name-pattern=smoke"], {
        cwd: dir,
        encoding: "utf8",
        windowsHide: true,
      });
      expect(full.status).toBe(1);
      expect(filtered.status).toBe(0);
      expect(`${filtered.stdout}${filtered.stderr}`).toContain("1 filtered out");
      expect(ranNoTest(`${filtered.stdout}${filtered.stderr}`)).toBe(false);
      expect(verifierCommandProblem(`bun test ${file} --test-name-pattern=smoke`, file)).toContain("is not allowed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a chain, another file, another program or a file outside the check's folder", () => {
    expect(verifierCommandProblem(`bun test ${file} && rm -rf src`, file)).toBe("the command chains or redirects");
    expect(verifierCommandProblem(`bun test ${file} > out.txt`, file)).toBe("the command chains or redirects");
    expect(verifierCommandProblem(`bun test $(echo ${file})`, file)).toBe("the command chains or redirects");
    expect(verifierCommandProblem("bun test src/slug.test.ts", file)).toBe(
      "the command does not run exactly the test file",
    );
    expect(verifierCommandProblem(`bun test ${file} src/other.test.ts`, file)).toBe(
      "the command does not run exactly the test file",
    );
    expect(verifierCommandProblem(`bun run test ${file}`, file)).toBe("the command does not start a known test runner");
    expect(verifierCommandProblem(`node ${file}`, file)).toBe("node runs only with --test");
    expect(verifierCommandProblem("bun test src/slug.test.ts", "src/slug.test.ts")).toBe(
      "the test file is not a file in .shelra/verify/",
    );
    expect(verifierCommandProblem("bun test .shelra/verify/../x.ts", ".shelra/verify/../x.ts")).toBe(
      "the test file is not a file in .shelra/verify/",
    );
  });
});

describe("the runner a test outside the packages can use", () => {
  it("follows the project's own runner", () => {
    expect(testRunnerHint(project({ "package.json": '{"scripts":{"test":"vitest run"}}' }), ["src/a.ts"])).toContain(
      "npx --no-install vitest run",
    );
    expect(
      testRunnerHint(project({ "package.json": '{"devDependencies":{"vitest":"^3"}}', "bun.lock": "" }), ["a.ts"]),
    ).toContain("bunx --no-install vitest run");
    expect(testRunnerHint(project({ "package.json": '{"scripts":{"test":"bun test"}}' }), ["a.ts"])).toContain(
      "bun test ./<file>",
    );
    expect(testRunnerHint(project({ "package.json": '{"name":"plain"}' }), ["a.js"])).toContain("node --test");
    expect(testRunnerHint(project({ "pyproject.toml": "[tool.pytest.ini_options]\n" }), ["calc.py"])).toContain(
      "python -m pytest",
    );
    expect(testRunnerHint(project({}), ["tool.py"])).toContain("unittest");
  });

  it("uses Bun for a custom Bun check even when the dependency-free project has no lockfile", () => {
    expect(
      testRunnerHint(project({ "package.json": '{"scripts":{"test":"bun verify.ts"}}' }), ["invoice.ts"]),
    ).toContain("bun test ./<file>");
    expect(
      testRunnerHint(project({ "package.json": '{"scripts":{"test":"bun run scripts/check.ts"}}' }), ["src/api.ts"]),
    ).toContain("bun test ./<file>");
  });

  it("gives none where a test must live inside the package, or for files no runner tests", () => {
    expect(testRunnerHint(project({ "go.mod": "module x\n" }), ["main.go"])).toBeNull();
    expect(testRunnerHint(project({ "Cargo.toml": "[package]\n" }), ["src/lib.rs"])).toBeNull();
    expect(testRunnerHint(project({}), ["index.html", "style.css"])).toBeNull();
  });
});

describe("a run that ran no test", () => {
  it("says the check could not run here, not that the code is wrong", () => {
    expect(ranNoTest("No test files found, exiting with code 1")).toBe(true);
    expect(
      ranNoTest(
        'The following filters did not match any test files in --cwd="/w":\n .shelra/verify/slug.test.ts\n2 files were searched',
      ),
    ).toBe(true);
    // Python's unittest exits 0 on a file with no tests in it.
    expect(
      ranNoTest(
        "\n----------------------------------------------------------------------\nRan 0 tests in 0.000s\n\nOK",
      ),
    ).toBe(true);
    expect(ranNoTest("collected 0 items\n\n=== no tests ran in 0.01s ===")).toBe(true);
    expect(ranNoTest("/usr/bin/python: No module named pytest")).toBe(true);
    expect(ranNoTest("'bunx' is not recognized as an internal or external command")).toBe(true);
    expect(
      ranNoTest("error: Could not find an existing 'vitest' binary to run. Stopping because --no-install was passed."),
    ).toBe(true);
    expect(ranNoTest("(fail) slugify > removes trailing hyphens\n 2 pass\n 1 fail")).toBe(false);
  });
});
