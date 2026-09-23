import { expect, test } from "bun:test";
import { parseDuration } from "./duration";

test("hours and minutes", () => {
  expect(parseDuration("1h30m")).toBe(5_400_000);
});

test("seconds", () => {
  expect(parseDuration("45s")).toBe(45_000);
});
