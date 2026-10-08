/** String helpers (COLD). */
// <region:body>
export function trim(s: string): string {
  return s.trim();
}
export function slugify(s: string): string {
  return trim(s).toLowerCase().replace(/\s+/g, '-');
}
// </region:body>
