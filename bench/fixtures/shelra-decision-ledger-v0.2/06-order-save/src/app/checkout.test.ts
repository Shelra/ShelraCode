import { beforeEach, describe, expect, it } from "bun:test";
import { resetOrderIds } from "../domain/order";
import { placeOrder } from "./checkout";

beforeEach(() => resetOrderIds());

describe("checkout", () => {
  it("places an order with its total", () => {
    const order = placeOrder("ada@example.com", [{ sku: "A", quantity: 2, unitCents: 500 }]);
    expect(order).toMatchObject({ id: "o1", customerEmail: "ada@example.com", totalCents: 1000 });
  });

  it("refuses an empty order", () => {
    expect(() => placeOrder("ada@example.com", [])).toThrow();
  });
});
