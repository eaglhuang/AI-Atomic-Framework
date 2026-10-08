// Analyze cold-queue matrix → runs/cold-queue/summary.json + summary.md tables
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const RUNS = new URL('../', import.meta.url).pathname;
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
  const evs = readdirSync(evDir).flatMap((f) => readFileSync(join(evDir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
  const dec = evs.filter((e) => e.event === 'decision'), orc = evs.filter((e) => e.event === 'oracle');
  return { id, meta, mode, dec, orc, wall: meta.modes[mode].wall_clock_ms };
}
function arm(label, ids) {
  const runs = ids.map(load).filter(Boolean);
  if (!runs.length) return null;
  const dec = runs.flatMap((x) => x.dec), orc = runs.flatMap((x) => x.orc);
  const waits = dec.map((e) => e.wait_ms || 0), waited = waits.filter((w) => w > 0);
  const hist = {}; for (const [, , n] of BUCKETS) hist[n] = 0; waits.forEach((w) => hist[bucket(w)]++);
  const dh = {}; dec.forEach((e) => (dh[e.decision] = (dh[e.decision] ?? 0) + 1));
  const first = {}; dec.forEach((e) => { if (e.atm_first_disposition) first[e.atm_first_disposition] = (first[e.atm_first_disposition] ?? 0) + 1; });
  const rounds = dec.filter((e) => e.queue_rounds > 0).map((e) => e.queue_rounds);
  const walls = runs.map((x) => x.wall);
  const nInt = dec.length / runs.length;
  const commits = dec.filter((e) => e.outcome === 'commit').length;
  const pass = orc.filter((e) => e.outcome === 'test_pass').length;
  const lost = orc.filter((e) => e.reason_code === 'lost_update').length;
  const f = (k) => dec.map((e) => e[k] || 0);
  const ps = (a) => ({ mean: r(mean(a)), p50: r(pct(a, .5)), p95: r(pct(a, .95)), p99: r(pct(a, .99)), max: r(Math.max(0, ...a)) });
  return {
    label, runs: runs.map((x) => x.id), backend: runs[0].meta.atm_backend, n_agents: runs[0].meta.params.n_agents,
    overlap: runs[0].meta.params.overlap, scenario_hash: runs[0].meta.scenario_hash.slice(0, 12),
    intents_per_rep: nInt, wall_clock_ms: { mean: r(mean(walls)), per_rep: walls },
    throughput_intents_per_s: r(mean(runs.map((x) => x.dec.length / (x.wall / 1000)))),
    goodput_pass_per_s: r(mean(runs.map((x) => x.orc.filter((e) => e.outcome === 'test_pass').length / (x.wall / 1000)))),
    commits_per_rep: r(commits / runs.length, 1), oracle_pass_per_rep: r(pass / runs.length, 1), lost_updates_per_rep: r(lost / runs.length, 1),
    lost_update_rate: commits ? r(lost / commits, 4) : 0,
    rejects_per_rep: r(dec.filter((e) => e.outcome === 'reject').length / runs.length, 1),
    timeouts_per_rep: r(dec.filter((e) => e.outcome === 'timeout' || e.timed_out).length / runs.length, 1),
    decision_hist: dh, atm_first_disposition_hist: first,
    wait_ms_all: ps(waits), wait_ms_waited: { n: waited.length, frac: r(waited.length / waits.length, 3), ...ps(waited) }, wait_hist: hist,
    queue_rounds: rounds.length ? ps(rounds) : null,
    total_ms: ps(f('total_ms')), overhead_ms: ps(f('overhead_ms')), hold_ms: ps(f('hold_ms')), broker_ms: ps(f('broker_ms')), schedule_lag_ms: ps(f('schedule_lag_ms')),
  };
}
const reps = (p) => [1, 2, 3].map((i) => `${p}-r${i}`);
const out = {};
for (const A of [8, 16]) {
  out[`a${A}`] = {
    control: arm(`control a${A}`, reps(`v017-cq-control-a${A}`)),
    real: arm(`REAL ATM (region atom id + loop overlay) a${A}`, reps(`v017-cq-real-a${A}`)),
    mock: arm(`MOCK ATM cold_queue a${A}`, reps(`v017-cq-mock-a${A}`)),
    real_legacy: arm(`REAL ATM legacy (intent atom id) a${A}`, [`v017-cq-reallegacy-a${A}-r1`]),
  };
}
out.one_file_a16 = { control: arm('control 1-file a16', ['v017-cq1-control-a16-r1']), real: arm('REAL 1-file a16', ['v017-cq1-real-a16-r1']), mock: arm('MOCK 1-file a16', ['v017-cq1-mock-a16-r1']) };
writeFileSync(join(RUNS, 'v017/cold_summary.json'), JSON.stringify(out, null, 2));
// markdown tables
const L = [];
const rows = Object.entries(out).flatMap(([g, arms]) => Object.values(arms).filter(Boolean).map((a) => ({ g, a, c: arms.control })));
L.push('| group | arm | reps | wall ms (mean) | slowdown wall vs ctrl | thr int/s | goodput pass/s | total_ms mean / p50 / p95 | Δtotal mean vs ctrl | waited n (frac) | wait_ms p50 / p95 / p99 / max (waited) | commits / pass / lost per rep | reject / timeout per rep |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const { g, a, c } of rows) {
  L.push(`| ${g} | ${a.label} | ${a.runs.length} | ${a.wall_clock_ms.mean} | ${r(a.wall_clock_ms.mean / c.wall_clock_ms.mean)}× | ${a.throughput_intents_per_s} | ${a.goodput_pass_per_s} | ${a.total_ms.mean} / ${a.total_ms.p50} / ${a.total_ms.p95} | ${r(a.total_ms.mean - c.total_ms.mean)} (${r(a.total_ms.mean / c.total_ms.mean)}×) | ${a.wait_ms_waited.n} (${a.wait_ms_waited.frac}) | ${a.wait_ms_waited.p50} / ${a.wait_ms_waited.p95} / ${a.wait_ms_waited.p99} / ${a.wait_ms_waited.max} | ${a.commits_per_rep} / ${a.oracle_pass_per_rep} / ${a.lost_updates_per_rep} | ${a.rejects_per_rep} / ${a.timeouts_per_rep} |`);
}
L.push('', '### wait_ms histogram (pooled decisions; counts)', '');
const bn = BUCKETS.map((b) => b[2]);
L.push(`| group | arm | ${bn.join(' | ')} |`, `|---|---|${bn.map(() => '---').join('|')}|`);
for (const { g, a } of rows) L.push(`| ${g} | ${a.label} | ${bn.map((b) => a.wait_hist[b]).join(' | ')} |`);
L.push('', '### Decision / first-ATM-disposition histograms', '');
L.push('| group | arm | decision_hist | atm_first_disposition | queue_rounds (waited) mean / p95 / max | schedule_lag p95 |', '|---|---|---|---|---|---|');
for (const { g, a } of rows) L.push(`| ${g} | ${a.label} | ${JSON.stringify(a.decision_hist)} | ${JSON.stringify(a.atm_first_disposition_hist)} | ${a.queue_rounds ? `${a.queue_rounds.mean} / ${a.queue_rounds.p95} / ${a.queue_rounds.max}` : '—'} | ${a.schedule_lag_ms.p95} |`);
writeFileSync(join(RUNS, 'v017/cold_summary.md'), L.join('\n') + '\n');
console.log(L.join('\n'));
