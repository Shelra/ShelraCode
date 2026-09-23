import { describe, expect, it } from "bun:test";
import { getUserResponse } from "./api";

describe("GET /users/:id", () => {
  it("returns the user", () => {
    const response = getUserResponse("u1");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ user_id: "u1", display_name: "Ada" });
  });

  it("returns 404 for an unknown user", () => {
    expect(getUserResponse("u9")).toEqual({ status: 404, body: { error_code: "user_not_found" } });
  });
});
