import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ContractRun } from "../contract/contract";
import { captureCheckerFiles } from "./checker-files";
import { IndependentCheckerBash, runIndependentCandidate } from "./independent-runner";

let root: string;
const testPath = ".shelra/verify/value.test.ts";
const command = `bun test ./${testPath}`;
const source = "export const value = 20;\n";
const oracle =
  "import { expect, test } from 'bun:test';\nimport { value } from '../../src/value';\ntest('amount', () => expect(value).toBe(20));\n";
const passed: ContractRun = { passed: true, output: "1 pass", durationMs: 1, state: "completed", exitCode: 0 };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shelra-private-check-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, ".shelra", "verify"), { recursive: true });
  writeFileSync(join(root, "src", "value.ts"), source);
  writeFileSync(join(root, testPath), oracle);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function files(): ReadonlyMap<string, string> {
  const result = captureCheckerFiles(root);
  if (!result.ok) throw new Error(result.reason);
  return result.files;
}

describe("independent checker private execution", () => {
  it("gives a trusted injected runner only the copied candidate and identifies its provenance", async () => {
    let candidate = "";
    const result = await runIndependentCandidate({
      workspace: root,
      command,
      files: files(),
      timeoutMs: 5000,
      runner: async (actual, options) => {
        expect(actual).toBe(command);
        candidate = options.cwd ?? "";
        expect(candidate).not.toBe(root);
        expect(readFileSync(join(candidate, "src", "value.ts"), "utf8")).toBe(source);
        expect(readFileSync(join(candidate, testPath), "utf8")).toBe(oracle);
        return passed;
      },
    });
    expect(result).toMatchObject({ run: passed, execution: "caller-runner" });
    expect(result.problem).toBeUndefined();
    expect(result.candidateFingerprint).toMatch(/^sha256:[a-f\d]{64}$/u);
    expect(existsSync(candidate)).toBe(false);
  });

  it("invalidates a successful test which changes private source, while preserving the live project", async () => {
    const result = await runIndependentCandidate({
      workspace: root,
      command,
      files: files(),
      timeoutMs: 5000,
      runner: async (_command, options) => {
        writeFileSync(join(options.cwd ?? "", "src", "value.ts"), "export const value = 0;\n");
        return passed;
      },
    });
    expect(result.problem).toContain("changed project files in its private copy: src/value.ts");
    expect(readFileSync(join(root, "src", "value.ts"), "utf8")).toBe(source);
  });

  it("invalidates a replaced private oracle even though the source snapshot excludes checker state", async () => {
    const result = await runIndependentCandidate({
      workspace: root,
      command,
      files: files(),
      timeoutMs: 5000,
      runner: async (_command, options) => {
        writeFileSync(join(options.cwd ?? "", testPath), "test('noop', () => {});\n");
        return passed;
      },
    });
    expect(result.problem).toContain("frozen oracle");
    expect(readFileSync(join(root, testPath), "utf8")).toBe(oracle);
  });

  it("refuses evidence if the original source changes while the candidate is running", async () => {
    await expect(
      runIndependentCandidate({
        workspace: root,
        command,
        files: files(),
        timeoutMs: 5000,
        runner: async () => {
          writeFileSync(join(root, "src", "value.ts"), "export const value = 30;\n");
          return passed;
        },
      }),
    ).rejects.toThrow(/source|candidate/iu);
  });

  it("runs the checker's bash through the same copy and refuses chained commands before executing", async () => {
    let calls = 0;
    const bash = new IndependentCheckerBash(root, async (_command, options) => {
      calls += 1;
      expect(options.cwd).not.toBe(root);
      writeFileSync(join(options.cwd ?? "", "src", "value.ts"), "export const value = 0;\n");
      return passed;
    });
    expect(await bash.execute(`${command}; echo fake`)).toMatchObject({ success: false, refused: "blocked" });
    expect(calls).toBe(0);
    expect(await bash.execute(command)).toMatchObject({
      success: false,
      error: expect.stringContaining("changed project files"),
    });
    expect(calls).toBe(1);
    expect(readFileSync(join(root, "src", "value.ts"), "utf8")).toBe(source);
  });

  it("never executes a fallback on the live project when the private runner is unavailable", async () => {
    let calls = 0;
    const bash = new IndependentCheckerBash(
      root,
      async () => {
        calls += 1;
        return passed;
      },
      "required sandbox unavailable",
    );
    expect(await bash.execute(command)).toMatchObject({
      success: false,
      refused: "blocked",
      error: expect.stringContaining("required sandbox unavailable"),
    });
    expect(calls).toBe(0);
  });

  it("rejects an incomplete oracle before invoking the runner", async () => {
    const expected = files();
    rmSync(join(root, testPath));
    let calls = 0;
    await expect(
      runIndependentCandidate({
        workspace: root,
        command,
        files: expected,
        timeoutMs: 5000,
        runner: async () => {
          calls += 1;
          return passed;
        },
      }),
    ).rejects.toThrow("private oracle is incomplete");
    expect(calls).toBe(0);
  });

  it("passes a real Bun test with relative source imports in its private candidate", async () => {
    const result = await runIndependentCandidate({ workspace: root, command, files: files(), timeoutMs: 10_000 });
    expect(result).toMatchObject({
      run: { passed: true, state: "completed", exitCode: 0 },
      execution: process.platform === "win32" ? "windows-appcontainer" : "private-copy",
    });
    expect(result.problem).toBeUndefined();
    expect(readFileSync(join(root, testPath), "utf8")).toBe(oracle);
    expect(readFileSync(join(root, "src", "value.ts"), "utf8")).toBe(source);
  }, 30_000);
});
