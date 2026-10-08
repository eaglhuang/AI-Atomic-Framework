#!/usr/bin/env node
// atm-bench CLI — mock | real ATM backends; dual mode runs (atm vs control).
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_PARAM_KEYS, DEFAULT_PARAMS, generateScenarios, loadManifest, scenarioHash } from './scenario.mjs';
import { CLI_VERSION, runMode } from './runner.mjs';
import { runModeMp } from './mp-runner.mjs';
import { compareLatency, exportRun, feasibilityConclusion, readEvents, renderCompareLatency, renderMarkdown } from './export.mjs';
import { tsTaipei } from './util.mjs';
import { atmVersionLabel, requireNodeForRealAtm, resolveAtmMonorepo } from './atm-resolve.mjs';
import { ARM_DEFS, armEventFields, armHelpText, resolveArm } from './arms.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'fixture');
const SMOKE = { trial_count: 40, n_agents: 4, hot_ratio: 0.4 };
const SMALL = { trial_count: 30, n_agents: 6, hot_ratio: 0.4, overlap: 'med', cold_policy: 'queue' };

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'run-id': { type: 'string' },
    mode: { type: 'string' },
    seed: { type: 'string' },
    'scheduler-seed': { type: 'string' },  // E2: timing PRNG; must differ from --seed (workload)
    'trial-count': { type: 'string' },
    trials: { type: 'string' },           // alias
    'n-agents': { type: 'string' },
    agents: { type: 'string' },           // alias --agents 4..8
    'hot-ratio': { type: 'string' },
    overlap: { type: 'string' },
    'cold-policy': { type: 'string' },
    'cold-atom-identity': { type: 'string' },  // intent | region (real backend)
    'cold-retry': { type: 'string' },          // once | loop | native-queue (real backend)
    'queue-timeout-ms': { type: 'string' },
    'hot-retry': { type: 'string' },           // none | loop (real backend overlay on hot true-conflict)
    'compose-window-ms': { type: 'string' },   // steward writer compose batch window (ms)
    'occ-max-retries': { type: 'string' },     // D2 OCC max CAS rebuilds (default 8)
    'atm-writer': { type: 'string' },          // sync | stale | steward (atm arm writer model)
    arm: { type: 'string' },                   // steward|ideal_sync|admission_only|raw_overwrite (sets mode+writer)
    procs: { type: 'string' },                 // run-mp: number of OS processes
    'registry-sync': { type: 'string' },       // run-mp: cas | naive
    'apply-lock': { type: 'string' },          // run-mp: on | off
    'steward-apply-lock': { type: 'string' },  // run-mp (r2): on | off — serialize steward compose+apply across processes
    'no-composer': { type: 'boolean' },
    'tick-interval-ms': { type: 'string' },
    'hold-ms-min': { type: 'string' },
    'hold-ms-max': { type: 'string' },
    'jitter-ms': { type: 'string' },
    'atm-run': { type: 'string' },
    'control-run': { type: 'string' },
    json: { type: 'string' },
    'agent-id': { type: 'string' },
    vendor: { type: 'string' },
    'output-dir': { type: 'string' },
    'atm-backend': { type: 'string' },    // mock | real
    force: { type: 'boolean' },
    report: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});
const cmd = positionals[0];

