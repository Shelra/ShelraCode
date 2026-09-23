import { expect, test } from "bun:test";
import { daysInMonth } from "./calendar";

test("knows leap-year February", () => {
  expect(daysInMonth(2024, 2)).toBe(29);
});
