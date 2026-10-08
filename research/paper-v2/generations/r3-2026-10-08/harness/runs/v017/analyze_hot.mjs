// Phase 1 analysis → runs/hot-file/summary.{json,md}
import { writeFileSync } from 'node:fs';
import { arm } from '../../src/arm-stats.mjs';
const RUNS = new URL('../', import.meta.url).pathname;
const reps = (p) => [1, 2, 3].map((i) => `${p}-r${i}`);
const ARMS = [
  ['control', 'CONTROL (no ATM)'], ['native', 'REAL ATM native (hot true-conflict → reject), sync writer'],
  ['loop', 'REAL ATM + hot_retry loop overlay, sync writer'], ['nativestale', 'REAL ATM native, STALE writer (no composer apply)'],
  ['loopstale', 'REAL ATM + loop, STALE writer'], ['mock', 'MOCK ATM (reference)'],
];
const out = {};
for (const tag of ['h1-a8', 'h1-a6', 'h08-a8']) {
  out[tag] = {};
  for (const [k, label] of ARMS) { const a = arm(RUNS, `${label} ${tag}`, reps(`v017-hf-${k}-${tag}`)); if (a) out[tag][k] = a; }
}
writeFileSync(new URL('hot_summary.json', import.meta.url), JSON.stringify(out, null, 2));
const L = [];
const f = (x) => (x == null ? '—' : x);
for (const [tag, arms] of Object.entries(out)) {
  const c = arms.control;
  L.push(`\n### ${tag}\n`, '| arm | wall ms | thr int/s | goodput pass/s | commits/rep | lost/rep (rate) | rejects/rep | timeouts | hist (per rep) | total mean/p95 | overhead mean/p95 | wait p50/p95/max (waited frac) | rounds mean/max |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, a] of Object.entries(arms)) {
    const h = Object.entries(a.decision_hist).map(([d, n]) => `${d} ${Math.round(n / a.reps * 10) / 10}`).join(', ');
    const w = a.wait_ms_waited;
    L.push(`| ${k} | ${a.wall_clock_ms.mean} | ${a.throughput_intents_per_s} | ${a.goodput_pass_per_s} | ${a.commits_per_rep} | ${a.lost_updates_per_rep} (${(a.lost_update_rate_of_commits * 100).toFixed(1)}%) | ${a.rejects_per_rep} | ${a.timeouts_per_rep} | ${h} | ${a.total_ms.mean} / ${a.total_ms.p95} | ${a.overhead_ms.mean} / ${a.overhead_ms.p95} | ${w.n ? `${w.p50} / ${w.p95} / ${w.max} (${w.frac})` : '0'} | ${a.queue_rounds.n ? `${a.queue_rounds.mean} / ${a.queue_rounds.max}` : '—'} |`);
  }
  L.push('', '| arm | decision | n/rep | commits | lost | latency p50/p95 | wait p50/p95/max | overhead p50/p95 | total p50/p95 |', '|---|---|---|---|---|---|---|---|---|');
  for (const [k, a] of Object.entries(arms)) for (const [dn, s] of Object.entries(a.per_decision))
    L.push(`| ${k} | ${dn} | ${s.per_rep} | ${s.commits} | ${s.lost} | ${s.latency_ms.p50} / ${s.latency_ms.p95} | ${s.wait_ms.p50} / ${s.wait_ms.p95} / ${s.wait_ms.max} | ${s.overhead_ms.p50} / ${s.overhead_ms.p95} | ${s.total_ms.p50} / ${s.total_ms.p95} |`);
  L.push('', '| arm | wait hist (all decisions) |', '|---|---|');
  for (const [k, a] of Object.entries(arms)) L.push(`| ${k} | ${Object.entries(a.wait_hist).map(([b, n]) => `${b}:${n}`).join(' ')} |`);
  L.push('', '| arm | reason_code hist (pooled) | atm_first_disposition |', '|---|---|---|');
  for (const [k, a] of Object.entries(arms)) L.push(`| ${k} | ${Object.entries(a.reason_hist).sort((x, y) => y[1] - x[1]).map(([b, n]) => `${b}:${n}`).join(', ')} | ${Object.entries(a.atm_first_disposition_hist).map(([b, n]) => `${b}:${n}`).join(', ') || '—'} |`);
  L.push('', `hash ${c?.scenario_hash}; per-rep wall: ` + Object.entries(arms).map(([k, a]) => `${k} [${a.wall_clock_ms.per_rep.join(', ')}]`).join('; '));
}
writeFileSync(new URL('hot_summary.md', import.meta.url), L.join('\n') + '\n');
console.log(L.join('\n'));