function usage() {
  console.log(`atm-bench ${CLI_VERSION}
Usage:
  atm-bench run-smoke [--run-id ID] [--seed 42] [--atm-backend mock|real] [--force] [--report PATH]
  atm-bench run-small --mode atm|control --seed N [--run-id ID] [--agents 4..8] [--trials 20..40]
                      [--atm-backend real|mock] [--force]
  atm-bench start --run-id ID --seed N [--arm steward|file_lock|occ|git_three_way|bare_composer|ideal_sync|admission_only|raw_overwrite]
                  [--mode atm|control|both] [--atm-writer sync|stale|steward|file_lock|occ|git_three_way|bare_composer] [--occ-max-retries N] [--atm-backend mock|real]
                  [--agents N] [--trials N] [--hot-ratio X] [--overlap low|med|high|cold-same-file|cold-one-file]
                  [--cold-policy queue|block] [--cold-atom-identity intent|region] [--cold-retry once|loop|native-queue]
                  [--queue-timeout-ms N] [--hot-retry none|loop] [--compose-window-ms N] [--no-composer] [--tick-interval-ms N]
                  [--hold-ms-min N] [--hold-ms-max N] [--jitter-ms N]   (timing knobs; change scenario hash)
                  [--scheduler-seed N]  (E2: hold/jitter PRNG; default=workload --seed; prefer ≠ --seed)
                  [--agent-id vendor:session --vendor cursor|claude|codex|other] [--force]
                  Note: --arm sets mode+atm_writer (overrides). ONLY --arm steward is RQ2 main_method.
                  Main (frozen): --arm steward --atm-backend real --compose-window-ms 100  (ATM_MONOREPO=5692474f…)
  atm-bench run-mp --mode atm|control --seed N --run-id ID [--procs N (default=agents)] [--agents N] [--trials N]
                  [--registry-sync cas|naive] [--apply-lock on|off] [--steward-apply-lock on|off] [...start knobs]   (one OS process per agent; shared worktree+registry)
  atm-bench tick   --run-id ID --mode atm|control --agent-id A
  atm-bench status --run-id ID
  atm-bench stop   --run-id ID --mode atm|control
  atm-bench export --run-id ID [--report path.md]
  atm-bench compare --run-id-a ID --run-id-b ID   (or same run_id with both modes via export)
  atm-bench compare-latency --atm-run ID[,ID…] --control-run ID[,ID…] [--report COMPARE_LATENCY.md] [--json out.json]
                  ATM slowdown vs control (ratios + absolute ms). Comma lists = repetitions (pooled + per-rep).

Common: --output-dir DIR (default ./runs, must stay inside the harness dir)
Note: atm_backend=real requires Node ≥22 and local AI-Atomic-Framework monorepo.
${armHelpText()}`);
}

function outputDir() {
  const dir = resolve(ROOT, o['output-dir'] ?? 'runs');
  const rel = relative(ROOT, dir);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`--output-dir must stay inside ${ROOT}`);
  return dir;
}
const need = (k) => { if (!o[k]) throw new Error(`--${k} is required`); return o[k]; };
const runDirOf = (id) => join(outputDir(), id);

function resolveBackend() {
  const b = (o['atm-backend'] ?? process.env.ATM_BENCH_BACKEND ?? 'mock').toLowerCase();
  if (b !== 'mock' && b !== 'real') throw new Error('--atm-backend must be mock|real');
  if (b === 'real') {
    requireNodeForRealAtm();
    resolveAtmMonorepo(); // fail early if missing
  }
  return b;
}

