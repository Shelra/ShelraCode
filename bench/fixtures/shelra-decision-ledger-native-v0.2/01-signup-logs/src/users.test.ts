import { beforeEach, describe, expect, it } from "bun:test";
import { findByEmail, resetUsers, signUp } from "./users";

beforeEach(() => resetUsers());

describe("signUp", () => {
  it("creates a user with a normalized email", () => {
    const result = signUp({ email: " Ada@Example.com ", name: "Ada" });
    expect(result).toEqual({ ok: true, user: { id: "u1", email: "ada@example.com", name: "Ada" } });
    expect(findByEmail("ADA@example.com")?.id).toBe("u1");
  });

  it("refuses an invalid email", () => {
    expect(signUp({ email: "nope", name: "Nobody" })).toEqual({ ok: false, reason: "invalid-email" });
  });

  it("refuses an email that is already registered", () => {
    signUp({ email: "ada@example.com", name: "Ada" });
    expect(signUp({ email: "ada@example.com", name: "Ada again" })).toEqual({ ok: false, reason: "email-taken" });
  });
});
