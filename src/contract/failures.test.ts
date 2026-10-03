import { describe, expect, it } from "vitest";
import { describeFailures, failureSignature, failuresWithin, parseFailures } from "./failures";

// Real outputs, captured 2026-09-23 (bun 1.4.1, vitest 4.1.0, tsc 5), with paths shortened.
const BUN = `bun test v1.4.1 (4661e494f)

src\\slug.test.ts:
4 |   test("trims whitespace", () => {
5 |     expect(slugify("  A b ")).toBe("a-b");
                                  ^
error: expect(received).toBe(expected)

Expected: "a-b"
Received: "  a b "

      at <anonymous> (C:\\work\\app\\src\\slug.test.ts:5:31)
(fail) slugify > trims whitespace [0.33ms]
(pass) slugify > keeps digits [0.05ms]

 1 pass
 1 fail
Ran 2 tests across 1 file. [33.00ms]`;

const VITEST = ` FAIL  src/x.test.ts > slugify > trims whitespace
AssertionError: expected 'ax' to be 'a' // Object.is equality

Expected: "a"
Received: "ax"

 ❯ src/x.test.ts:4:32
      2| describe("slugify", () => {`;

const TSC = `src/bad.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.
src/bad.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'.`;

const PYTEST = `=========================== short test summary info ============================
FAILED tests/test_slug.py::test_trims - AssertionError: assert '  a ' == 'a'
FAILED tests/test_slug.py::test_digits
========================= 2 failed, 3 passed in 0.12s =========================`;

const JEST = `  ● slugify › trims whitespace

    expect(received).toBe(expected) // Object.is equality

    Expected: "a"
    Received: " a "

      at Object.<anonymous> (src/slug.test.js:5:31)`;

describe("parseFailures", () => {
  it("reads Bun's failures with the error, the values and the location", () => {
    expect(parseFailures(BUN)).toEqual([
      {
        name: "slugify > trims whitespace",
        location: "C:\\work\\app\\src\\slug.test.ts:5:31",
        // One line: runs of whitespace collapse, inside the values too.
        message: 'error: expect(received).toBe(expected) Expected: "a-b" Received: " a b "',
      },
    ]);
  });

  it("reads Vitest, TypeScript, pytest and Jest", () => {
    expect(parseFailures(VITEST)).toEqual([
      {
        name: "slugify > trims whitespace",
        location: "src/x.test.ts:4:32",
        message: "AssertionError: expected 'ax' to be 'a' // Object.is equality",
      },
    ]);
    expect(parseFailures(TSC).map((failure) => [failure.name, failure.location])).toEqual([
      ["TS2322", "src/bad.ts:1:7"],
      ["TS2322", "src/bad.ts:2:14"],
    ]);
    expect(parseFailures(PYTEST).map((failure) => [failure.name, failure.location])).toEqual([
      ["test_trims", "tests/test_slug.py"],
      ["test_digits", "tests/test_slug.py"],
    ]);
    expect(parseFailures(JEST)[0]).toMatchObject({
      name: "slugify › trims whitespace",
      location: "src/slug.test.js:5:31",
    });
  });

  it("recognizes nothing in output it does not know", () => {
    expect(parseFailures("make: *** [Makefile:3: test] Error 2")).toEqual([]);
  });
});

describe("describeFailures", () => {
  it("lists failures one per line, or falls back to the output's last lines", () => {
    expect(describeFailures(TSC)).toContain("TS2322 (src/bad.ts:1:7) — Type 'string' is not assignable");
    expect(describeFailures("line 1\nline 2\nfatal: something broke")).toBe("line 1\nline 2\nfatal: something broke");
  });
});

describe("failureSignature", () => {
  it("is the same for the same failures whatever the timings and positions", () => {
    const again = BUN.replace("[0.33ms]", "[1.91ms]").replace("33.00ms", "41.00ms");
    expect(failureSignature(again)).toBe(failureSignature(BUN));
    expect(failureSignature(VITEST)).not.toBe(failureSignature(BUN));
  });
});

describe("failuresWithin", () => {
  const before = "(fail) connects to the database [1.00ms]\n(fail) reads the config [2.00ms]\n 3 pass\n 2 fail\n";

  it("holds when every failure now was already there before the change", () => {
    expect(failuresWithin(before, before)).toBe(true);
    expect(failuresWithin("(fail) connects to the database [3.00ms]\n 4 pass\n 1 fail\n", before)).toBe(true);
  });

  it("does not hold for a new failure, or for anything it cannot compare in full (review 2026-10-03)", () => {
    expect(failuresWithin(`${before}(fail) formats the clock [1.00ms]\n`, before)).toBe(false);
    // Output nothing parses is never "within", even when it reads the same ("Found 6 errors" against 7).
    expect(failuresWithin("Segmentation fault", "Segmentation fault")).toBe(false);
    // A list cut at the parser's limit may hide a new failure past it.
    const many = Array.from({ length: 13 }, (_, index) => `(fail) case ${index} [1.00ms]`).join("\n");
    expect(failuresWithin(`${many}\n(fail) a new one [1.00ms]\n`, many)).toBe(false);
    // A summary that counts more than before has something the parser did not read (a pytest collection error).
    expect(failuresWithin(before.replace(" 2 fail", " 2 fail\n 1 error"), before)).toBe(false);
  });
});
