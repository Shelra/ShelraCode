import { mkdtempSync, writeFileSync } from "node:fs";
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
      `npx vitest run ${file} --reporter=verbose`,
      `npx jest ${file}`,
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
    expect(runnableVerifierCommand(`npx vitest run ${file}`, file)).toBe(`npx vitest run ${file}`);
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
      "npx vitest run",
    );
    expect(
      testRunnerHint(project({ "package.json": '{"devDependencies":{"vitest":"^3"}}', "bun.lock": "" }), ["a.ts"]),
    ).toContain("bunx vitest run");
    expect(testRunnerHint(project({ "package.json": '{"scripts":{"test":"bun test"}}' }), ["a.ts"])).toContain(
      "bun test ./<file>",
    );
    expect(testRunnerHint(project({ "package.json": '{"name":"plain"}' }), ["a.js"])).toContain("node --test");
    expect(testRunnerHint(project({ "pyproject.toml": "[tool.pytest.ini_options]\n" }), ["calc.py"])).toContain(
      "python -m pytest",
    );
    expect(testRunnerHint(project({}), ["tool.py"])).toContain("unittest");
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
    expect(ranNoTest("(fail) slugify > removes trailing hyphens\n 2 pass\n 1 fail")).toBe(false);
  });
});