function paramsFromArgs(defaults = {}) {
  const p = { ...DEFAULT_PARAMS, ...defaults };
  const trials = o['trial-count'] ?? o.trials;
  const agents = o['n-agents'] ?? o.agents;
  if (trials) p.trial_count = +trials;
  if (agents) p.n_agents = +agents;
  if (o['hot-ratio']) p.hot_ratio = +o['hot-ratio'];
  if (o.overlap) p.overlap = o.overlap;
  if (o['cold-policy']) p.cold_policy = o['cold-policy'];
  if (o['cold-atom-identity']) p.cold_atom_identity = o['cold-atom-identity'];
  if (o['cold-retry']) p.cold_retry = o['cold-retry'];
  if (o['queue-timeout-ms'] != null) p.queue_timeout_ms = +o['queue-timeout-ms'];
  if (o['hot-retry']) p.hot_retry = o['hot-retry'];
  if (o['atm-writer']) p.atm_writer = o['atm-writer'];
  if (o['compose-window-ms'] != null) p.compose_window_ms = +o['compose-window-ms'];
  if (o['occ-max-retries'] != null) p.occ_max_retries = +o['occ-max-retries'];
  if (o['registry-sync']) p.mp_registry_sync = o['registry-sync'];
  if (o['apply-lock']) p.mp_apply_lock = o['apply-lock'];
  if (o['steward-apply-lock']) p.mp_steward_apply_lock = o['steward-apply-lock'];
  if (p.mp_steward_apply_lock != null && !['on', 'off'].includes(p.mp_steward_apply_lock)) throw new Error('--steward-apply-lock must be on|off');
  if (!['cas', 'naive'].includes(p.mp_registry_sync)) throw new Error('--registry-sync must be cas|naive');
  if (!['on', 'off'].includes(p.mp_apply_lock)) throw new Error('--apply-lock must be on|off');
  if (!['none', 'loop'].includes(p.hot_retry)) throw new Error('--hot-retry must be none|loop');
  if (!['sync', 'stale', 'steward', 'file_lock', 'occ', 'git_three_way', 'bare_composer'].includes(p.atm_writer)) throw new Error('--atm-writer must be sync|stale|steward|file_lock|occ|git_three_way|bare_composer');
  if (p.occ_max_retries != null && (p.occ_max_retries < 0 || p.occ_max_retries > 64)) throw new Error('--occ-max-retries must be 0..64');
  if (!['intent', 'region'].includes(p.cold_atom_identity)) throw new Error('--cold-atom-identity must be intent|region');
  if (!['once', 'loop', 'native-queue'].includes(p.cold_retry)) throw new Error('--cold-retry must be once|loop|native-queue');
  if (o['no-composer']) p.composer_enabled = false;
  if (o['tick-interval-ms'] != null) p.tick_interval_ms = +o['tick-interval-ms'];
  if (o['hold-ms-min'] != null) p.hold_ms_min = +o['hold-ms-min'];
  if (o['hold-ms-max'] != null) p.hold_ms_max = +o['hold-ms-max'];
  if (o['jitter-ms'] != null) p.jitter_ms = +o['jitter-ms'];
  if (p.n_agents < 1 || p.n_agents > 16) throw new Error('--agents / --n-agents must be 1..16 (recommended 4..8)');
  return p;
}

function fixtureCommit() {
  const h = createHash('sha256');
  const walk = (d) => readdirSync(d).sort().forEach((f) => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p); else h.update(relative(FIXTURE, p)).update(readFileSync(p));
  });
  walk(FIXTURE);
  return 'sha256:' + h.digest('hex').slice(0, 16);
}

