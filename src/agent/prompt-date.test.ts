import { describe, expect, it } from "vitest";
import { todayLine } from "./prompt-date";

describe("todayLine", () => {
  it("states the local date and weekday, so the current year never reads as the future", () => {
    expect(todayLine(new Date(2026, 8, 22, 23, 59))).toBe("Today's date: 2026-09-22 (Tuesday, local time).");
    expect(todayLine(new Date(2027, 0, 3, 0, 1))).toBe("Today's date: 2027-01-03 (Sunday, local time).");
  });
});
