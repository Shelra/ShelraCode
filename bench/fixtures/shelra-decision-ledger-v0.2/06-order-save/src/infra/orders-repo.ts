import type { Order } from "../domain/order";

const saved: Order[] = [];

export function saveOrder(order: Order): void {
  saved.push(structuredClone(order));
}

export function savedOrders(): Order[] {
  return saved.map((order) => structuredClone(order));
}

export function clearOrders(): void {
  saved.length = 0;
}