async function start({ run_id, modes, seed, params, atm_backend, procs = 0, armDef = null, scheduler_seed = null }) {
  const runDir = runDirOf(run_id);
  const metaPath = join(runDir, 'meta.json');
  if (o.force && existsSync(runDir)) rmSync(runDir, { recursive: true, force: true });
  const manifest = loadManifest(FIXTURE);
  const schedSeed = scheduler_seed != null ? (scheduler_seed >>> 0) : (seed >>> 0);
  const scenarios = generateScenarios(manifest, seed, params, { schedulerSeed: schedSeed });
  let meta;
  if (existsSync(metaPath)) {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    const bad = [];
    if (meta.scenario_seed !== seed) bad.push(`scenario_seed ${meta.scenario_seed} != ${seed}`);
    if ((meta.scheduler_seed ?? meta.scenario_seed) !== schedSeed) bad.push(`scheduler_seed ${meta.scheduler_seed} != ${schedSeed}`);
    for (const k of CORE_PARAM_KEYS) if (meta.params[k] !== params[k]) bad.push(`params.${k} ${meta.params[k]} != ${params[k]}`);
    if (meta.atm_backend && meta.atm_backend !== atm_backend && modes.includes('atm')) {
      bad.push(`atm_backend ${meta.atm_backend} != ${atm_backend}`);
    }
    if (bad.length) throw new Error(`run ${run_id} exists with different settings: ${bad.join('; ')}`);
  } else {
    mkdirSync(runDir, { recursive: true });
    const atm_version = atm_backend === 'real'
      ? atmVersionLabel()
      : 'mock-broker-0.1 (not ATM monorepo)';
    meta = {
      run_id, scenario_seed: seed, scheduler_seed: schedSeed, workload_seed: seed,
      params, created_at: tsTaipei(), cli_version: CLI_VERSION,
      atm_backend, atm_version, writer: 'mock',
      fixture_id: manifest.fixture_id, fixture_commit: fixtureCommit(), scenario_hash: scenarioHash(scenarios),
      stop_conditions: { max_trials: params.trial_count, stop_file: '<mode>/STOP' },
      agents: [], modes: {},
      label: atm_backend === 'real' ? 'REAL ATM (monorepo broker APIs)' : 'MOCK ATM (in-process mock-broker)',
    };
  }
  // C4: stamp arm labels (main vs diagnostic) so tables cannot confuse arms.
  if (armDef) {
    Object.assign(meta, armEventFields(armDef), {
      arm_label: armDef.label,
      arm_note: armDef.note,
      label: armDef.label,
    });
    meta.params = { ...meta.params, ...(armDef.atm_writer != null ? { atm_writer: armDef.atm_writer } : {}), arm: armDef.arm };
  } else if (modes.length === 1) {
    const inferred = resolveArm({ mode: modes[0], atm_writer: params.atm_writer });
    if (inferred) {
      Object.assign(meta, armEventFields(inferred), { arm_label: inferred.label, arm_note: inferred.note });
      if (!meta.label || meta.label.startsWith('REAL ATM') || meta.label.startsWith('MOCK ATM') || meta.label.startsWith('CONTROL')) {
        meta.label = inferred.label;
      }
      meta.params = { ...meta.params, arm: inferred.arm };
      armDef = inferred;
    }
  }
  const save = () => writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  if (o['agent-id']) {
    meta.agents.push({
      agent_id: o['agent-id'], vendor: o.vendor ?? 'other', joined_at: tsTaipei(),
      mode: modes.join('+'), kind: 'external',
    });
  }
  save();
  const results = [];
  for (const mode of modes) {
    if (meta.modes[mode]?.status === 'done' && !o.force) {
      results.push({ run_id, mode, status: 'already_done', next_hint: `atm-bench export --run-id ${run_id}` });
      continue;
    }
    meta.modes[mode] = { status: 'running', atm: mode === 'atm' ? atm_backend : null };
    save();
    const r = procs > 0
      ? await runModeMp({ runDir, run_id, mode, meta, scenarios, fixtureDir: FIXTURE, procs })
      : await runMode({ runDir, run_id, mode, meta, scenarios, fixtureDir: FIXTURE });
    meta.agents = meta.agents.filter((a) => !(a.mode === mode && a.kind !== 'external')).concat(r.agents);
    meta.modes[mode] = {
      status: 'done', atm: mode === 'atm' ? atm_backend : null,
      started_at: r.started_at, finished_at: r.finished_at,
      duration_ms: r.duration_ms, wall_clock_ms: r.wall_clock_ms, throughput_intents_per_s: r.throughput_intents_per_s,
      timing_clock: r.timing_clock, timing_caveats: r.timing_caveats, node_version: process.version, intents_processed: r.intents_processed, atm_capability: r.atm_capability,
      process_model: procs > 0 ? 'multi-process' : 'single-process', rss_mb_end: r.rss_mb_end ?? null, registry_active_end: r.registry_active_end ?? null, ...(r.mp ? { mp: r.mp } : {}),
      ...(armDef ? armEventFields(armDef) : {}),
      ...(r.oracle_summary ? { oracle_summary: r.oracle_summary } : {}),
    };
    save();
    results.push({
      run_id, mode, status: 'done', atm_backend: mode === 'atm' ? atm_backend : null,
      agents: r.agents.map((a) => a.agent_id),
      next_hint: `atm-bench export --run-id ${run_id}`,
    });
  }
  return results;
}

