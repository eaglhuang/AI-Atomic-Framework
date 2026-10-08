/** Billing service (COLD). */
export interface LineItem { sku: string; qty: number; unitCents: number }

// <region:body>
export function totalCents(items: readonly LineItem[]): number {
  return items.reduce((s, i) => s + i.qty * i.unitCents, 0);
}
export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
// </region:body>
