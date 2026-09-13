// Excluded from `bun run test` (see package.json) — same `bun:sqlite` entry-point resolution
// limitation as `src/storage/objectives.test.ts` and `sessions.test.ts`. Run via
// `bun test src/tools/checkpoint.test.ts` instead (see the note there).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase } from "../storage/db";
import { recordCheckpoint } from "../storage/objectives";
import { ensureWorkspace } from "../storage/workspaces";
import { revertLatestCheckpoint } from "./checkpoint";

let homeDir: string;
let workspaceDir: string;
let originalHome: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "shelra-checkpoint-home-"));
  workspaceDir = mkdtempSync(join(tmpdir(), "shelra-checkpoint-ws-"));
  originalHome = process.env.HOME;
  process.env.HOME = homeDir;
  closeDatabase();
});

afterEach(() => {
  closeDatabase();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(homeDir, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe("revertLatestCheckpoint", () => {
  it("reports no checkpoint for a file that was never snapshotted", () => {
    const result = revertLatestCheckpoint("untouched.ts", workspaceDir, ensureWorkspace(workspaceDir).id);
    expect(result.success).toBe(false);
    expect(result.output).toContain("No checkpoint found");
  });

  it("restores a file's prior content from an edit checkpoint", () => {
    const full = join(workspaceDir, "clock.ts");
    writeFileSync(full, "export const time = 'now';", "utf-8");
    const wsId = ensureWorkspace(workspaceDir).id;
    recordCheckpoint({
      sessionId: null,
      objectiveId: null,
      workspaceId: wsId,
      filePath: "clock.ts",
      previousContent: "export const time = 'before edit';",
      previousExisted: true,
      reason: "pre-edit",
    });

    const result = revertLatestCheckpoint("clock.ts", workspaceDir, wsId);
    expect(result.success).toBe(true);
    expect(readFileSync(full, "utf-8")).toBe("export const time = 'before edit';");
  });

  it("deletes a file that was created after its checkpoint (previousExisted=false)", () => {
    const full = join(workspaceDir, "new-file.ts");
    writeFileSync(full, "export const x = 1;", "utf-8");
    const wsId = ensureWorkspace(workspaceDir).id;
    recordCheckpoint({
      sessionId: null,
      objectiveId: null,
      workspaceId: wsId,
      filePath: "new-file.ts",
      previousContent: null,
      previousExisted: false,
      reason: "pre-write",
    });

    const result = revertLatestCheckpoint("new-file.ts", workspaceDir, wsId);
    expect(result.success).toBe(true);
    expect(existsSync(full)).toBe(false);
  });

  it("reverts using the most recent checkpoint when a file was mutated more than once", () => {
    const full = join(workspaceDir, "layered.ts");
    writeFileSync(full, "v3", "utf-8");
    const wsId = ensureWorkspace(workspaceDir).id;
    recordCheckpoint({
      sessionId: null,
      objectiveId: null,
      workspaceId: wsId,
      filePath: "layered.ts",
      previousContent: null,
      previousExisted: false,
      reason: "pre-write",
    });
    recordCheckpoint({
      sessionId: null,
      objectiveId: null,
      workspaceId: wsId,
      filePath: "layered.ts",
      previousContent: "v1",
      previousExisted: true,
      reason: "pre-edit",
    });
    recordCheckpoint({
      sessionId: null,
      objectiveId: null,
      workspaceId: wsId,
      filePath: "layered.ts",
      previousContent: "v2",
      previousExisted: true,
      reason: "pre-edit",
    });

    const result = revertLatestCheckpoint("layered.ts", workspaceDir, wsId);
    expect(result.success).toBe(true);
    expect(readFileSync(full, "utf-8")).toBe("v2");
  });
});
