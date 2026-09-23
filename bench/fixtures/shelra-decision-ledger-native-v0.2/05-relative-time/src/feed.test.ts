import { describe, expect, it } from "bun:test";
import { formatActivity } from "./feed";

describe("activity feed", () => {
  it("names the actor and the action", () => {
    const line = formatActivity({ actor: "Ada", action: "opened the report", at: new Date("2026-09-20T10:00:00Z") });
    expect(line.startsWith("Ada opened the report")).toBe(true);
  });
});
