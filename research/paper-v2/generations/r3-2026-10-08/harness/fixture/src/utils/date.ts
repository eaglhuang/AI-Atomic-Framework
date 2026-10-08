/** Date helpers (COLD). */
// <region:body>
export function isoDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
// </region:body>
