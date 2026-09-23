import { formatPrice } from "./price";

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitCents: number;
}

function lineText(line: InvoiceLine): string {
  return `${line.description} x${line.quantity}: ${formatPrice(line.quantity * line.unitCents)}`;
}

/** The invoice total in cents, read back from the amounts as they are printed. */
export function invoiceTotalCents(lines: InvoiceLine[]): number {
  const total = lines
    .map((line) => formatPrice(line.quantity * line.unitCents))
    .reduce((sum, text) => sum + Number.parseFloat(text.replace("$", "")), 0);
  return Math.round(total * 100);
}

/** One line per item, then the total. */
export function renderInvoice(lines: InvoiceLine[]): string {
  return [...lines.map(lineText), `Total: ${formatPrice(invoiceTotalCents(lines))}`].join("\n");
}
