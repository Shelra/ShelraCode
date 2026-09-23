export interface OrderLine {
  sku: string;
  quantity: number;
  unitCents: number;
}

export interface Order {
  id: string;
  customerEmail: string;
  lines: OrderLine[];
  totalCents: number;
}

let nextId = 1;

/** A new order with its total; an order needs at least one line. */
export function createOrder(customerEmail: string, lines: OrderLine[]): Order {
  if (lines.length === 0) throw new Error("An order needs at least one line");
  const totalCents = lines.reduce((sum, line) => sum + line.quantity * line.unitCents, 0);
  const order = { id: `o${nextId}`, customerEmail, lines, totalCents };
  nextId += 1;
  return order;
}

export function resetOrderIds(): void {
  nextId = 1;
}
