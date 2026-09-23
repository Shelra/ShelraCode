import { describe, expect, it } from "bun:test";
import { createReminder } from "./reminders";

describe("reminders", () => {
  it("creates a reminder due at the given time", () => {
    const reminder = createReminder("r1", "Call the bank", new Date("2026-09-23T16:00:00.000Z"));
    expect(reminder).toEqual({ id: "r1", text: "Call the bank", dueAt: "2026-09-23T16:00:00.000Z" });
  });
});
