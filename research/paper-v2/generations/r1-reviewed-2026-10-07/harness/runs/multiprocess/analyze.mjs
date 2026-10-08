// Phase 2 analysis → runs/multiprocess/summary.{json,md}
import { writeFileSync } from 'node:fs';
import { arm, mean, r } from '../../src/arm-stats.mjs';
const RUNS = new URL('../', import.meta.url).pathname;
const reps = (p) => [1, 2, 3].map((i) => `${p}-r${i}`);
const ARMS = {
  A: [['control-sp', 'control single-process'], ['control-p6', 'control 6 procs'], ['atm-sp', 'REAL ATM single-process'], ['atm-p6', 'REAL ATM 6 procs (CAS registry)']],
  B: [['control-sp', 'control single-process'], ['control-p8', 'control 8 procs'], ['atm-sp', 'REAL ATM single-process'], ['atm-p8', 'REAL ATM 8 procs (CAS)'],
    ['atm-p4', 'REAL ATM 4 procs × 2 agents (CAS)'], ['atmloop-sp', 'REAL ATM + hot loop, single-process'], ['atmloop-p8', 'REAL ATM + hot loop, 8 procs (CAS)'],
    ['atmnaive-p8', 'REAL ATM 8 procs, NAIVE registry (loadRegistry/saveRegistry)'], ['atmnolock-p8', 'REAL ATM 8 procs, CAS, apply-lock OFF']],
};
const out = {};
const L = [];
for (const [sc, arms] of Object.entries(ARMS)) {
  out[sc] = {};
  for (const [k, label] of arms) {
    const a = arm(RUNS, label, reps(`mp-${sc}-${k}`)); if (!a) continue;
    const mp = a.extra;
    if (mp.length) {
      const s = (f) => r(mean(mp.map(f)), 1);
      a.mp = {
        procs: mp[0].procs, distinct_pids: mp.map((m) => m.distinct_pids), worker_exit_nonzero: mp.flatMap((m) => m.worker_exit).filter((x) => x.code !== 0).length,
        worker_init_ms_mean: s((m) => mean(m.worker_init_ms)), worker_errors: mp.reduce((x, m) => x + m.worker_errors, 0),
        registry_txns: s((m) => m.registry_txns), txns_retried: s((m) => m.registry_txns_retried ?? 0), cas_conflicts: s((m) => m.cas_conflicts),
        cas_lock_busy: s((m) => m.cas_lock_busy ?? 0), cas_stale_generation: s((m) => m.cas_stale_generation ?? 0), naive_lock_busy: s((m) => m.lock_busy),
        txn_retries_max: Math.max(...mp.map((m) => m.txn_retries_max)), polls: s((m) => m.registry_polls), apply_lock_spins: s((m) => m.apply_lock_spins),
        registry_residue: mp.map((m) => m.registry_residue_active_intents),
        same_file_pairs: s((m) => m.overlapping_commit_holds.same_file_pairs), same_region_pairs: s((m) => m.overlapping_commit_holds.same_region_pairs),
        same_region_xproc_pairs: s((m) => m.overlapping_commit_holds.same_region_cross_process_pairs),
      };
    }
    delete a.extra;
    out[sc][k] = a;
  }
  L.push(`\n### Scenario ${sc}\n`, '| arm | wall ms | thr int/s | goodput/s | commits/rep | lost/rep (rate) | rejects | timeouts | errors | hist/rep | total mean/p95 | overhead mean/p95 | latency p50/p95 | wait p95/max |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, a] of Object.entries(out[sc])) {
    const h = Object.entries(a.decision_hist).map(([d, n]) => `${d} ${r(n / a.reps, 1)}`).join(', ');
    L.push(`| ${k} | ${a.wall_clock_ms.mean} | ${a.throughput_intents_per_s} | ${a.goodput_pass_per_s} | ${a.commits_per_rep} | ${a.lost_updates_per_rep} (${(a.lost_update_rate_of_commits * 100).toFixed(1)}%) | ${a.rejects_per_rep} | ${a.timeouts_per_rep} | ${a.errors_per_rep} | ${h} | ${a.total_ms.mean} / ${a.total_ms.p95} | ${a.overhead_ms.mean} / ${a.overhead_ms.p95} | ${a.latency_ms.p50} / ${a.latency_ms.p95} | ${a.wait_ms_all.p95} / ${a.wait_ms_all.max} |`);
  }
  L.push('', '| arm (mp only) | distinct pids/rep | init ms | registry txns/rep | txns retried/rep | CAS conflicts (lock-busy / stale-gen) | naive lock-busy | max retries | polls | apply-lock spins | residue | overlapping holds same-file / same-region / same-region cross-proc |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, a] of Object.entries(out[sc])) if (a.mp) {
    const m = a.mp;
    L.push(`| ${k} | ${m.distinct_pids.join(',')} | ${m.worker_init_ms_mean} | ${m.registry_txns} | ${m.txns_retried} | ${m.cas_conflicts} (${m.cas_lock_busy} / ${m.cas_stale_generation}) | ${m.naive_lock_busy} | ${m.txn_retries_max} | ${m.polls} | ${m.apply_lock_spins} | ${m.registry_residue.join(',')} | ${m.same_file_pairs} / ${m.same_region_pairs} / ${m.same_region_xproc_pairs} |`);
  }
  L.push('', 'per-rep wall: ' + Object.entries(out[sc]).map(([k, a]) => `${k} [${a.wall_clock_ms.per_rep.join(', ')}]`).join('; '));
}
writeFileSync(new URL('summary.json', import.meta.url), JSON.stringify(out, null, 2));
writeFileSync(new URL('summary.md', import.meta.url), L.join('\n') + '\n');
console.log(L.join('\n'));
