import { expect, test } from "bun:test";
import { truncate } from "./text";

test("shortens long text with an ellipsis", () => {
  expect(truncate("hello world", 8)).toBe("hello w…");
});

test("leaves short text alone", () => {
  expect(truncate("short", 10)).toBe("short");
});
