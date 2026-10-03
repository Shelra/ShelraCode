import { describe, expect, it } from "vitest";
import { importCandidates, isTestFile, originalTestToRun, requestAllowsTestEdits } from "./test-protection";

describe("isTestFile", () => {
  it("knows the common runners' test files and nothing else", () => {
    for (const path of [
      "src/slug.test.ts",
      "src/app.spec.tsx",
      "tests/test_app.py",
      "pkg/parse_test.go",
      "__tests__/a.js",
      "test/helpers.js",
      "spec/models/user_spec.rb",
      "src\\windows.test.ts",
    ]) {
      expect(isTestFile(path), path).toBe(true);
    }
    for (const path of ["src/slug.ts", "src/testing.ts", "README.md", "src/contest/entry.ts"]) {
      expect(isTestFile(path), path).toBe(false);
    }
  });
});

describe("requestAllowsTestEdits", () => {
  it("follows an explicit prohibition, even next to words that would allow edits", () => {
    expect(requestAllowsTestEdits("Implement slugify. Do not modify tests. Run bun test before completing.")).toBe(
      false,
    );
    expect(requestAllowsTestEdits("Fix the parser but never touch the existing tests.")).toBe(false);
    expect(requestAllowsTestEdits("Arregla el parser y no modifiques las pruebas.")).toBe(false);
  });

  it("allows edits only when the request asks for them", () => {
    expect(requestAllowsTestEdits("Update the tests for the new date format.")).toBe(true);
    expect(requestAllowsTestEdits("The parser test is wrong; make it match the spec.")).toBe(true);
    expect(requestAllowsTestEdits("Corrige las pruebas del parser.")).toBe(true);
    expect(requestAllowsTestEdits("Make the failing build pass.")).toBe(false);
    expect(requestAllowsTestEdits("Add a feature that exports CSV.")).toBe(false);
  });
});

describe("the original of a test a turn changed, when the change only added to it", () => {
  const BEFORE = [
    "import { expect, test } from 'bun:test';",
    "import { slugify } from './slug';",
    "",
    "test('trims', () => {",
    "  expect(slugify(' A ')).toBe('a');",
    "});",
    "",
  ].join("\n");
  const nothingExists = () => false;

  it("runs the original as it was when the turn only added cases", () => {
    const after = `${BEFORE}test('hyphens', () => {\n  expect(slugify('a b')).toBe('a-b');\n});\n`;
    expect(originalTestToRun(BEFORE, after, "src/slug.test.ts", nothingExists)).toEqual({
      original: BEFORE,
      movedImports: [],
    });
  });

  it("refuses a change to an assertion, a removed case or a skipped one", () => {
    for (const after of [
      BEFORE.replace("toBe('a')", "toBe(' a ')"),
      BEFORE.replace("  expect(slugify(' A ')).toBe('a');\n", ""),
      BEFORE.replace("test('trims'", "test.skip('trims'"),
    ]) {
      expect(originalTestToRun(BEFORE, after, "src/slug.test.ts", nothingExists)).toEqual({
        refused: "it removed or rewrote a line of the test",
      });
    }
  });

  it("follows a module that moved, with the original's assertions and the new import", () => {
    const after = BEFORE.replace("from './slug'", "from './text/slug'");
    const result = originalTestToRun(BEFORE, after, "src/slug.test.ts", (path) => path === "src/text/slug.ts");
    expect(result).toEqual({
      original: after,
      movedImports: ["import { slugify } from './slug';"],
    });
  });

  it("refuses an import re-pointed away from a module that is still there", () => {
    const after = BEFORE.replace("from './slug'", "from './fake-slug'");
    expect(originalTestToRun(BEFORE, after, "src/slug.test.ts", (path) => path === "src/slug.ts")).toEqual({
      refused: "it re-pointed an import whose module is still there (`import { slugify } from './slug';`)",
    });
    const framework = BEFORE.replace("from 'bun:test'", "from 'vitest'");
    expect(originalTestToRun(BEFORE, framework, "src/slug.test.ts", nothingExists)).toEqual({
      refused: "it changed an import that is not a moved file (`import { expect, test } from 'bun:test';`)",
    });
  });

  it("knows where a Python import pointed", () => {
    expect(importCandidates("from app.slug import slugify", "tests/test_slug.py")).toEqual([
      "app/slug.py",
      "app/slug/__init__.py",
      "src/app/slug.py",
      "src/app/slug/__init__.py",
    ]);
    expect(importCandidates("from .slug import slugify", "app/tests/test_slug.py")).toEqual([
      "app/tests/slug.py",
      "app/tests/slug/__init__.py",
    ]);
    expect(importCandidates("import os", "tests/test_x.py")).toEqual([
      "os.py",
      "os/__init__.py",
      "src/os.py",
      "src/os/__init__.py",
    ]);
    expect(importCandidates("import { a } from '../../../outside'", "src/a.test.ts")).toEqual([]);
  });
});
