// Exporter: runs/<run_id>/{atm,control}/events/*.jsonl -> export/{summary.json,decisions.csv,trials.csv,summary.md}
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateScenarios, loadManifest, scenarioHash } from './scenario.mjs';

const MODES = ['atm', 'control'];
const inc = (o, k) => { o[k ?? 'null'] = (o[k ?? 'null'] ?? 0) + 1; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const r1 = (x) => Math.round(x * 10) / 10;
const csvCell = (v) => { const s = v == null ? '' : Array.isArray(v) ? v.join('|') : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// ---- latency helpers -------------------------------------------------------
// Nearest-rank percentile (q in 0..1). Documented in COMPARE_LATENCY.md.
export const quant = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.min(s.length - 1, Math.ceil(q * s.length) - 1))]; };
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
export function stats(vals) {
  const v = vals.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return { n: 0, mean: null, p50: null, p95: null, max: null };
  return { n: v.length, mean: r2(mean(v)), p50: r2(quant(v, 0.5)), p95: r2(quant(v, 0.95)), max: r2(Math.max(...v)) };
}
export const LAT_FIELDS = ['latency_ms', 'wait_ms', 'broker_ms', 'hold_ms', 'apply_ms', 'total_ms', 'overhead_ms', 'schedule_lag_ms'];
const GROUP_FIELDS = ['latency_ms', 'wait_ms', 'apply_ms', 'total_ms', 'overhead_ms'];

export function latencySummary(decisions, oracle, modeMeta) {
  const timed = decisions.filter((e) => typeof e.total_ms === 'number');
  if (!timed.length) {
    return { timing_available: false, note: 'events predate 0.3.0-latency (no total_ms); re-run to get timing',
      run: { wall_clock_ms: null, duration_ms: modeMeta?.duration_ms ?? null } };
  }
  const per_intent = {};
  for (const f of LAT_FIELDS) per_intent[f] = stats(timed.map((e) => e[f] ?? 0));
  const groupBy = (key) => {
    const g = {};
    for (const k of [...new Set(timed.map((e) => e[key]))].sort()) {
      const sub = timed.filter((e) => e[key] === k);
      g[k] = { n: sub.length };
      for (const f of GROUP_FIELDS) g[k][f] = stats(sub.map((e) => e[f] ?? 0));
    }
    return g;
  };
  const t0 = Math.min(...timed.map((e) => e.t_submit_ms));
  const t1 = Math.max(...timed.map((e) => e.t_done_ms));
  const wall = t1 - t0;
  const pass = oracle.filter((e) => e.outcome === 'test_pass').length;
  const committed = timed.filter((e) => e.outcome === 'commit').length;
  return {
    timing_available: true,
    clock: 'performance.now() monotonic ms (2dp); wall = first submit -> last decision',
    percentile_method: 'nearest-rank',
    run: {
      wall_clock_ms: r2(wall), duration_ms_from_t0: modeMeta?.duration_ms ?? null,
      intents: timed.length, committed, oracle_pass: pass,
      throughput_intents_per_s: r2(timed.length / (wall / 1000)),
      throughput_committed_per_s: r2(committed / (wall / 1000)),
      goodput_oracle_pass_per_s: r2(pass / (wall / 1000)),
      sum_overhead_ms: r2(timed.reduce((a, e) => a + (e.overhead_ms ?? 0), 0)),
      sum_total_ms: r2(timed.reduce((a, e) => a + (e.total_ms ?? 0), 0)),
    },
    per_intent,
    by_temperature: groupBy('temperature'),
    by_decision: groupBy('decision'),
  };
}

const ratio = (a, c) => (a == null || c == null || c === 0 ? null : r2(a / c));
const delta = (a, c) => (a == null || c == null ? null : r2(a - c));

