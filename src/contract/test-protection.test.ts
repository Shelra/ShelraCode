import { describe, expect, it } from "vitest";
import {
  deletedWithItsCode,
  importCandidates,
  isTestFile,
  originalTestToRun,
  requestAllowsTestEdits,
} from "./test-protection";

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
  /** The project's own slug module, as it was when the turn began. */
  const slugWas = (path: string) => path === "src/slug.ts";

  it("runs the original as it was when the turn only added cases", () => {
    const after = `${BEFORE}test('hyphens', () => {\n  expect(slugify('a b')).toBe('a-b');\n});\n`;
    expect(originalTestToRun(BEFORE, after, "src/slug.test.ts", nothingExists, slugWas)).toEqual({
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
      expect(originalTestToRun(BEFORE, after, "src/slug.test.ts", nothingExists, slugWas)).toEqual({
        refused: "it removed or rewrote a line of the test",
      });
    }
  });

  it("refuses added lines that skip or cut short a kept test (review 2026-10-03)", () => {
    for (const line of ["return;", "/*", "if (false) {"]) {
      const after = BEFORE.replace("test('trims', () => {", `test('trims', () => {\n  ${line}`);
      expect(originalTestToRun(BEFORE, after, "src/slug.test.ts", nothingExists, slugWas)).toEqual({
        refused: `it added a line that can skip or cut short a test (\`${line}\`)`,
      });
    }
    // Python: asserts moved under an inserted `if False:` are rewritten lines, not kept ones.
    const py = "from app.slug import slugify\n\ndef test_trims():\n    assert slugify(' A ') == 'a'\n";
    const hidden =
      "from app.slug import slugify\n\ndef test_trims():\n    if False:\n        assert slugify(' A ') == 'a'\n";
    expect(originalTestToRun(py, hidden, "tests/test_slug.py", nothingExists, () => true)).toEqual({
      refused: "it removed or rewrote a line of the test",
    });
  });

  it("follows a module that moved, with the original's assertions and the new import", () => {
    const after = BEFORE.replace("from './slug'", "from './text/slug'");
    const result = originalTestToRun(BEFORE, after, "src/slug.test.ts", (path) => path === "src/text/slug.ts", slugWas);
    expect(result).toEqual({
      original: after,
      movedImports: ["import { slugify } from './slug';"],
    });
  });

  it("re-points only the import line of a multi-line import, and never at a stub nobody had (review 2026-10-03)", () => {
    const multi =
      "import {\n  slugify,\n} from './slug';\n\ntest('trims', () => {\n  expect(slugify(' A ')).toBe('a');\n});\n";
    const moved = multi.replace("from './slug'", "from './text/slug'");
    expect(
      originalTestToRun(
        multi,
        `${moved}test('x', () => {});\n`,
        "src/slug.test.ts",
        (path) => path === "src/text/slug.ts",
        slugWas,
      ),
    ).toEqual({ original: moved, movedImports: ["} from './slug';"] });
    // A module that never existed did not move: re-pointing its import at a fake is a rewrite.
    const fake = BEFORE.replace("from './slug'", "from './fakes/slug'");
    expect(originalTestToRun(BEFORE, fake, "src/slug.test.ts", nothingExists, nothingExists)).toEqual({
      refused: "it changed an import that is not a moved file of the project (`import { slugify } from './slug';`)",
    });
  });

  it("refuses an import re-pointed away from a module that is still there", () => {
    const after = BEFORE.replace("from './slug'", "from './fake-slug'");
    expect(originalTestToRun(BEFORE, after, "src/slug.test.ts", (path) => path === "src/slug.ts", slugWas)).toEqual({
      refused: "it re-pointed an import whose module is still there (`import { slugify } from './slug';`)",
    });
    const framework = BEFORE.replace("from 'bun:test'", "from 'vitest'");
    expect(originalTestToRun(BEFORE, framework, "src/slug.test.ts", nothingExists, slugWas)).toEqual({
      refused:
        "it changed an import that is not a moved file of the project (`import { expect, test } from 'bun:test';`)",
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

describe("a test deleted with the code it tested", () => {
  const before = "import { expect, test } from 'bun:test';\nimport { monthly } from '../src/report-monthly';\n";
  const was = (path: string) => path === "src/report-monthly.ts";

  it("stands when the request removes something and the project module it imported is gone", () => {
    expect(
      deletedWithItsCode(
        "We no longer want the monthly report.",
        before,
        "test/report-monthly.test.ts",
        () => false,
        was,
      ),
    ).toBe(true);
    expect(
      deletedWithItsCode("Elimina el informe mensual.", before, "test/report-monthly.test.ts", () => false, was),
    ).toBe(true);
  });

  it("does not when the code is still there, the request removes nothing, or the test imported nothing of the project", () => {
    expect(deletedWithItsCode("Remove the monthly report.", before, "test/report-monthly.test.ts", was, was)).toBe(
      false,
    );
    expect(deletedWithItsCode("Speed up the report.", before, "test/report-monthly.test.ts", () => false, was)).toBe(
      false,
    );
    expect(
      deletedWithItsCode(
        "Remove the old checks.",
        "import { test } from 'bun:test';\n",
        "test/a.test.ts",
        () => false,
        was,
      ),
    ).toBe(false);
  });
});
