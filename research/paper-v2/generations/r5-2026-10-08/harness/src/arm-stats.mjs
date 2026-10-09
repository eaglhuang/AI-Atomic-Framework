// Shared run/arm statistics for phase reports (hot-file, multiprocess, scale).
// Reads runs/<id>/{meta.json, <mode>/events/*.jsonl}; pools reps of one "arm".
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const pct = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const r = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
export const ps = (a) => ({ n: a.length, mean: r(mean(a)), p50: r(pct(a, 0.5)), p95: r(pct(a, 0.95)), p99: r(pct(a, 0.99)), max: r(a.length ? Math.max(...a) : 0) });
const BUCKETS = [['0', -Infinity, 0], ['(0,25]', 0, 25], ['(25,50]', 25, 50], ['(50,100]', 50, 100], ['(100,200]', 100, 200], ['(200,400]', 200, 400], ['(400,800]', 400, 800], ['>800', 800, Infinity]];
const bucket = (w) => BUCKETS.find(([, lo, hi]) => w > lo && w <= hi)[0];

export function loadRun(runsDir, id) {
  const dir = join(runsDir, id);
  if (!existsSync(join(dir, 'meta.json'))) return null;
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const mode = meta.modes.atm ? 'atm' : 'control';
  const evDir = join(dir, mode, 'events');
  const evs = readdirSync(evDir).filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => readFileSync(join(evDir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const dec = evs.filter((e) => e.event === 'decision');
  const orc = evs.filter((e) => e.event === 'oracle');
  return { id, dir, meta, mode, dec, orc, wall: meta.modes[mode].wall_clock_ms, mm: meta.modes[mode] };
}

export function arm(runsDir, label, ids) {
  const runs = ids.map((id) => loadRun(runsDir, id)).filter(Boolean);
  if (!runs.length) return null;
  const dec = runs.flatMap((x) => x.dec), orc = runs.flatMap((x) => x.orc);
  const n = runs.length;
  const lostKey = (e) => `${e.run_id}|${e.logical_id ?? e.intent_id}`;
  const lostIds = new Set(orc.filter((e) => e.reason_code === 'lost_update').map(lostKey));
  const dh = {}, rh = {}, first = {}, byDec = {};
  for (const e of dec) {
    dh[e.decision] = (dh[e.decision] ?? 0) + 1;
    rh[e.reason_code] = (rh[e.reason_code] ?? 0) + 1;
    if (e.atm_first_disposition) first[e.atm_first_disposition] = (first[e.atm_first_disposition] ?? 0) + 1;
    (byDec[e.decision] ??= []).push(e);
  }
  const waits = dec.map((e) => e.wait_ms || 0), waited = waits.filter((w) => w > 0);
  const hist = Object.fromEntries(BUCKETS.map(([k]) => [k, 0])); waits.forEach((w) => hist[bucket(w)]++);
  const commits = dec.filter((e) => e.outcome === 'commit').length;
  const pass = orc.filter((e) => e.outcome === 'test_pass').length;
  const lost = lostIds.size;
  const f = (k, arr = dec) => arr.map((e) => e[k] || 0);
  const per_decision = Object.fromEntries(Object.entries(byDec).map(([k, a]) => [k, {
    n: a.length, per_rep: r(a.length / n, 1),
    commits: a.filter((e) => e.outcome === 'commit').length,
    lost: a.filter((e) => lostIds.has(lostKey(e))).length,
    latency_ms: ps(f('latency_ms', a)), wait_ms: ps(f('wait_ms', a)), overhead_ms: ps(f('overhead_ms', a)), total_ms: ps(f('total_ms', a)),
  }]));
  const walls = runs.map((x) => x.wall);
  return {
    label, runs: runs.map((x) => x.id), reps: n, backend: runs[0].meta.atm_backend,
    params: (({ n_agents, trial_count, hot_ratio, overlap, hot_retry, atm_writer, cold_atom_identity, cold_retry, tick_interval_ms, hold_ms_min, hold_ms_max }) =>
      ({ n_agents, trial_count, hot_ratio, overlap, hot_retry, atm_writer, cold_atom_identity, cold_retry, tick_interval_ms, hold_ms_min, hold_ms_max }))(runs[0].meta.params),
    scenario_hash: runs[0].meta.scenario_hash.slice(0, 12),
    intents_per_rep: r(dec.length / n, 1),
    wall_clock_ms: { mean: r(mean(walls)), per_rep: walls.map((w) => r(w)) },
    throughput_intents_per_s: r(mean(runs.map((x) => x.dec.length / (x.wall / 1000)))),
    goodput_pass_per_s: r(mean(runs.map((x) => x.orc.filter((e) => e.outcome === 'test_pass').length / (x.wall / 1000)))),
    commits_per_rep: r(commits / n, 1), oracle_pass_per_rep: r(pass / n, 1), lost_updates_per_rep: r(lost / n, 1),
    lost_update_rate_of_commits: commits ? r(lost / commits, 4) : 0,
    success_rate_of_intents: dec.length ? r(pass / dec.length, 4) : 0,
    rejects_per_rep: r(dec.filter((e) => e.outcome === 'reject').length / n, 1),
    timeouts_per_rep: r(dec.filter((e) => e.outcome === 'timeout' || e.timed_out).length / n, 1),
    errors_per_rep: r(dec.filter((e) => e.outcome === 'error').length / n, 1),
    racy_per_rep: r(dec.filter((e) => e.racy || e.reason_code === 'racy_overwrite').length / n, 1),
    decision_hist: dh, reason_hist: rh, atm_first_disposition_hist: first, per_decision,
    wait_ms_all: ps(waits), wait_ms_waited: { frac: r(waited.length / (waits.length || 1), 3), ...ps(waited) }, wait_hist: hist,
    queue_rounds: ps(dec.filter((e) => e.queue_rounds > 0).map((e) => e.queue_rounds)),
    latency_ms: ps(f('latency_ms')), broker_ms: ps(f('broker_ms')), apply_ms: ps(f('apply_ms')),
    total_ms: ps(f('total_ms')), overhead_ms: ps(f('overhead_ms')), hold_ms: ps(f('hold_ms')), schedule_lag_ms: ps(f('schedule_lag_ms')),
    extra: runs.map((x) => x.mm.mp ?? null).filter(Boolean),
  };
}