/** Compare ATM vs control latency. inputs: arrays of { summary, decisions, oracle } (one per repetition). */
export function compareLatency(atmRuns, ctrlRuns) {
  const pool = (runs) => {
    const decisions = runs.flatMap((r) => r.decisions.filter((e) => typeof e.total_ms === 'number'));
    const oracle = runs.flatMap((r) => r.oracle);
    const walls = runs.map((r) => r.lat.run.wall_clock_ms);
    const tps = runs.map((r) => r.lat.run.throughput_intents_per_s);
    const gps = runs.map((r) => r.lat.run.goodput_oracle_pass_per_s);
    return { decisions, oracle, walls, tps, gps, lat: latencySummary(decisions, oracle, null) };
  };
  const prep = (runs) => runs.map(({ summary, decisions, oracle }) => ({ summary, decisions, oracle, lat: latencySummary(decisions, oracle, null) }));
  const A = prep(atmRuns), C = prep(ctrlRuns);
  const pa = pool(A), pc = pool(C);
  const cmpStats = (sa, sc) => {
    const o = {};
    for (const k of ['mean', 'p50', 'p95', 'max']) o[k] = { atm: sa[k], control: sc[k], delta_ms: delta(sa[k], sc[k]), ratio: ratio(sa[k], sc[k]) };
    return o;
  };
  const per_intent = {};
  for (const f of LAT_FIELDS) per_intent[f] = cmpStats(pa.lat.per_intent[f], pc.lat.per_intent[f]);
  const by_temperature = {};
  for (const t of [...new Set([...Object.keys(pa.lat.by_temperature), ...Object.keys(pc.lat.by_temperature)])]) {
    by_temperature[t] = {};
    for (const f of ['latency_ms', 'total_ms', 'overhead_ms', 'apply_ms']) {
      by_temperature[t][f] = cmpStats(pa.lat.by_temperature[t]?.[f] ?? {}, pc.lat.by_temperature[t]?.[f] ?? {});
    }
    by_temperature[t].n = { atm: pa.lat.by_temperature[t]?.n ?? 0, control: pc.lat.by_temperature[t]?.n ?? 0 };
  }
  // Paired by (rep index, intent_id): same seed => same intent ids & schedules.
  const paired = [];
  const nRep = Math.min(A.length, C.length);
  for (let i = 0; i < nRep; i++) {
    const cm = new Map(C[i].decisions.map((e) => [e.intent_id, e]));
    for (const a of A[i].decisions) {
      const c = cm.get(a.intent_id); if (!c || typeof a.total_ms !== 'number' || typeof c.total_ms !== 'number') continue;
      paired.push({ temperature: a.temperature, decision: a.decision, d_total: a.total_ms - c.total_ms, d_over: a.overhead_ms - c.overhead_ms });
    }
  }
  const pairedStats = (rows) => ({ n: rows.length, total_ms_delta: stats(rows.map((r) => r.d_total)), overhead_ms_delta: stats(rows.map((r) => r.d_over)) });
  const paired_by = { all: pairedStats(paired) };
  for (const t of [...new Set(paired.map((r) => r.temperature))].sort()) paired_by[`temperature:${t}`] = pairedStats(paired.filter((r) => r.temperature === t));
  for (const d of [...new Set(paired.map((r) => r.decision))].sort()) paired_by[`atm_decision:${d}`] = pairedStats(paired.filter((r) => r.decision === d));

  const wallMeanA = mean(pa.walls), wallMeanC = mean(pc.walls);
  const tpA = mean(pa.tps), tpC = mean(pc.tps);
  const headline = {
    reps: { atm: A.length, control: C.length },
    wall_clock_ms: { atm_mean: r2(wallMeanA), control_mean: r2(wallMeanC), delta_ms: r2(wallMeanA - wallMeanC), slowdown_x: ratio(wallMeanA, wallMeanC),
      atm_per_rep: pa.walls, control_per_rep: pc.walls },
    throughput_intents_per_s: { atm_mean: r2(tpA), control_mean: r2(tpC), slowdown_x: ratio(tpC, tpA),
      atm_per_rep: pa.tps, control_per_rep: pc.tps },
    goodput_oracle_pass_per_s: { atm_mean: r2(mean(pa.gps)), control_mean: r2(mean(pc.gps)), ratio_atm_over_control: ratio(mean(pa.gps), mean(pc.gps)) },
    total_ms: { mean: per_intent.total_ms.mean, p95: per_intent.total_ms.p95 },
    overhead_ms: { mean: per_intent.overhead_ms.mean, p95: per_intent.overhead_ms.p95 },
    atm_admission_latency_ms: pa.lat.per_intent.latency_ms,
    atm_broker_ms: pa.lat.per_intent.broker_ms,
    atm_wait_ms: pa.lat.per_intent.wait_ms,
  };
  const meta = (R) => R.map(({ summary: s }) => ({ run_id: s.run_id, atm_backend: s.atm_backend, atm_version: s.atm_version, label: s.label,
    scenario_seed: s.scenario_seed, scenario_hash: s.reproducibility.meta_hash, params: s.params, cli_version: s.cli_version ?? null,
    node_version: s.node_version ?? null }));
  return { generated_at: new Date().toISOString(), atm_runs: meta(A), control_runs: meta(C), headline, per_intent, by_temperature, paired_by,
    atm_by_decision: pa.lat.by_decision, control_by_decision: pc.lat.by_decision,
    per_rep: { atm: A.map((r) => ({ run_id: r.summary.run_id, ...r.lat.run })), control: C.map((r) => ({ run_id: r.summary.run_id, ...r.lat.run })) } };
}

