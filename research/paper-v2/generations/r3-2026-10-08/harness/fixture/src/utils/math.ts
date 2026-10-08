/** Math helpers (COLD). */
// <region:body>
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
export function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
// </region:body>
