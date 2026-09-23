import { describe, expect, it } from "bun:test";
import { openDatabase } from "./db";
import { createUser, getUser } from "./users";

describe("users", () => {
  it("creates a user and reads it back", () => {
    const db = openDatabase();
    const user = createUser(db, { email: "ada@example.com", name: "Ada" });
    expect(user).toMatchObject({ email: "ada@example.com", name: "Ada" });
    expect(getUser(db, user.id)).toMatchObject({ email: "ada@example.com", name: "Ada" });
    expect(getUser(db, 999)).toBeUndefined();
  });

  it("refuses a second user with the same email", () => {
    const db = openDatabase();
    createUser(db, { email: "ada@example.com", name: "Ada" });
    expect(() => createUser(db, { email: "ada@example.com", name: "Ada again" })).toThrow();
  });
});
