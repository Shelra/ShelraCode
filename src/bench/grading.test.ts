import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gradeWorkspace } from "./grading";
import type { BenchmarkTaskDefinition } from "./types";

let root: string;
let workspace: string;
let oracle: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shelra-grading-test-"));
  workspace = join(root, "project");
  oracle = join(root, "expectations");
  mkdirSync(workspace);
  mkdirSync(oracle);
  writeFileSync(join(workspace, "main.ts"), "export const total = 20;\n");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
function task(): BenchmarkTaskDefinition {
  return {
    id: "frozen-candidate",
    category: "coding",
    difficulty: "test",
    workspace,
    prompt: "Return twenty.",
    acceptanceCriteria: [
      {
        id: "oracle",
        description: "Total is twenty",
        check: { kind: "command_succeeds", command: "bun run {{benchmarkRoot}}/oracle.ts", timeoutMs: 30_000 },
      },
    ],
  };
}
const options = () => ({ benchmarkRoot: oracle, harness: "offline-test", emit: () => {} });

describe("grading without modifying the project to be continued", () => {
  it("runs a real Bun oracle that restores a test only in the private copy", async () => {
    writeFileSync(
      join(oracle, "oracle.ts"),
      `import { readFileSync, writeFileSync } from 'node:fs';
      if (!readFileSync('main.ts', 'utf8').includes('20')) process.exit(1);
      writeFileSync('main.ts', '// restored expected test\n');`.replace("test\n", "test\\n"),
    );
    const grade = await gradeWorkspace(task(), workspace, options());
    expect(grade.verified).toBe(true);
    expect(grade.evaluation).toMatchObject({
      mode: "private-copy",
      processIsolation: process.platform === "win32" ? "windows-appcontainer" : "unavailable",
    });
    expect(readFileSync(join(workspace, "main.ts"), "utf8")).toBe("export const total = 20;\n");
    // A subsequent task receives the candidate Shelra produced, without the grader's restoration.
    const followup = task();
    followup.acceptanceCriteria = [
      {
        id: "original",
        description: "Original candidate retained",
        check: { kind: "file_contains", path: "main.ts", pattern: "export const total = 20" },
      },
    ];
    expect((await gradeWorkspace(followup, workspace, options())).verified).toBe(true);
  }, 40_000);

  it("invalidates an oracle that overwrites its own frozen expectations despite exit zero", async () => {
    const content =
      "import { writeFileSync } from 'node:fs'; writeFileSync(import.meta.path, '// forged expectation');\n";
    writeFileSync(join(oracle, "oracle.ts"), content);
    const grade = await gradeWorkspace(task(), workspace, options());
    expect(grade.verified).toBe(false);
    if (process.platform === "win32") {
      // The real OS refuses the write before there is any integrity drift to detect.
      expect(grade.report?.blocked).toEqual([]);
      expect(grade.acceptance[0].detail).toMatch(/EACCES|EPERM/u);
      expect(grade.evaluation?.processIsolation).toBe("windows-appcontainer");
    } else {
      expect(grade.report?.blocked).toEqual(["oracle"]);
      expect(grade.acceptance[0].detail).toContain("expectations changed");
    }
    expect(readFileSync(join(oracle, "oracle.ts"), "utf8")).toBe(content);
  }, 40_000);

  it("does not pass inherited host secrets to the actual command process", async () => {
    vi.stubEnv("SHELRA_GRADING_TEST_SECRET", "dummy-secret");
    vi.stubEnv("SHELRA_TOKEN", "dummy-token");
    writeFileSync(
      join(oracle, "oracle.ts"),
      `if (process.env.SHELRA_GRADING_TEST_SECRET || process.env.SHELRA_TOKEN) process.exit(1);
      if (!process.env.HOME?.includes('shelra-grade-') || !process.env.TEMP?.includes('shelra-grade-')) process.exit(2);`,
    );
    expect((await gradeWorkspace(task(), workspace, options())).verified).toBe(true);
  }, 40_000);

  it("keeps failed and unavailable criteria separate from success", async () => {
    writeFileSync(join(oracle, "oracle.ts"), "process.exit(1);\n");
    const grade = await gradeWorkspace(task(), workspace, options());
    expect(grade.verified).toBe(false);
    expect(grade.report?.blocked).toEqual([]);
    expect(grade.acceptance[0].status).toBe("failed");
    const unavailable = await gradeWorkspace(task(), join(root, "missing"), options());
    expect(unavailable.verified).toBe(false);
    expect(unavailable.report?.blocked).toEqual(["oracle"]);
    expect(unavailable.evaluation).toBeUndefined();
  }, 40_000);
});