const f2 = (x) => (x == null ? '—' : String(x));
const fx = (x) => (x == null ? 'n/a' : `${x}×`);

export function renderCompareLatency(cmp, { title = 'COMPARE_LATENCY — ATM (real) vs control' } = {}) {
  const h = cmp.headline;
  const L = [`# ${title}`, ''];
  L.push('## Runs', '', '| side | run_id | atm_backend | seed | scenario_hash | params (timing) |', '|---|---|---|---|---|---|');
  for (const [side, R] of [['ATM', cmp.atm_runs], ['control', cmp.control_runs]]) {
    for (const r of R) L.push(`| ${side} | \`${r.run_id}\` | ${r.atm_backend} | ${r.scenario_seed} | \`${String(r.scenario_hash).slice(0, 12)}…\` | agents=${r.params.n_agents}, trials=${r.params.trial_count}, tick=${r.params.tick_interval_ms}ms, hold=${r.params.hold_ms_min}–${r.params.hold_ms_max}ms, jitter=${r.params.jitter_ms}ms |`);
  }
  L.push('', '## Headline — ATM slowdown vs control', '',
    '| metric | ATM | control | Δ (ATM − control) | slowdown |', '|---|---|---|---|---|',
    `| wall clock (mean over reps) | ${f2(h.wall_clock_ms.atm_mean)} ms | ${f2(h.wall_clock_ms.control_mean)} ms | ${f2(h.wall_clock_ms.delta_ms)} ms | ${fx(h.wall_clock_ms.slowdown_x)} |`,
    `| throughput (intents/s) | ${f2(h.throughput_intents_per_s.atm_mean)} | ${f2(h.throughput_intents_per_s.control_mean)} | — | ${fx(h.throughput_intents_per_s.slowdown_x)} (control/ATM) |`,
    `| goodput (oracle-pass intents/s) | ${f2(h.goodput_oracle_pass_per_s.atm_mean)} | ${f2(h.goodput_oracle_pass_per_s.control_mean)} | — | ATM/control = ${fx(h.goodput_oracle_pass_per_s.ratio_atm_over_control)} |`,
    `| per-intent total_ms mean | ${f2(h.total_ms.mean.atm)} | ${f2(h.total_ms.mean.control)} | ${f2(h.total_ms.mean.delta_ms)} ms | ${fx(h.total_ms.mean.ratio)} |`,
    `| per-intent total_ms p95 | ${f2(h.total_ms.p95.atm)} | ${f2(h.total_ms.p95.control)} | ${f2(h.total_ms.p95.delta_ms)} ms | ${fx(h.total_ms.p95.ratio)} |`,
    `| per-intent overhead_ms mean (total − hold) | ${f2(h.overhead_ms.mean.atm)} | ${f2(h.overhead_ms.mean.control)} | ${f2(h.overhead_ms.mean.delta_ms)} ms | ${fx(h.overhead_ms.mean.ratio)} |`,
    `| per-intent overhead_ms p95 | ${f2(h.overhead_ms.p95.atm)} | ${f2(h.overhead_ms.p95.control)} | ${f2(h.overhead_ms.p95.delta_ms)} ms | ${fx(h.overhead_ms.p95.ratio)} |`,
    '', `Per-rep wall ms — ATM: ${h.wall_clock_ms.atm_per_rep.join(', ')} · control: ${h.wall_clock_ms.control_per_rep.join(', ')}`,
    `Per-rep throughput — ATM: ${h.throughput_intents_per_s.atm_per_rep.join(', ')} · control: ${h.throughput_intents_per_s.control_per_rep.join(', ')}`);
  L.push('', '## Per-intent phases (pooled over reps; ms)', '', '| field | ATM mean | ATM p50 | ATM p95 | ATM max | ctrl mean | ctrl p50 | ctrl p95 | ctrl max | Δ mean | Δ p95 |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [f, v] of Object.entries(cmp.per_intent)) {
    L.push(`| ${f} | ${f2(v.mean.atm)} | ${f2(v.p50.atm)} | ${f2(v.p95.atm)} | ${f2(v.max.atm)} | ${f2(v.mean.control)} | ${f2(v.p50.control)} | ${f2(v.p95.control)} | ${f2(v.max.control)} | ${f2(v.mean.delta_ms)} | ${f2(v.p95.delta_ms)} |`);
  }
  L.push('', '## Cold vs hot (by fixture temperature; ms)', '', '| temp | n (ATM/ctrl) | field | ATM p50 | ATM p95 | ctrl p50 | ctrl p95 | Δ p50 | Δ p95 |', '|---|---|---|---|---|---|---|---|---|');
  for (const [t, v] of Object.entries(cmp.by_temperature)) {
    for (const f of ['latency_ms', 'apply_ms', 'overhead_ms', 'total_ms']) {
      L.push(`| ${t} | ${v.n.atm}/${v.n.control} | ${f} | ${f2(v[f].p50.atm)} | ${f2(v[f].p95.atm)} | ${f2(v[f].p50.control)} | ${f2(v[f].p95.control)} | ${f2(v[f].p50.delta_ms)} | ${f2(v[f].p95.delta_ms)} |`);
    }
  }
  L.push('', '## ATM latency by decision class (ms)', '', '| decision | n | latency p50 | latency p95 | wait p95 | overhead p50 | overhead p95 | total p50 | total p95 |', '|---|---|---|---|---|---|---|---|---|');
  for (const [d, v] of Object.entries(cmp.atm_by_decision)) {
    L.push(`| ${d} | ${v.n} | ${f2(v.latency_ms.p50)} | ${f2(v.latency_ms.p95)} | ${f2(v.wait_ms.p95)} | ${f2(v.overhead_ms.p50)} | ${f2(v.overhead_ms.p95)} | ${f2(v.total_ms.p50)} | ${f2(v.total_ms.p95)} |`);
  }
  L.push('', '## Paired per-intent Δ (same intent_id, ATM − control; ms)', '', '| group | n | Δtotal mean | Δtotal p50 | Δtotal p95 | Δoverhead mean | Δoverhead p95 |', '|---|---|---|---|---|---|---|');
  for (const [g, v] of Object.entries(cmp.paired_by)) {
    L.push(`| ${g} | ${v.n} | ${f2(v.total_ms_delta.mean)} | ${f2(v.total_ms_delta.p50)} | ${f2(v.total_ms_delta.p95)} | ${f2(v.overhead_ms_delta.mean)} | ${f2(v.overhead_ms_delta.p95)} |`);
  }
  return L.join('\n') + '\n';
}

