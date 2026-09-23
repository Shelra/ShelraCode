import { describe, expect, it } from "bun:test";
import { openDatabase } from "./db";
import { getUser, getUserByEmail } from "./users";

describe("users", () => {
  it("reads a user by id and by email", () => {
    const db = openDatabase();
    expect(getUser(db, 2)).toEqual({ id: 2, name: "Grace Hopper", email: "grace@example.com" });
    expect(getUserByEmail(db, "alan@example.com")?.name).toBe("Alan Turing");
    expect(getUser(db, 99)).toBeUndefined();
  });
});
