import { expect, test } from "bun:test";
import { invoiceTotalCents } from "./invoice";

test("totals an invoice with large lines", () => {
  expect(
    invoiceTotalCents([
      { description: "Server", quantity: 2, unitCents: 180_000 },
      { description: "Cable", quantity: 3, unitCents: 1_250 },
    ]),
  ).toBe(363_750);
});
