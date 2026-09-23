import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { openDatabase } from "../db";
import { type LogLine, type LogSink, setLogSink } from "../log";
import { handle } from "./router";

const now = new Date("2026-09-01T10:00:00.000Z");
const lines: LogLine[] = [];
let previousSink: LogSink;

beforeAll(() => {
  previousSink = setLogSink((line) => lines.push(line));
});

afterAll(() => {
  setLogSink(previousSink);
});

afterEach(() => {
  lines.length = 0;
});

describe("users", () => {
  it("creates a user and reads it back", () => {
    const db = openDatabase();
    const created = handle(
      db,
      { method: "POST", path: "/users", body: { name: "Ada", email: "ada@example.com" } },
      now,
    );
    expect(created.status).toBe(201);
    const user = { id: 1, name: "Ada", email: "ada@example.com", created_at: now.toISOString() };
    expect(created.body).toMatchObject(user);
    expect(handle(db, { method: "GET", path: "/users/1" }, now).body).toMatchObject(user);
    const listed = handle(db, { method: "GET", path: "/users" }, now).body as unknown[];
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject(user);
    expect(lines.map((line) => line.event)).toContain("user.created");
  });

  it("rejects a user without a name or a valid email, and a registered email", () => {
    const db = openDatabase();
    expect(handle(db, { method: "POST", path: "/users", body: { email: "ada@example.com" } }, now).status).toBe(400);
    expect(handle(db, { method: "POST", path: "/users", body: { name: "Ada", email: "ada" } }, now).status).toBe(400);
    handle(db, { method: "POST", path: "/users", body: { name: "Ada", email: "ada@example.com" } }, now);
    const again = handle(db, { method: "POST", path: "/users", body: { name: "Ada", email: "ada@example.com" } }, now);
    expect(again.status).toBe(409);
  });

  it("answers 404 for a user that does not exist", () => {
    expect(handle(openDatabase(), { method: "GET", path: "/users/7" }, now).status).toBe(404);
  });
});