export function readEvents(runDir, mode) {
  const dir = join(runDir, mode, 'events');
  if (!existsSync(dir)) return { events: [], bytes: 0, files: 0 };
  let bytes = 0; const events = []; const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  for (const f of files) {
    const p = join(dir, f); bytes += statSync(p).size;
    for (const line of readFileSync(p, 'utf8').split('\n')) if (line.trim()) events.push(JSON.parse(line));
  }
  return { events, bytes, files: files.length };
}

function emptyModeSummary() {
  return {
    events_total: 0, event_files: 0, bytes: 0, duration_ms: null, trials: 0, intents: 0,
    event_types: {}, decision_hist: {}, reason_hist: {}, outcome_hist: {}, oracle_hist: {},
    agents: {}, vendors: {}, expected_vs_decision: {},
    wait_ms: { mean_all: 0, mean_nonzero: 0, p95_all: 0, max: 0, n_nonzero: 0 },
    wait_ms_by_decision: {}, serialized: 0, composer: 0, cas_retry: 0, racy_overwrite: 0,
    committed: 0, oracle_pass: 0, lost_updates: 0,
    integration_pass_rate_of_committed: null, effective_success_rate_of_intents: null, contended_intents: 0,
    present: false, latency: { timing_available: false, run: {} },
  };
}

