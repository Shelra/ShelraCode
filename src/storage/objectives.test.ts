// Excluded from `bun run test` (see package.json) alongside `sessions.test.ts`: this file's
// import graph reaches `db.ts`'s top-level `bun:sqlite` import as its own entry point, which
// vitest (even via `bunx vitest run` invoked through `bun run`) cannot resolve on this
// Windows/fork-pool combination — the same limitation that already forced `sessions.test.ts`
// out of the automated suite. Verified working alternative: `bun test src/storage/objectives.test.ts`
// (Bun's own test runner, which has native `bun:sqlite` support and vitest-API compatibility).
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase } from "./db";
import {
  getLatestCheckpoint,
  getLatestObjectiveForSession,
  getObjectiveById,
  listCheckpointsForSession,
  listObjectiveTasks,
  recordCheckpoint,
  upsertObjectiveIndex,
  upsertObjectiveTask,
} from "./objectives";
import { SessionStore } from "./sessions";
import { ensureWorkspace } from "./workspaces";

/**
 * Redirects the product user dir to a throwaway HOME so these tests never touch the real
 * `~/.shelra/shelra.db` (that shared file is why `sessions.test.ts` is excluded from the
 * normal suite — this file avoids the same trap by isolating state per test instead).
 */
let homeDir: string;
let originalHome: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "shelra-objectives-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = homeDir;
  closeDatabase();
});

afterEach(() => {
  closeDatabase();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(homeDir, { recursive: true, force: true });
});

function workspaceId(): string {
  return ensureWorkspace(homeDir).id;
}

/**
 * `objectives.session_id` and `checkpoints.session_id`/`objective_id` are real foreign keys
 * (`PRAGMA foreign_keys = ON` in `db.ts`) — a fabricated id string is correctly rejected, so
 * any test that needs a session/objective to actually correlate against must create one first.
 */
function realSessionId(): string {
  return new SessionStore(homeDir).createSession("test-model", "agent", homeDir).id;
}

describe("objective index", () => {
  it("round-trips an objective and updates phase/blocker on conflict", () => {
    const wsId = workspaceId();
    upsertObjectiveIndex({
      id: "obj-1",
      sessionId: null,
      workspaceId: wsId,
      request: "Build a digital clock",
      phase: "planning",
      runDir: "/tmp/run-1",
    });

    let record = getObjectiveById("obj-1");
    expect(record?.phase).toBe("planning");
    expect(record?.request).toBe("Build a digital clock");
    expect(record?.runDir).toBe("/tmp/run-1");

    upsertObjectiveIndex({
      id: "obj-1",
      sessionId: null,
      workspaceId: wsId,
      request: "Build a digital clock",
      phase: "blocked",
      blocker: "Stop hook declined completion",
      runDir: "/tmp/run-1",
    });

    record = getObjectiveById("obj-1");
    expect(record?.phase).toBe("blocked");
    expect(record?.blocker).toBe("Stop hook declined completion");
  });

  it("supports a null runDir for lightweight chat-turn objectives", () => {
    const wsId = workspaceId();
    upsertObjectiveIndex({
      id: "obj-chat",
      sessionId: null,
      workspaceId: wsId,
      request: "Fix the flaky test",
      phase: "review",
    });

    const record = getObjectiveById("obj-chat");
    expect(record?.runDir).toBeNull();
  });

  it("answers 'what is this session doing' with the most recently updated objective", async () => {
    const wsId = workspaceId();
    const sid = realSessionId();
    upsertObjectiveIndex({ id: "obj-old", sessionId: sid, workspaceId: wsId, request: "first", phase: "plan" });
    await new Promise((r) => setTimeout(r, 5));
    upsertObjectiveIndex({
      id: "obj-new",
      sessionId: sid,
      workspaceId: wsId,
      request: "second",
      phase: "review",
    });

    const latest = getLatestObjectiveForSession(sid);
    expect(latest?.id).toBe("obj-new");
  });

  it("returns null for a session with no objectives", () => {
    expect(getLatestObjectiveForSession("no-such-session")).toBeNull();
  });
});

describe("objective tasks", () => {
  it("round-trips a task and updates status/attempts on conflict", () => {
    const wsId = workspaceId();
    upsertObjectiveIndex({
      id: "obj-tasks",
      sessionId: null,
      workspaceId: wsId,
      request: "req",
      phase: "implementing",
    });
    upsertObjectiveTask("obj-tasks", {
      id: "task-1",
      description: "Write the clock markup",
      satisfies: ["AC-1"],
      status: "pending",
      attempts: 0,
    });

    let tasks = listObjectiveTasks("obj-tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("pending");

    upsertObjectiveTask("obj-tasks", {
      id: "task-1",
      description: "Write the clock markup",
      satisfies: ["AC-1"],
      status: "done",
      attempts: 1,
    });

    tasks = listObjectiveTasks("obj-tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("done");
    expect(tasks[0]?.attempts).toBe(1);
  });
});

describe("checkpoints", () => {
  it("records and retrieves the latest checkpoint for a file", () => {
    const wsId = workspaceId();
    recordCheckpoint({
      sessionId: null,
      objectiveId: null,
      workspaceId: wsId,
      filePath: "src/clock.ts",
      previousContent: "old content",
      previousExisted: true,
      reason: "pre-edit",
    });
    recordCheckpoint({
      sessionId: null,
      objectiveId: null,
      workspaceId: wsId,
      filePath: "src/clock.ts",
      previousContent: "newer-old content",
      previousExisted: true,
      reason: "pre-edit",
    });

    const latest = getLatestCheckpoint(wsId, "src/clock.ts");
    expect(latest?.previousContent).toBe("newer-old content");
    expect(latest?.previousExisted).toBe(true);
  });

  it("records previousExisted=false for a checkpoint before a file was created", () => {
    const wsId = workspaceId();
    upsertObjectiveIndex({ id: "obj-5", sessionId: null, workspaceId: wsId, request: "req", phase: "implementing" });
    recordCheckpoint({
      sessionId: null,
      objectiveId: "obj-5",
      workspaceId: wsId,
      filePath: "src/new-file.ts",
      previousContent: null,
      previousExisted: false,
      reason: "pre-write",
    });

    const latest = getLatestCheckpoint(wsId, "src/new-file.ts");
    expect(latest?.previousExisted).toBe(false);
    expect(latest?.previousContent).toBeNull();
    expect(latest?.objectiveId).toBe("obj-5");
  });

  it("returns null when no checkpoint exists for a path", () => {
    const wsId = workspaceId();
    expect(getLatestCheckpoint(wsId, "src/never-touched.ts")).toBeNull();
  });

  it("lists checkpoints for a session in most-recent-first order", () => {
    const wsId = workspaceId();
    const sid = realSessionId();
    recordCheckpoint({
      sessionId: sid,
      objectiveId: null,
      workspaceId: wsId,
      filePath: "a.ts",
      previousContent: "a",
      previousExisted: true,
      reason: "pre-edit",
    });
    recordCheckpoint({
      sessionId: sid,
      objectiveId: null,
      workspaceId: wsId,
      filePath: "b.ts",
      previousContent: null,
      previousExisted: false,
      reason: "pre-write",
    });

    const checkpoints = listCheckpointsForSession(sid);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]?.filePath).toBe("b.ts");
    expect(checkpoints[1]?.filePath).toBe("a.ts");
  });
});
