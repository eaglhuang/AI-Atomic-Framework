// Multi-process run driver: forks N mp-worker.mjs processes that share ONE worktree + ONE ATM registry file.
import { fork } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modeDirs } from './runner.mjs';
import { agentForSlot, scenarioHash } from './scenario.mjs';
import { loadAtmApis } from './real-broker.mjs';
import { slug, tsTaipei } from './util.mjs';
import { scoreRunWorktree, writeOracleV2Artifacts } from './oracle_v2.mjs';
import { buildExpectedEffects, runOracle, writeExpectedEffects, writeOracleArtifacts, ORACLE_VERSION } from './oracle.mjs';
import { initWorktreeGit } from './steward-writer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const r2 = (x) => Math.round(x * 100) / 100;

export async function runModeMp({ runDir, run_id, mode, meta, scenarios, fixtureDir, procs, log = console.log }) {
  const p = meta.params;
  const d = modeDirs(runDir, mode);
  if (existsSync(d.base)) rmSync(d.base, { recursive: true, force: true });
  for (const k of ['scenarios', 'events', 'artifacts']) mkdirSync(d[k], { recursive: true });
  cpSync(fixtureDir, d.worktree, { recursive: true, filter: (src) => !src.endsWith('manifest.json') });
  // Steward / git_three_way need git HEAD for baseCommit (parity with single-process runMode).
  if (mode === 'atm' && (p.atm_writer === 'steward' || p.atm_writer === 'git_three_way' || p.atm_writer === 'bare_composer')) {
    initWorktreeGit(d.worktree);
  }
  writeFileSync(join(d.scenarios, 'scenarios.json'), JSON.stringify(scenarios, null, 2));
  writeFileSync(join(d.scenarios, 'sha256.txt'), scenarioHash(scenarios) + '\n');
  const expectedEffects = buildExpectedEffects(scenarios);
  writeExpectedEffects(join(d.scenarios, 'expected_effects.json'), expectedEffects, { run_id, mode });
  let api = null;
  const registryPath = join(d.worktree, '.atm/runtime/write-broker.registry.json');
  if (mode === 'atm') {
    api = await loadAtmApis();
    mkdirSync(dirname(registryPath), { recursive: true });
    api.saveRegistry(registryPath, api.createEmptyBrokerRegistryDocument({ repoId: 'atm-bench', workspaceId: 'atm-bench-worktree' }));
  }
  // slot -> worker assignment (round-robin); procs == n_agents => one agent per OS process
  const groups = Array.from({ length: procs }, () => []);
  for (let s = 0; s < p.n_agents; s++) groups[s % procs].push(s);
  const started_at = tsTaipei();
  const children = groups.map((slots, k) => fork(join(HERE, 'mp-worker.mjs'),
    ['--run-dir', runDir, '--mode', mode, '--slots', slots.join(','), '--worker', String(k)],
    { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }));
  const ready = await Promise.all(children.map((c) => new Promise((res, rej) => {
    c.on('message', (m) => { if (m?.type === 'ready') res(m); });
    c.on('exit', (code) => rej(new Error(`worker exited before ready: ${code}`)));
  })));
  const exits = children.map((c) => new Promise((res) => c.on('exit', (code, sig) => res({ pid: c.pid, code, sig }))));
  const t0Epoch = Date.now() + 150;
  children.forEach((c) => c.send({ type: 'go', t0Epoch }));
  const exitInfo = await Promise.all(exits);
  const finished_at = tsTaipei();

  const workers = readdirSync(join(d.base, 'mp')).filter((f) => f.startsWith('worker-'))
    .map((f) => JSON.parse(readFileSync(join(d.base, 'mp', f), 'utf8')));
  const first = Math.min(...workers.map((w) => w.first_submit_epoch_ms ?? Infinity));
  const last = Math.max(...workers.map((w) => w.last_decision_epoch_ms ?? -Infinity));
  const wall_clock_ms = r2(last - first);
  const intents = workers.reduce((a, w) => a + w.intents, 0);

  // Invariants from events: overlapping admitted holds on the same path#region / same path (cross-process)
  const evs = readdirSync(d.events).flatMap((f) => readFileSync(join(d.events, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  // C3 independent oracle (parent, after workers exit)
  const terminals = new Map();
  for (const e of evs.filter((x) => x.event === 'decision')) {
    terminals.set(e.intent_id, {
      outcome: e.outcome,
      steward_verdict: e.steward_verdict ?? null,
      batch_id: e.batch_id ?? null,
      agent_id: e.agent_id,
      path: e.path,
    });
  }
  const { results: oracleResults, summary: oracleSummary, file_digests } = runOracle({
    worktree: d.worktree, effects: expectedEffects, terminals,
  });
  writeOracleArtifacts(d.artifacts, { results: oracleResults, summary: oracleSummary, file_digests });
  // r2: oracle v2 (full bytes + frame/structure) as an additional artifact; never fails the run.
  try {
    const v2 = await scoreRunWorktree({ worktree: d.worktree, fixtureDir, effects: expectedEffects, terminals });
    await writeOracleV2Artifacts(d.artifacts, v2);
  } catch (e) { writeFileSync(join(d.artifacts, 'oracle_v2_error.txt'), String(e?.stack || e) + '\n'); }
  let pass = oracleSummary.test_pass, lost = oracleSummary.lost;
  for (const row of oracleResults) {
    const term = terminals.get(row.intent_id);
    if (!term) continue;
    appendFileSync(join(d.events, `${slug(term.agent_id)}.jsonl`), JSON.stringify({
      ts: tsTaipei(), run_id, mode, intent_id: row.intent_id, agent_id: term.agent_id, path: row.path,
      event: 'oracle', decision: null, wait_ms: 0,
      outcome: row.outcome, reason_code: row.reason_code,
      oracle_version: ORACLE_VERSION, oracle_verdict: row.oracle_verdict,
      effect_id: row.effect_id, logical_id: row.logical_id,
      occurrence_count: row.occurrence_count, output_digest: row.output_digest,
    }) + '\n');
  }
  const holds = evs.filter((e) => e.event === 'decision' && e.outcome === 'commit')
    .map((e) => ({ k: `${e.path}#${e.region}`, path: e.path, a: e.t_submit_ms + (e.latency_ms || 0), b: e.t_done_ms, comp: e.decision === 'composer_merge', pid: e.pid }));
  let sameRegion = 0, sameRegionXproc = 0, sameFile = 0;
  for (let i = 0; i < holds.length; i++) for (let j = i + 1; j < holds.length; j++) {
    const x = holds[i], y = holds[j];
    if (x.path !== y.path || !(x.a < y.b && y.a < x.b)) continue;
    sameFile++;
    if (x.k === y.k) { sameRegion++; if (x.pid !== y.pid) sameRegionXproc++; }
  }
  let residue = null;
  if (mode === 'atm') residue = api.loadRegistry(registryPath, { persistCleanup: false }).activeIntents.length;
  const sum = (k) => workers.reduce((a, w) => a + (w.broker_stats?.[k] ?? 0), 0);
  const mp = {
    procs, agents_per_proc: groups.map((g) => g.length), pids: workers.map((w) => w.pid).sort(),
    distinct_pids: new Set(workers.map((w) => w.pid)).size, parent_pid: process.pid,
    worker_exit: exitInfo, worker_rss_mb_end: workers.map((w) => w.rss_mb_end), worker_init_ms: ready.map((x) => r2(x.init_ms)), worker_errors: workers.reduce((a, w) => a + w.errors, 0),
    registry_path: mode === 'atm' ? registryPath : null, registry_sync: mode === 'atm' ? p.mp_registry_sync : null,
    apply_lock: mode === 'atm' ? p.mp_apply_lock : null,
    registry_txns: sum('txns'), registry_txns_retried: sum('txns_retried'), cas_conflicts: sum('cas_conflicts'), cas_lock_busy: sum('cas_lock_busy'), cas_stale_generation: sum('cas_stale_generation'), lock_busy: sum('lock_busy'),
    txn_retries_max: Math.max(0, ...workers.map((w) => w.broker_stats?.txn_retries_max ?? 0)),
    registry_polls: sum('polls'), apply_lock_spins: sum('apply_lock_spins'), registry_residue_active_intents: residue,
    overlapping_commit_holds: { same_file_pairs: sameFile, same_region_pairs: sameRegion, same_region_cross_process_pairs: sameRegionXproc },
    oracle: { ...oracleSummary, committed: pass + lost, pass, lost },
  };
  if (mode === 'atm') writeFileSync(join(d.artifacts, 'broker_decisions.jsonl'), workers.flatMap((w) => w.decisions).map((x) => JSON.stringify(x)).join('\n') + '\n');
  log(`[${mode}/mp] procs=${procs} intents=${intents} oracle_correct=${oracleSummary.correct} lost=${lost} wall_clock_ms=${wall_clock_ms} cas_conflicts=${mp.cas_conflicts}`);
  return {
    mode, started_at, finished_at, duration_ms: r2(last - t0Epoch), wall_clock_ms,
    throughput_intents_per_s: wall_clock_ms > 0 ? r2(intents / (wall_clock_ms / 1000)) : null,
    timing_clock: 'performance.timeOrigin+now() epoch ms across processes; wall = first submit -> last decision over all workers',
    timing_caveats: ['multi-process: each agent in its own Node process; shared worktree + ATM registry file', `writer=mock (atomic tmp+rename writes; atm_writer=${p.atm_writer})`],
    rss_mb_end: Math.max(...workers.map((w) => w.rss_mb_end ?? 0)), registry_active_end: residue,
    intents_processed: intents, atm_capability: mode === 'atm' ? { backend: 'real', process_model: 'multi-process', registry_sync: p.mp_registry_sync, apply_lock: p.mp_apply_lock } : null,
    agents: Array.from({ length: p.n_agents }, (_, s) => ({ ...agentForSlot(s), joined_at: started_at, mode, process: s % procs })),
    mp,
  };
}
