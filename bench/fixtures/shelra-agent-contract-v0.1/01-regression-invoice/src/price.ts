/** Formats an amount in cents as dollars, for example 1250 cents is "$12.50". */
export function formatPrice(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
