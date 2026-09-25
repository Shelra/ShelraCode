import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "./db";
import { SessionStore } from "./sessions";
import { appendMessages } from "./transcript";

const originalHome = process.env.HOME;

describe("SessionStore recap persistence", () => {
  const tempRoot = path.join(process.cwd(), ".tmp-session-tests");
  let tempHome = "";
  let tempCwd = "";

  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    tempHome = fs.mkdtempSync(path.join(tempRoot, "shelra-session-home-"));
    tempCwd = fs.mkdtempSync(path.join(tempRoot, "shelra-session-cwd-"));
    process.env.HOME = tempHome;
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    closeDatabase();
  });

  afterEach(() => {
    closeDatabase();
    vi.restoreAllMocks();
    process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempCwd, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("stores and reloads the latest recap metadata with the session", () => {
    const store = new SessionStore(tempCwd);
    const session = store.createSession("test-model-a", "agent", tempCwd);
    const updatedAt = new Date("2026-04-22T15:00:00.000Z");

    store.setRecap(session.id, {
      text: "Migrated billing sessions to the new schema. Next step is wiring the prompt banner.",
      model: "test-model-b",
      updatedAt,
    });

    expect(store.getRequiredSession(session.id).recap).toEqual({
      text: "Migrated billing sessions to the new schema. Next step is wiring the prompt banner.",
      model: "test-model-b",
      updatedAt,
    });
  });

  it("clears recap metadata when the recap is removed", () => {
    const store = new SessionStore(tempCwd);
    const session = store.createSession("test-model-a", "agent", tempCwd);

    store.setRecap(session.id, {
      text: "Temporary recap",
      model: "test-model-b",
      updatedAt: new Date("2026-04-22T15:00:00.000Z"),
    });
    store.setRecap(session.id, null);

    expect(store.getRequiredSession(session.id).recap).toBeNull();
  });
  it("lists the conversations that hold a message, newest first, with the first request (owner, 2026-09-25)", () => {
    const store = new SessionStore(tempCwd);
    const older = store.createSession("m", "agent", tempCwd);
    appendMessages(older.id, [{ role: "user", content: "Create a kart racing game\nwith Three.js" }]);
    store.createSession("m", "agent", tempCwd); // opened, never used
    const newer = store.createSession("m", "agent", tempCwd);
    appendMessages(newer.id, [{ role: "user", content: [{ type: "text", text: "Fix the build" }] }]);
    store.setTitle(newer.id, "Build fix");

    const listed = store.listSessions();

    expect(listed.map((session) => session.id)).toEqual([newer.id, older.id]);
    expect(listed[0]).toMatchObject({ title: "Build fix", firstRequest: "Fix the build", messages: 1 });
    expect(listed[1]).toMatchObject({ title: null, firstRequest: "Create a kart racing game with Three.js" });
  });
});
