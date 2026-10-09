/** Build stub (COLD) — lists entry modules. */
import { boot } from '../src/index.ts';

// <region:body>
export function buildSummary(): string {
  const b = boot();
  return `routes=${b.routes};db=${b.db}`;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(buildSummary());
}
// </region:body>
