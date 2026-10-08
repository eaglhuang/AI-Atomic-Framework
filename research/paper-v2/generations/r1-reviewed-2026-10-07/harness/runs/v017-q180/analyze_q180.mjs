import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RUNS = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = dirname(fileURLToPath(import.meta.url));
const pct = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const r = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const BUCKETS = [[0, 0, '0'], [0.001, 25, '(0,25]'], [25, 50, '(25,50]'], [50, 100, '(50,100]'], [100, 200, '(100,200]'], [200, 400, '(200,400]'], [400, 800, '(400,800]'], [800, 1600, '(800,1600]'], [1600, Infinity, '>1600']];
const bucket = (w) => (w <= 0 ? '0' : BUCKETS.slice(1).find(([lo, hi]) => w > (lo === 0.001 ? 0 : lo) && w <= hi)[2]);
function load(id) {
  const dir = join(RUNS, id); if (!existsSync(join(dir, 'meta.json'))) return null;
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const mode = meta.modes.atm ? 'atm' : 'control';
  const evDir = join(dir, mode, 'events');
  const evs = readdirSync(evDir).flatMap((f) => readFileSync(join(evDir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const dec = evs.filter((e) => e.event === 'decision'), orc = evs.filter((e) => e.event === 'oracle');
  const enq = evs.filter((e) => e.event === 'enqueue');
  return { id, meta, mode, dec, orc, enq, wall: meta.modes[mode].wall_clock_ms };
}
function arm(label, ids) {
  const runs = ids.map(load).filter(Boolean);
  if (!runs.length) return null;
  const dec = runs.flatMap((x) => x.dec), orc = runs.flatMap((x) => x.orc), enq = runs.flatMap((x) => x.enq);
  const waits = dec.map((e) => e.wait_ms || 0), waited = waits.filter((w) => w > 0);
  const hist = {}; for (const [, , n] of BUCKETS) hist[n] = 0; waits.forEach((w) => hist[bucket(w)]++);
  const dh = {}; dec.forEach((e) => (dh[e.decision] = (dh[e.decision] ?? 0) + 1));
  const first = {}; dec.forEach((e) => { if (e.atm_first_disposition) first[e.atm_first_disposition] = (first[e.atm_first_disposition] ?? 0) + 1; });
  const finalDisp = {}; dec.forEach((e) => { if (e.atm_disposition) finalDisp[e.atm_disposition] = (finalDisp[e.atm_disposition] ?? 0) + 1; });
  const rounds = dec.filter((e) => e.queue_rounds > 0).map((e) => e.queue_rounds);
  const qpos = [...dec, ...enq].map((e) => e.queue_position).filter((x) => x != null);
  const walls = runs.map((x) => x.wall);
  const commits = dec.filter((e) => e.outcome === 'commit').length;
  const pass = orc.filter((e) => e.outcome === 'test_pass').length;
  const lost = orc.filter((e) => e.reason_code === 'lost_update').length;
  const f = (k) => dec.map((e) => e[k] || 0);
  const ps = (a) => ({ mean: r(mean(a)), p50: r(pct(a, .5)), p95: r(pct(a, .95)), p99: r(pct(a, .99)), max: r(Math.max(0, ...a)) });
  // FIFO heuristic: among enqueues sharing same path in same trial, do later enqueues have higher wait?
  return {
    label, runs: runs.map((x) => x.id), backend: runs[0].meta.atm_backend ?? 'none',
    cold_retry: runs[0].meta.params.cold_retry, n_agents: runs[0].meta.params.n_agents,
    overlap: runs[0].meta.params.overlap, scenario_hash: runs[0].meta.scenario_hash.slice(0, 12),
    intents_per_rep: dec.length / runs.length, wall_clock_ms: { mean: r(mean(walls)), per_rep: walls.map((w) => r(w)) },
    throughput_intents_per_s: r(mean(runs.map((x) => x.dec.length / (x.wall / 1000)))),
    goodput_pass_per_s: r(mean(runs.map((x) => x.orc.filter((e) => e.outcome === 'test_pass').length / (x.wall / 1000)))),
    commits_per_rep: r(commits / runs.length, 1), oracle_pass_per_rep: r(pass / runs.length, 1),
    lost_updates_per_rep: r(lost / runs.length, 1), lost_update_rate: commits ? r(lost / commits, 4) : 0,
    rejects_per_rep: r(dec.filter((e) => e.outcome === 'reject').length / runs.length, 1),
    timeouts_per_rep: r(dec.filter((e) => e.outcome === 'timeout' || e.timed_out).length / runs.length, 1),
    decision_hist: dh, atm_first_disposition_hist: first, atm_final_disposition_hist: finalDisp,
    wait_ms_all: ps(waits), wait_ms_waited: { n: waited.length, frac: r(waited.length / Math.max(1, waits.length), 3), ...ps(waited) },
    wait_hist: hist, queue_rounds: rounds.length ? ps(rounds) : null,
    queue_position: qpos.length ? { n: qpos.length, ...ps(qpos) } : null,
    total_ms: ps(f('total_ms')), overhead_ms: ps(f('overhead_ms')), hold_ms: ps(f('hold_ms')),
    broker_ms: ps(f('broker_ms')), schedule_lag_ms: ps(f('schedule_lag_ms')),
  };
}
const reps = (p) => [1, 2, 3].map((i) => `${p}-r${i}`);
const out = {};
for (const A of [8, 16]) {
  out[`a${A}`] = {
    control: arm(`control a${A}`, reps(`v017-q180-control-a${A}`)),
    native: arm(`native (once, region) a${A}`, reps(`v017-q180-native-a${A}`)),
    nqwait: arm(`native-queue-wait a${A}`, reps(`v017-q180-nqwait-a${A}`)),
  };
}
out.one_file_a16 = {
  control: arm('control 1-file a16', ['v017-q180-1f-control-a16-r1']),
  native: arm('native 1-file a16', ['v017-q180-1f-native-a16-r1']),
  nqwait: arm('nqwait 1-file a16', ['v017-q180-1f-nqwait-a16-r1']),
};
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(out, null, 2));
const L = [];
L.push('| group | arm | cold_retry | reps | wall ms | vs ctrl | thr int/s | goodput | waited frac | wait p50/p95/max | commits/pass/lost | reject/timeout | first_disp |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [g, arms] of Object.entries(out)) {
  const c = arms.control;
  for (const a of Object.values(arms).filter(Boolean)) {
    L.push(`| ${g} | ${a.label} | ${a.cold_retry ?? '—'} | ${a.runs.length} | ${a.wall_clock_ms.mean} | ${r(a.wall_clock_ms.mean / c.wall_clock_ms.mean)}× | ${a.throughput_intents_per_s} | ${a.goodput_pass_per_s} | ${a.wait_ms_waited.frac} | ${a.wait_ms_waited.p50}/${a.wait_ms_waited.p95}/${a.wait_ms_waited.max} | ${a.commits_per_rep}/${a.oracle_pass_per_rep}/${a.lost_updates_per_rep} | ${a.rejects_per_rep}/${a.timeouts_per_rep} | ${JSON.stringify(a.atm_first_disposition_hist)} |`);
  }
}
L.push('', '### wait_ms histogram', '');
const bn = BUCKETS.map((b) => b[2]);
L.push(`| group | arm | ${bn.join(' | ')} |`, `|---|---|${bn.map(() => '---').join('|')}|`);
for (const [g, arms] of Object.entries(out))
  for (const a of Object.values(arms).filter(Boolean))
    L.push(`| ${g} | ${a.label} | ${bn.map((b) => a.wait_hist[b]).join(' | ')} |`);
L.push('', '### Decision / queue_rounds / queue_position', '');
L.push('| group | arm | decision_hist | final_disp | queue_rounds mean/p95/max | queue_position mean/p95/max |');
L.push('|---|---|---|---|---|---|');
for (const [g, arms] of Object.entries(out))
  for (const a of Object.values(arms).filter(Boolean))
    L.push(`| ${g} | ${a.label} | ${JSON.stringify(a.decision_hist)} | ${JSON.stringify(a.atm_final_disposition_hist)} | ${a.queue_rounds ? `${a.queue_rounds.mean}/${a.queue_rounds.p95}/${a.queue_rounds.max}` : '—'} | ${a.queue_position ? `${a.queue_position.mean}/${a.queue_position.p95}/${a.queue_position.max}` : '—'} |`);
writeFileSync(join(OUT, 'summary.md'), L.join('\n') + '\n');
console.log(L.join('\n'));