function summarizeMode(evs, bytes, files, modeMeta) {
  if (!evs.length && !files) return emptyModeSummary();
  const decisions = evs.filter((e) => e.event === 'decision');
  const oracle = evs.filter((e) => e.event === 'oracle');
  const s = {
    present: true, events_total: evs.length, event_files: files, bytes, duration_ms: modeMeta?.duration_ms ?? null,
    trials: new Set(decisions.map((e) => e.trial_id)).size, intents: decisions.length,
    event_types: {}, decision_hist: {}, reason_hist: {}, outcome_hist: {}, oracle_hist: {},
    agents: {}, vendors: {}, expected_vs_decision: {},
  };
  evs.forEach((e) => inc(s.event_types, e.event));
  for (const e of decisions) {
    inc(s.decision_hist, e.decision); inc(s.reason_hist, e.reason_code); inc(s.outcome_hist, e.outcome);
    inc(s.agents, e.agent_id); inc(s.vendors, e.vendor);
    s.expected_vs_decision[e.expected_class] ??= {}; inc(s.expected_vs_decision[e.expected_class], e.decision);
  }
  oracle.forEach((e) => inc(s.oracle_hist, e.outcome));
  const waits = decisions.map((e) => e.wait_ms || 0);
  const waited = waits.filter((w) => w > 0);
  s.wait_ms = { mean_all: r1(mean(waits)), mean_nonzero: r1(mean(waited)), p95_all: pct(waits, 0.95), max: Math.max(0, ...waits), n_nonzero: waited.length };
  s.wait_ms_by_decision = {};
  for (const d of Object.keys(s.decision_hist)) {
    const w = decisions.filter((e) => e.decision === d).map((e) => e.wait_ms || 0);
    s.wait_ms_by_decision[d] = { n: w.length, mean: r1(mean(w)), p95: pct(w, 0.95) };
  }
  s.serialized = decisions.filter((e) => e.serialized).length;
  s.composer = decisions.filter((e) => e.composer).length;
  s.cas_retry = decisions.filter((e) => e.cas_retry).length;
  s.racy_overwrite = decisions.filter((e) => e.reason_code === 'racy_overwrite').length;
  s.committed = s.outcome_hist.commit ?? 0;
  s.oracle_pass = s.oracle_hist.test_pass ?? 0;
  s.lost_updates = s.oracle_hist.test_fail ?? 0;
  s.integration_pass_rate_of_committed = s.committed ? r1((100 * s.oracle_pass) / s.committed) : null;
  s.effective_success_rate_of_intents = s.intents ? r1((100 * s.oracle_pass) / s.intents) : null;
  s.contended_intents = decisions.filter((e) => e.expected_class !== 'no_conflict').length;
  s.latency = latencySummary(decisions, oracle, modeMeta);
  return s;
}

