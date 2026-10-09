// Count overlapping admitted holds (same file / same path#region) per arm — "how much concurrent co-writing did ATM admit?"
import { writeFileSync } from 'node:fs';
import { loadRun } from '../../src/arm-stats.mjs';
const RUNS = new URL('../', import.meta.url).pathname;
const out = {};
for (const tag of ['h1-a8', 'h1-a6', 'h08-a8']) for (const k of ['control', 'native', 'loop', 'nativestale', 'loopstale', 'mock']) {
  const agg = { same_file_pairs: 0, same_region_pairs: 0, same_region_by_pair: {}, holds: 0, reps: 0 };
  for (const R of [1, 2, 3]) {
    const run = loadRun(RUNS, `hf-${k}-${tag}-r${R}`); if (!run) continue; agg.reps++;
    const h = run.dec.filter((e) => e.outcome === 'commit').map((e) => ({ k: `${e.path}#${e.region}`, path: e.path, a: e.t_submit_ms + (e.latency_ms || 0), b: e.t_done_ms, d: e.decision }));
    agg.holds += h.length;
    for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) {
      const x = h[i], y = h[j]; if (x.path !== y.path || !(x.a < y.b && y.a < x.b)) continue;
      agg.same_file_pairs++;
      if (x.k === y.k) { agg.same_region_pairs++; const key = [x.d, y.d].sort().join('+'); agg.same_region_by_pair[key] = (agg.same_region_by_pair[key] ?? 0) + 1; }
    }
  }
  if (agg.reps) out[`${tag}/${k}`] = { ...agg, same_file_pairs_per_rep: +(agg.same_file_pairs / agg.reps).toFixed(1), same_region_pairs_per_rep: +(agg.same_region_pairs / agg.reps).toFixed(1) };
}
writeFileSync(new URL('overlap.json', import.meta.url), JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(22), 'sameFile/rep', v.same_file_pairs_per_rep, 'sameRegion/rep', v.same_region_pairs_per_rep, JSON.stringify(v.same_region_by_pair));