function doExport(run_id) {
  const runDir = runDirOf(run_id);
  const s = exportRun(runDir, { fixtureDir: FIXTURE });
  if (o.report) {
    const p = resolve(ROOT, o.report);
    writeFileSync(p, renderMarkdown(s, {
      title: `ATM v2 harness — RESULT (${s.run_id}) [atm_backend=${s.atm_backend}]`,
      conclusion: feasibilityConclusion(s),
    }) + `\n---\nGenerated ${tsTaipei()} by \`node src/cli.mjs export --run-id ${run_id}\`. Raw: \`runs/${run_id}/{atm,control}/events/*.jsonl\`.\n`);
    console.log(`report -> ${p}`);
  }
  const a = s.modes.atm, c = s.modes.control;
  console.log(JSON.stringify({
    run_id, atm_backend: s.atm_backend, export_dir: join(runDir, 'export'), reproducible: s.reproducibility.all_equal,
    atm: a?.present ? { intents: a.intents, decisions: a.decision_hist, mean_wait_ms: a.wait_ms.mean_all, lost_updates: a.lost_updates,
      wall_clock_ms: a.latency.run.wall_clock_ms, throughput_intents_per_s: a.latency.run.throughput_intents_per_s,
      total_ms: a.latency.per_intent?.total_ms ?? null, overhead_ms: a.latency.per_intent?.overhead_ms ?? null } : null,
    control: c?.present ? { intents: c.intents, decisions: c.decision_hist, racy: c.racy_overwrite, lost_updates: c.lost_updates,
      wall_clock_ms: c.latency.run.wall_clock_ms, throughput_intents_per_s: c.latency.run.throughput_intents_per_s,
      total_ms: c.latency.per_intent?.total_ms ?? null, overhead_ms: c.latency.per_intent?.overhead_ms ?? null } : null,
    slowdown: s.latency_slowdown ?? null,
  }, null, 2));
  return s;
}

function compareRuns(idA, idB) {
  const sA = exportRun(runDirOf(idA), { fixtureDir: FIXTURE });
  const sB = exportRun(runDirOf(idB), { fixtureDir: FIXTURE });
  return { a: sA, b: sB };
}

