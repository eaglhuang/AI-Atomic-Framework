// Phase 3 analysis → runs/scale/summary.{json,md}
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { arm, loadRun, pct, mean, r } from '../../src/arm-stats.mjs';
const RUNS = new URL('../', import.meta.url).pathname;
const SC = {
  S1: { reps: [1, 2], win: 50, arms: ['control-sp', 'control-p8', 'atm-sp', 'atm-p8'] },
  S2: { reps: [1], win: 50, arms: ['control-sp', 'atmloop-sp', 'atmloop-p8'] },
  S4: { reps: [1], win: 50, arms: ['control-sp', 'atm-sp', 'atm-p8'] },
  S3: { reps: [1], win: 100, arms: ['control-sp', 'atm-sp', 'atm-p8'] },
};
const out = {}, L = [];
for (const [sc, cfg] of Object.entries(SC)) {
  out[sc] = {};
  L.push(`\n### ${sc}\n`, '| arm | reps | intents/rep | wall ms (per rep) | thr int/s | goodput/s | success % of intents | commits/rep | lost/rep (rate) | rejects | timeouts | errors | hist/rep | overhead mean/p95/max | latency p95 | wait p95/max | sched lag p95/max | RSS MB end | registry active end |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const k of cfg.arms) {
    const ids = cfg.reps.map((R) => `sc-${sc}-${k}-r${R}`).filter((id) => existsSync(`${RUNS}/${id}/meta.json`));
    const a = arm(RUNS, `${sc} ${k}`, ids); if (!a) continue;
    const runs = ids.map((id) => loadRun(RUNS, id));
    a.rss_mb_end = runs.map((x) => x.mm.rss_mb_end ?? null);
    a.registry_active_end = runs.map((x) => x.mm.registry_active_end ?? null);
    a.mp = runs.map((x) => x.mm.mp).filter(Boolean).map((m) => ({ procs: m.procs, distinct_pids: m.distinct_pids, worker_rss_mb_end: m.worker_rss_mb_end, txns: m.registry_txns,
      txns_retried: m.registry_txns_retried, cas_conflicts: m.cas_conflicts, cas_lock_busy: m.cas_lock_busy, cas_stale_generation: m.cas_stale_generation,
      txn_retries_max: m.txn_retries_max, polls: m.registry_polls, apply_lock_spins: m.apply_lock_spins, residue: m.registry_residue_active_intents,
      worker_exit_nonzero: m.worker_exit.filter((x) => x.code !== 0).length, worker_errors: m.worker_errors, overlapping: m.overlapping_commit_holds }));
    // drift by trial window (pooled reps)
    const dec = runs.flatMap((x) => x.dec);
    const orcLost = new Set(runs.flatMap((x) => x.orc.filter((e) => e.reason_code === 'lost_update').map((e) => `${e.run_id}|${e.intent_id}`)));
    const byW = {};
    for (const e of dec) { const w = Math.floor(+e.trial_id.slice(1) / cfg.win); (byW[w] ??= []).push(e); }
    a.drift = Object.entries(byW).map(([w, es]) => ({
      window: `t${w * cfg.win}-${(+w + 1) * cfg.win - 1}`, n: es.length,
      overhead_p50: r(pct(es.map((e) => e.overhead_ms || 0), 0.5)), overhead_p95: r(pct(es.map((e) => e.overhead_ms || 0), 0.95)),
      latency_p95: r(pct(es.map((e) => e.latency_ms || 0), 0.95)), sched_lag_p95: r(pct(es.map((e) => e.schedule_lag_ms || 0), 0.95)),
      rejects: es.filter((e) => e.outcome === 'reject').length, lost: es.filter((e) => orcLost.has(`${e.run_id}|${e.intent_id}`)).length,
    }));
    out[sc][k] = a;
    const h = Object.entries(a.decision_hist).map(([d, n]) => `${d} ${r(n / a.reps, 1)}`).join(', ');
    L.push(`| ${k} | ${a.reps} | ${a.intents_per_rep} | ${a.wall_clock_ms.mean} (${a.wall_clock_ms.per_rep.join(', ')}) | ${a.throughput_intents_per_s} | ${a.goodput_pass_per_s} | ${(a.success_rate_of_intents * 100).toFixed(1)} | ${a.commits_per_rep} | ${a.lost_updates_per_rep} (${(a.lost_update_rate_of_commits * 100).toFixed(1)}%) | ${a.rejects_per_rep} | ${a.timeouts_per_rep} | ${a.errors_per_rep} | ${h} | ${a.overhead_ms.mean} / ${a.overhead_ms.p95} / ${a.overhead_ms.max} | ${a.latency_ms.p95} | ${a.wait_ms_all.p95} / ${a.wait_ms_all.max} | ${a.schedule_lag_ms.p95} / ${a.schedule_lag_ms.max} | ${a.rss_mb_end.join(', ')}${a.mp.length ? ' (workers max ' + Math.max(...a.mp.flatMap((m) => m.worker_rss_mb_end)) + ')' : ''} | ${a.registry_active_end.join(', ')} |`);
  }
  L.push('', '| arm (mp) | rep | distinct pids | txns | retried | CAS conflicts (lock-busy/stale) | max retries | polls | apply spins | residue | exit≠0 | errors | overlap same-file/same-region |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, a] of Object.entries(out[sc])) a.mp.forEach((m, i) => L.push(`| ${k} | r${i + 1} | ${m.distinct_pids} | ${m.txns} | ${m.txns_retried} | ${m.cas_conflicts} (${m.cas_lock_busy}/${m.cas_stale_generation}) | ${m.txn_retries_max} | ${m.polls} | ${m.apply_lock_spins} | ${m.residue} | ${m.worker_exit_nonzero} | ${m.worker_errors} | ${m.overlapping.same_file_pairs}/${m.overlapping.same_region_pairs} |`));
  L.push('', `Drift by trial window (${cfg.win} trials; pooled reps): overhead p50/p95 · latency p95 · sched-lag p95 · rejects · lost`, '');
  const ks = Object.keys(out[sc]);
  L.push('| window | ' + ks.join(' | ') + ' |', '|---|' + ks.map(() => '---').join('|') + '|');
  const wins = out[sc][ks[0]].drift.map((d) => d.window);
  for (const w of wins) L.push(`| ${w} | ` + ks.map((k) => { const d = out[sc][k].drift.find((x) => x.window === w); return d ? `${d.overhead_p50}/${d.overhead_p95} · ${d.latency_p95} · ${d.sched_lag_p95} · ${d.rejects} · ${d.lost}` : '—'; }).join(' | ') + ' |');
}
writeFileSync(new URL('summary.json', import.meta.url), JSON.stringify(out, null, 2));
writeFileSync(new URL('summary.md', import.meta.url), L.join('\n') + '\n');
console.log(L.join('\n'));