export function exportRun(runDir, { fixtureDir } = {}) {
  const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8'));
  const out = join(runDir, 'export'); mkdirSync(out, { recursive: true });
  const per = {}; const raw = {};
  for (const m of MODES) {
    const { events, bytes, files } = readEvents(runDir, m);
    raw[m] = events;
    per[m] = summarizeMode(events, bytes, files, meta.modes?.[m]);
  }
  const repro = { meta_hash: meta.scenario_hash };
  for (const m of MODES) {
    const p = join(runDir, m, 'scenarios', 'sha256.txt');
    repro[`${m}_snapshot_hash`] = existsSync(p) ? readFileSync(p, 'utf8').trim() : null;
  }
  if (fixtureDir) repro.regenerated_hash = scenarioHash(generateScenarios(loadManifest(fixtureDir), meta.scenario_seed, meta.params));
  const presentHashes = Object.values(repro).filter(Boolean);
  repro.all_equal = presentHashes.length > 0 && new Set(presentHashes).size === 1;

  const idx = (evs) => {
    const map = new Map();
    for (const e of evs) {
      const r = map.get(e.intent_id) ?? {
        intent_id: e.intent_id, trial_id: e.trial_id, agent_id: e.agent_id, vendor: e.vendor,
        path: e.path, region: e.region, temperature: e.temperature,
      };
      if (e.event === 'decision') Object.assign(r, {
        expected_class: e.expected_class, decision: e.decision, reason_code: e.reason_code,
        wait_ms: e.wait_ms, outcome: e.outcome, atm_disposition: e.atm_disposition, atm_verdict: e.atm_verdict,
        latency_ms: e.latency_ms, apply_ms: e.apply_ms, total_ms: e.total_ms, overhead_ms: e.overhead_ms,
      });
      if (e.event === 'oracle') r.oracle = e.outcome;
      map.set(e.intent_id, r);
    }
    return map;
  };
  const A = idx(raw.atm), C = idx(raw.control);
  const ids = [...new Set([...A.keys(), ...C.keys()])].sort();
  const cols = ['intent_id', 'trial_id', 'agent_id', 'vendor', 'path', 'region', 'temperature',
    'atm_expected_class', 'atm_decision', 'atm_reason_code', 'atm_disposition', 'atm_wait_ms', 'atm_outcome', 'atm_oracle',
    'control_expected_class', 'control_decision', 'control_reason_code', 'control_outcome', 'control_oracle',
    'atm_latency_ms', 'atm_apply_ms', 'atm_total_ms', 'atm_overhead_ms',
    'control_latency_ms', 'control_apply_ms', 'control_total_ms', 'control_overhead_ms'];
  const rows = ids.map((id) => {
    const a = A.get(id) ?? {}, c = C.get(id) ?? {}, b = A.get(id) ?? c;
    return [id, b.trial_id, b.agent_id, b.vendor, b.path, b.region, b.temperature,
      a.expected_class, a.decision, a.reason_code, a.atm_disposition, a.wait_ms, a.outcome, a.oracle ?? (a.outcome === 'commit' ? '' : 'n/a'),
      c.expected_class, c.decision, c.reason_code, c.outcome, c.oracle,
      a.latency_ms, a.apply_ms, a.total_ms, a.overhead_ms, c.latency_ms, c.apply_ms, c.total_ms, c.overhead_ms];
  });
  writeFileSync(join(out, 'trials.csv'), [cols.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n');

  const aligned = {
    both_present: ids.filter((i) => A.has(i) && C.has(i)).length,
    atm_only: ids.filter((i) => !C.has(i)).length,
    control_only: ids.filter((i) => !A.has(i)).length,
  };
  const cross = {};
  for (const id of ids) {
    const a = A.get(id), c = C.get(id); if (!a || !c || a.expected_class === 'no_conflict') continue;
    inc(cross, `atm:${a.oracle ?? a.outcome} / control:${c.oracle ?? c.outcome}`);
  }

  const dec = [['mode', 'decision', 'count', 'mean_wait_ms', 'p95_wait_ms', 'p50_latency_ms', 'p95_latency_ms', 'p50_total_ms', 'p95_total_ms', 'p95_overhead_ms']];
  for (const m of MODES) {
    for (const [d, n] of Object.entries(per[m].decision_hist)) {
      const L = per[m].latency?.by_decision?.[d];
      dec.push([m, d, n, per[m].wait_ms_by_decision[d].mean, per[m].wait_ms_by_decision[d].p95,
        L?.latency_ms.p50, L?.latency_ms.p95, L?.total_ms.p50, L?.total_ms.p95, L?.overhead_ms.p95]);
    }
  }
  // timings.csv: one row per decision event, for plotting
  const tcols = ['mode', 'intent_id', 'agent_id', 'temperature', 'decision', 'outcome', ...LAT_FIELDS, 't_submit_ms', 't_done_ms'];
  const trows = MODES.flatMap((m) => raw[m].filter((e) => e.event === 'decision').map((e) => [m, e.intent_id, e.agent_id, e.temperature, e.decision, e.outcome, ...LAT_FIELDS.map((f) => e[f]), e.t_submit_ms, e.t_done_ms]));
  writeFileSync(join(out, 'timings.csv'), [tcols.join(','), ...trows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n');
  writeFileSync(join(out, 'decisions.csv'), dec.map((r) => r.map(csvCell).join(',')).join('\n') + '\n');

  let latency_slowdown = null;
  if (per.atm.latency?.timing_available && per.control.latency?.timing_available) {
    const a = per.atm.latency, c = per.control.latency;
    latency_slowdown = {
      wall_clock_x: ratio(a.run.wall_clock_ms, c.run.wall_clock_ms), wall_clock_delta_ms: delta(a.run.wall_clock_ms, c.run.wall_clock_ms),
      throughput_slowdown_x: ratio(c.run.throughput_intents_per_s, a.run.throughput_intents_per_s),
      total_ms_mean_x: ratio(a.per_intent.total_ms.mean, c.per_intent.total_ms.mean), total_ms_mean_delta: delta(a.per_intent.total_ms.mean, c.per_intent.total_ms.mean),
      total_ms_p95_x: ratio(a.per_intent.total_ms.p95, c.per_intent.total_ms.p95), total_ms_p95_delta: delta(a.per_intent.total_ms.p95, c.per_intent.total_ms.p95),
      overhead_ms_mean_delta: delta(a.per_intent.overhead_ms.mean, c.per_intent.overhead_ms.mean),
      overhead_ms_p95_delta: delta(a.per_intent.overhead_ms.p95, c.per_intent.overhead_ms.p95),
    };
  }
  const summary = {
    latency_slowdown, cli_version: meta.cli_version, node_version: meta.modes?.atm?.node_version ?? meta.modes?.control?.node_version ?? null,
    run_id: meta.run_id, scenario_seed: meta.scenario_seed, params: meta.params,
    atm_backend: meta.atm_backend, atm_version: meta.atm_version ?? null, label: meta.label ?? null,
    writer: meta.writer, generated_at: new Date().toISOString(), reproducibility: repro, alignment: aligned,
    contended_outcome_crosstab: cross, modes: per,
    data_volume: {
      events_total: per.atm.events_total + per.control.events_total,
      bytes: per.atm.bytes + per.control.bytes,
      duration_ms: (per.atm.duration_ms ?? 0) + (per.control.duration_ms ?? 0),
    },
  };
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(out, 'summary.md'), renderMarkdown(summary));
  return summary;
}

const fmtHist = (h) => Object.entries(h || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ') || '—';

export function renderMarkdown(s, { title = `atm-bench export — ${s.run_id}`, conclusion } = {}) {
  const a = s.modes.atm || emptyModeSummary();
  const c = s.modes.control || emptyModeSummary();
  const backendLabel = s.atm_backend === 'real' ? 'REAL ATM monorepo broker'
    : s.atm_backend === 'none' ? 'none (control-only run)'
    : 'mock broker';
  const allDec = [...new Set([...Object.keys(a.decision_hist), ...Object.keys(c.decision_hist)])];
  const row = (label, f) => `| ${label} | ${a.present ? f(a) : '—'} | ${c.present ? f(c) : '—'} |`;
  const lines = [
    `# ${title}`, '',
    `- run_id: \`${s.run_id}\` · scenario_seed: **${s.scenario_seed}** · atm_backend: **${s.atm_backend}** (${backendLabel}) · writer: ${s.writer}`,
    s.atm_version ? `- atm_version: \`${s.atm_version}\`` : null,
    s.label ? `- label: ${s.label}` : null,
    `- params: \`${JSON.stringify(s.params)}\``,
    `- scenario reproducibility: **${s.reproducibility.all_equal}** (\`${String(s.reproducibility.meta_hash).slice(0, 16)}…\`)`,
    `- alignment: ${s.alignment.both_present} both / atm_only=${s.alignment.atm_only} / control_only=${s.alignment.control_only}`,
    '', '## Headline numbers', '',
    `| metric | atm (${s.atm_backend}) | control (no ATM) |`, '|---|---|---|',
    row('trials', (m) => m.trials), row('intents (decision events)', (m) => m.intents),
    row('contended intents', (m) => m.contended_intents),
    row('events_total', (m) => m.events_total), row('event types', (m) => fmtHist(m.event_types)),
    row('bytes (JSONL)', (m) => m.bytes), row('duration_ms', (m) => m.duration_ms),
    row('distinct agents / vendors', (m) => `${Object.keys(m.agents).length} / ${Object.keys(m.vendors).join(',')}`),
    row('outcomes', (m) => fmtHist(m.outcome_hist)),
    row('committed', (m) => m.committed),
    row('oracle pass (marker survives)', (m) => m.oracle_pass),
    row('lost updates (oracle fail)', (m) => m.lost_updates),
    row('integration pass rate of committed', (m) => `${m.integration_pass_rate_of_committed}%`),
    row('effective success rate of all intents', (m) => `${m.effective_success_rate_of_intents}%`),
    row('racy_overwrite decisions', (m) => m.racy_overwrite),
    row('serialized (queued)', (m) => m.serialized), row('composer co-writes', (m) => m.composer), row('CAS rebase on apply', (m) => m.cas_retry),
    row('mean wait_ms (all intents)', (m) => m.wait_ms.mean_all),
    row('mean wait_ms (waited only)', (m) => `${m.wait_ms.mean_nonzero} (n=${m.wait_ms.n_nonzero})`),
    row('p95 / max wait_ms', (m) => `${m.wait_ms.p95_all} / ${m.wait_ms.max}`),
    '', '## Latency / throughput (performance.now ms)', '',
    `| metric | atm (${s.atm_backend}) | control (no ATM) |`, '|---|---|---|',
    row('timing available', (m) => m.latency.timing_available),
    row('wall_clock_ms (first submit→last decision)', (m) => m.latency.run.wall_clock_ms ?? '—'),
    row('throughput intents/s', (m) => m.latency.run.throughput_intents_per_s ?? '—'),
    row('goodput oracle-pass/s', (m) => m.latency.run.goodput_oracle_pass_per_s ?? '—'),
    ...['latency_ms', 'wait_ms', 'apply_ms', 'total_ms', 'overhead_ms'].map((f) =>
      row(`${f} mean / p50 / p95`, (m) => { const x = m.latency.per_intent?.[f]; return x ? `${x.mean} / ${x.p50} / ${x.p95}` : '—'; })),
    ...(s.latency_slowdown ? ['', `**ATM slowdown:** wall ${s.latency_slowdown.wall_clock_x}× (Δ ${s.latency_slowdown.wall_clock_delta_ms} ms), throughput ${s.latency_slowdown.throughput_slowdown_x}×, per-intent total mean Δ ${s.latency_slowdown.total_ms_mean_delta} ms (${s.latency_slowdown.total_ms_mean_x}×), p95 Δ ${s.latency_slowdown.total_ms_p95_delta} ms; overhead mean Δ ${s.latency_slowdown.overhead_ms_mean_delta} ms.`] : []),
    '', '## Decision histogram', '', '| decision | atm | control | atm mean wait_ms |', '|---|---|---|---|',
    ...allDec.map((d) => `| ${d} | ${a.decision_hist[d] ?? 0} | ${c.decision_hist[d] ?? 0} | ${a.wait_ms_by_decision[d]?.mean ?? '—'} |`),
    '', '## Reason codes', '', `- atm: ${fmtHist(a.reason_hist)}`, `- control: ${fmtHist(c.reason_hist)}`,
    '', '## Ground-truth label vs decision (atm)', '', '| expected_class | decisions |', '|---|---|',
    ...Object.entries(a.expected_vs_decision).map(([k, v]) => `| ${k} | ${fmtHist(v)} |`),
    '', '## Ground-truth label vs decision (control)', '', '| expected_class | decisions |', '|---|---|',
    ...Object.entries(c.expected_vs_decision).map(([k, v]) => `| ${k} | ${fmtHist(v)} |`),
    '', '## Contended intents: atm vs control final result', '',
    ...(Object.keys(s.contended_outcome_crosstab).length
      ? Object.entries(s.contended_outcome_crosstab).sort((x, y) => y[1] - x[1]).map(([k, v]) => `- ${k}: ${v}`)
      : ['- (single-mode run or no overlapping contended intents)']),
    '', '## Data volume', '',
    `- events_total=${s.data_volume.events_total}, bytes=${s.data_volume.bytes}, duration_ms=${s.data_volume.duration_ms}`,
  ].filter((x) => x !== null);
  if (conclusion) lines.push('', '## Feasibility conclusion', '', conclusion);
  return lines.join('\n') + '\n';
}

export function feasibilityConclusion(s) {
  const a = s.modes.atm || emptyModeSummary();
  const c = s.modes.control || emptyModeSummary();
  const backend = s.atm_backend;
  if (!a.present || !c.present) {
    return `Single-mode export for run \`${s.run_id}\` (atm_backend=${backend}). ` +
      `Present modes: atm=${a.present}, control=${c.present}. Use COMPARE_SMALL.md to align dual runs by scenario_seed.`;
  }
  return `Harness end-to-end on this box (Node ${process.version}), atm_backend=**${backend}**. ` +
    `Seed ${s.scenario_seed}; scenario hash equal=${s.reproducibility.all_equal}. ` +
    `${Object.keys(a.agents).length} concurrent agents. ` +
    `ATM committed ${a.committed}/${a.intents} with ${a.lost_updates} lost updates ` +
    `(decisions: ${fmtHist(a.decision_hist)}); control committed ${c.committed}/${c.intents} with ${c.lost_updates} lost ` +
    `(${c.racy_overwrite} racy overwrites). Effective success ${a.effective_success_rate_of_intents}% vs ${c.effective_success_rate_of_intents}%.`;
}
