import { describe, expect, it } from "bun:test";
import { openDatabase } from "./db";
import { getUser, listUsers } from "./users";

describe("users", () => {
  it("reads users and lists them in id order", () => {
    const db = openDatabase();
    expect(getUser(db, 1)).toEqual({ id: 1, email: "ada@example.com", name: "Ada" });
    expect(listUsers(db).map((user) => user.name)).toEqual(["Ada", "Grace", "Alan"]);
  });
});