async function main() {
  if (o.help || !cmd) return usage();
  switch (cmd) {
    case 'start': {
      const params = paramsFromArgs();
      let modes;
      let armDef = null;
      if (o.arm) {
        armDef = resolveArm({ arm: o.arm });
        modes = [armDef.mode];
        if (armDef.atm_writer != null) params.atm_writer = armDef.atm_writer;
      } else {
        const mode = need('mode');
        modes = mode === 'both' ? ['atm', 'control'] : [mode];
        if (!modes.every((m) => m === 'atm' || m === 'control')) throw new Error('--mode must be atm|control|both');
        if (modes.length === 1) armDef = resolveArm({ mode: modes[0], atm_writer: params.atm_writer });
      }
      const atm_backend = modes.includes('atm') ? resolveBackend() : (o['atm-backend'] ?? 'mock');
      const wlSeed = +need('seed');
      const sched = o['scheduler-seed'] != null ? +o['scheduler-seed'] : wlSeed;
      const res = await start({
        run_id: need('run-id'), modes, seed: wlSeed,
        params, atm_backend, armDef, scheduler_seed: sched,
      });
      return console.log(JSON.stringify(res, null, 2));
    }
    case 'run-smoke': {
      const atm_backend = resolveBackend();
      const run_id = o['run-id'] ?? (atm_backend === 'real' ? 'smoke-real-seed42' : 'smoke-seed42');
      const res = await start({
        run_id, modes: ['atm', 'control'], seed: +(o.seed ?? 42),
        params: paramsFromArgs(SMOKE), atm_backend,
      });
      console.log(JSON.stringify(res, null, 2));
      return doExport(run_id);
    }
    case 'run-small': {
      // One mode per invocation → two separate runs for atm vs control (same seed).
      const mode = need('mode');
      if (mode !== 'atm' && mode !== 'control') throw new Error('run-small --mode must be atm|control');
      const seed = +(o.seed ?? 42);
      const atm_backend = mode === 'atm' ? resolveBackend() : 'mock';
      const params = paramsFromArgs(SMALL);
      const run_id = o['run-id'] ?? `small-${mode}-seed${seed}`;
      const res = await start({ run_id, modes: [mode], seed, params, atm_backend: mode === 'atm' ? atm_backend : 'mock' });
      // For control-only meta, label clearly
      const metaPath = join(runDirOf(run_id), 'meta.json');
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (mode === 'control') {
        meta.atm_backend = 'none';
        meta.atm_version = null;
        meta.label = 'CONTROL (no ATM / no broker)';
        writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      }
      console.log(JSON.stringify(res, null, 2));
      return doExport(run_id);
    }
    case 'run-mp': {
      // Multi-process: --procs N OS processes (default = --agents) share one worktree + one ATM registry file.
      // E4: --arm steward (RQ2) + --scheduler-seed; fault ablations via --registry-sync naive / --apply-lock off.
      let mode = o.mode;
      let armDef = null;
      const params = paramsFromArgs(SMALL);
      if (o.arm) {
        armDef = resolveArm({ arm: o.arm });
        mode = armDef.mode;
        if (armDef.atm_writer != null) params.atm_writer = armDef.atm_writer;
      } else {
        mode = need('mode');
        if (mode === 'atm') armDef = resolveArm({ mode: 'atm', atm_writer: params.atm_writer });
      }
      if (mode !== 'atm' && mode !== 'control') throw new Error('run-mp --mode must be atm|control');
      const seed = +(o.seed ?? 42);
      const sched = o['scheduler-seed'] != null ? +o['scheduler-seed'] : seed;
      const atm_backend = mode === 'atm' ? resolveBackend() : 'mock';
      if (mode === 'atm' && atm_backend !== 'real') throw new Error('run-mp --mode atm requires --atm-backend real (mock broker is in-process only)');
      const procs = +(o.procs ?? params.n_agents);
      if (procs < 1 || procs > params.n_agents) throw new Error('--procs must be 1..n_agents');
      const run_id = o['run-id'] ?? `mp-${mode}-seed${seed}`;
      const res = await start({ run_id, modes: [mode], seed, params, atm_backend, procs, armDef, scheduler_seed: sched });
      const metaPath = join(runDirOf(run_id), 'meta.json');
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      meta.process_model = 'multi-process'; meta.procs = procs;
      meta.scheduler_seed = sched; meta.workload_seed = seed;
      // Ablation labels (fault arms isolated — never confuse with RQ2 main)
      const sync = params.mp_registry_sync || 'cas';
      const alock = params.mp_apply_lock || 'on';
      if (mode === 'control') {
        meta.atm_backend = 'none'; meta.atm_version = null;
        meta.label = 'CONTROL (no ATM / no broker) — multi-process';
        meta.arm_role = 'control';
      } else if (sync === 'naive') {
        meta.arm_role = 'fault_ablation';
        meta.arm = 'steward_mp_naive_registry';
        meta.arm_label = 'FAULT: naive registry sync (expects zombie leases)';
        meta.label = meta.arm_label;
        meta.diagnostic = true;
      } else if (alock === 'off') {
        meta.arm_role = 'fault_ablation';
        meta.arm = 'steward_mp_apply_lock_off';
        meta.arm_label = 'FAULT: apply-lock off (expects possible lost updates)';
        meta.label = meta.arm_label;
        meta.diagnostic = true;
      } else if ((armDef?.arm === 'steward' || params.atm_writer === 'steward') && params.mp_steward_apply_lock === 'on') {
        // r2 mitigation candidate — NOT the r1 main arm; reported separately.
        meta.arm_role = 'mitigation_candidate';
        meta.arm = 'steward_mp_steward_lock';
        meta.arm_label = 'r2 candidate: steward MP + cross-process steward compose/apply lock (harness-side)';
        meta.label = `REAL ATM steward MP procs=${procs} cas+steward-lock`;
        meta.diagnostic = false;
        meta.rq = 'RQ2';
      } else if (armDef?.arm === 'steward' || params.atm_writer === 'steward') {
        meta.arm_role = 'main_method';
        meta.arm = 'steward';
        meta.arm_label = meta.arm_label || 'RQ2 main — steward multi-process (CAS + apply-lock on)';
        meta.label = `REAL ATM steward MP procs=${procs} cas+lock`;
        meta.diagnostic = false;
        meta.rq = 'RQ2';
      } else {
        meta.label = 'REAL ATM (monorepo broker APIs) — multi-process shared registry';
      }
      const slock = params.mp_steward_apply_lock || 'off';
      meta.mp_ablation = {
        registry_sync: sync, apply_lock: alock, procs, steward_apply_lock: slock,
        // r2 finding: --apply-lock only guards non-steward writers; steward path is covered only by --steward-apply-lock.
        apply_lock_covers_steward: slock === 'on',
      };
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      console.log(JSON.stringify(res, null, 2));
      return doExport(run_id);
    }
    case 'export': return doExport(need('run-id'));
    case 'compare-latency': {
      const ids = (k) => need(k).split(',').map((x) => x.trim()).filter(Boolean);
      const load = (id) => {
        const dir = runDirOf(id);
        const summary = exportRun(dir, { fixtureDir: FIXTURE });
        const mode = summary.modes.atm.present && !summary.modes.control.present ? 'atm'
          : summary.modes.control.present && !summary.modes.atm.present ? 'control' : null;
        return { dir, summary, mode };
      };
      const pick = (r, mode) => {
        const evs = readEvents(r.dir, mode).events;
        if (!evs.length) throw new Error(`run ${r.summary.run_id} has no ${mode} events`);
        return { summary: r.summary, decisions: evs.filter((e) => e.event === 'decision'), oracle: evs.filter((e) => e.event === 'oracle') };
      };
      const cmp = compareLatency(ids('atm-run').map((id) => pick(load(id), 'atm')), ids('control-run').map((id) => pick(load(id), 'control')));
      if (o.json) writeFileSync(resolve(ROOT, o.json), JSON.stringify(cmp, null, 2));
      if (o.report) {
        const p = resolve(ROOT, o.report);
        writeFileSync(p, renderCompareLatency(cmp) + `\n---\nGenerated ${tsTaipei()} by \`node src/cli.mjs compare-latency --atm-run ${o['atm-run']} --control-run ${o['control-run']}\` (Node ${process.version}).\n`);
        console.log(`report -> ${p}`);
      }
      return console.log(JSON.stringify(cmp.headline, null, 2));
    }
    case 'status': {
      const runDir = runDirOf(need('run-id'));
      const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8'));
      const out = {
        run_id: meta.run_id, scenario_seed: meta.scenario_seed, atm_backend: meta.atm_backend,
        max_trials: meta.params.trial_count, n_agents: meta.params.n_agents, modes: {},
      };
      for (const m of ['atm', 'control']) {
        const { events } = readEvents(runDir, m);
        const dec = events.filter((e) => e.event === 'decision');
        const hist = {}; dec.forEach((e) => (hist[e.decision] = (hist[e.decision] ?? 0) + 1));
        out.modes[m] = {
          status: meta.modes[m]?.status ?? 'not_started',
          trials: new Set(dec.map((e) => e.trial_id)).size,
          events: events.length, decisions: hist,
          reached_max_trials: new Set(dec.map((e) => e.trial_id)).size >= meta.params.trial_count,
          stopped: existsSync(join(runDir, m, 'STOP')),
        };
      }
      return console.log(JSON.stringify(out, null, 2));
    }
    case 'stop': {
      const runDir = runDirOf(need('run-id')); const mode = need('mode');
      mkdirSync(join(runDir, mode), { recursive: true });
      writeFileSync(join(runDir, mode, 'STOP'), tsTaipei() + '\n');
      return console.log(JSON.stringify({ run_id: o['run-id'], mode, status: 'stop_requested' }));
    }
    case 'tick': {
      const runDir = runDirOf(need('run-id')); const mode = need('mode'); const agent_id = need('agent-id');
      const scen = JSON.parse(readFileSync(join(runDir, mode, 'scenarios', 'scenarios.json'), 'utf8'));
      const { events } = readEvents(runDir, mode);
      const done = new Set(events.filter((e) => e.event === 'decision').map((e) => e.intent_id));
      const next = scen.flatMap((s) => s.intents).find((i) => !done.has(i.intent_id));
      return console.log(JSON.stringify({
        run_id: o['run-id'], mode, agent_id, status: next ? 'pending' : 'exhausted',
        next_intent: next ? { intent_id: next.intent_id, path: next.path, region: next.region, payload_template: next.payload_template } : null,
        note: 'tick is still a stub for external proposals; in-process workers produce events (writer=mock).',
      }, null, 2));
    }
    case 'compare': {
      // lightweight: print both summaries; COMPARE_SMALL.md is written by the smoke wrapper
      const idA = o['run-id'] ?? need('run-id');
      console.log(JSON.stringify({ note: 'Use export on each run_id; see COMPARE_SMALL.md for dual-run table.' }, null, 2));
      return doExport(idA);
    }
    default: usage(); process.exitCode = 2;
  }
}

main().catch((e) => { console.error(`atm-bench: ${e.message}`); process.exitCode = 1; });
