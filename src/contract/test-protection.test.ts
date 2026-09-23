import { describe, expect, it } from "vitest";
import { isTestFile, requestAllowsTestEdits } from "./test-protection";

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
