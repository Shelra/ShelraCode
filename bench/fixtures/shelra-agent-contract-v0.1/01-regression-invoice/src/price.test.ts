import { expect, test } from "bun:test";
import { formatPrice } from "./price";

test("formats cents as dollars", () => {
  expect(formatPrice(1250)).toBe("$12.50");
  expect(formatPrice(5)).toBe("$0.05");
});

test("keeps the sign", () => {
  expect(formatPrice(-990)).toBe("-$9.90");
});
