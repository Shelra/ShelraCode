import { createOrder, type Order, type OrderLine } from "../domain/order";

/** Places a customer's order: the entry point the web handler calls. */
export function placeOrder(customerEmail: string, lines: OrderLine[]): Order {
  return createOrder(customerEmail, lines);
}
