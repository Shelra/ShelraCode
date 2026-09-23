import { describe, expect, it } from "bun:test";
import { findUser, listUsers } from "./users";

describe("users", () => {
  it("finds a user by id", () => {
    expect(findUser("u2")).toEqual({ id: "u2", name: "Grace" });
    expect(findUser("u9")).toBeUndefined();
  });

  it("lists every user", () => {
    expect(listUsers().map((user) => user.id)).toEqual(["u1", "u2"]);
  });
});
