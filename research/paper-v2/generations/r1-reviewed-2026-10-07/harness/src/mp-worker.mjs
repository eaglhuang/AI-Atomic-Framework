#!/usr/bin/env node
// Multi-process agent worker (forked by mp-runner). One OS process per agent (or per slot group).
// Shares the run's worktree + ATM registry file with sibling processes; no in-memory shared state.
import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
process.env.ATM_BENCH_ATOMIC_WRITE = '1';
const { AtmGateway, modeDirs } = await import('./runner.mjs');
const { ControlWriter } = await import('./control-writer.mjs');
const { MpRealAtmBroker } = await import('./mp-broker.mjs');
const { agentForSlot } = await import('./scenario.mjs');
const { jsonlSink, sleep, slug, tsTaipei } = await import('./util.mjs');

const { values: o } = parseArgs({ options: { 'run-dir': { type: 'string' }, mode: { type: 'string' }, slots: { type: 'string' }, worker: { type: 'string' } } });
const runDir = o['run-dir'], mode = o.mode, workerId = +o.worker;
const slots = o.slots.split(',').map(Number);
const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8'));
const p = meta.params;
const d = modeDirs(runDir, mode);
const scenarios = JSON.parse(readFileSync(join(d.scenarios, 'scenarios.json'), 'utf8'));
const r2 = (x) => Math.round(x * 100) / 100;
const epochNow = () => performance.timeOrigin + performance.now();

let broker = null, gateway, capability = null;
const tInit0 = performance.now();
if (mode === 'atm') {
  broker = new MpRealAtmBroker(d.worktree, { ...p, registry_sync: p.mp_registry_sync, apply_lock: p.mp_apply_lock !== 'off' });
  await broker.init();
  capability = broker.capability();
  // Note: multi-process steward compose windows do not span OS processes (C1 out of scope).
  gateway = new AtmGateway(broker, d.worktree, d.artifacts, {
    atm_writer: p.atm_writer,
    compose_window_ms: p.compose_window_ms ?? 80,
    occ_max_retries: p.occ_max_retries ?? 8,
  });
} else {
  gateway = new ControlWriter(d.worktree);
}
const init_ms = performance.now() - tInit0;

const t0Epoch = await new Promise((res) => {
  process.on('message', (m) => { if (m?.type === 'go') res(m.t0Epoch); });
  process.send({ type: 'ready', worker: workerId, pid: process.pid, init_ms });
});
const perfT0 = t0Epoch - performance.timeOrigin;   // performance.now() value at shared t0

const intents = scenarios.flatMap((s) => s.intents.map((i) => ({ ...i, scenario_id: s.scenario_id })));
const committed = [];
let firstSubmit = Infinity, lastDecision = -Infinity, n = 0, errors = 0;
const stopFile = join(d.base, 'STOP');

async function agentLoop(agent) {
  const sink = jsonlSink(join(d.events, `${slug(agent.agent_id)}.jsonl`));
  const mine = intents.filter((i) => i.agent_slot === agent.slot).sort((a, b) => a.trial_index - b.trial_index);
  for (const intent of mine) {
    if (existsSync(stopFile)) break;
    const scheduled = intent.trial_index * p.tick_interval_ms + intent.jitter_ms;
    await sleep(perfT0 + scheduled - performance.now());
    const baseEvt = {
      run_id: meta.run_id, mode, trial_id: intent.trial_id, scenario_id: intent.scenario_id, intent_id: intent.intent_id,
      agent_id: agent.agent_id, vendor: agent.vendor, path: intent.path, region: intent.region, temperature: intent.hot_or_cold_hint,
      expected_class: mode === 'atm' ? intent.expected_class : intent.expected_class_control,
      atm_capability: capability, atm_backend: mode === 'atm' ? 'real' : null, pid: process.pid, worker: workerId,
    };
    const emit = (e) => sink.write({ ts: tsTaipei(), ...baseEvt, ...e });
    const tSub = performance.now();
    firstSubmit = Math.min(firstSubmit, tSub);
    emit({ t_submit_ms: r2(tSub - perfT0), schedule_lag_ms: r2(tSub - perfT0 - scheduled), event: 'submit', decision: null,
      wait_ms: 0, outcome: null, reason_code: 'intent_submitted', active_intents: broker ? broker.activeIntentCount() : null });
    let res;
    try { res = await gateway.execute(intent, agent, emit); }
    catch (e) { errors++; res = { decision: 'error', outcome: 'error', reason_code: e.code || 'worker_exception', error: String(e.message), admission_ms: 0 }; }
    const tEnd = performance.now();
    lastDecision = Math.max(lastDecision, tEnd);
    const total_ms = tEnd - tSub;
    emit({ event: 'decision', serialized: false, composer: false, ...res,
      t_submit_ms: r2(tSub - perfT0), t_done_ms: r2(tEnd - perfT0), schedule_lag_ms: r2(tSub - perfT0 - scheduled),
      latency_ms: res.admission_ms, total_ms: r2(total_ms), overhead_ms: r2(total_ms - (res.hold_ms || 0)) });
    n++;
    if (res.outcome === 'commit') committed.push({ intent_id: intent.intent_id, path: intent.path, agent_id: agent.agent_id });
  }
}
await Promise.all(slots.map((s) => agentLoop(agentForSlot(s))));

mkdirSync(join(d.base, 'mp'), { recursive: true });
writeFileSync(join(d.base, 'mp', `worker-${workerId}.json`), JSON.stringify({
  worker: workerId, pid: process.pid, slots, init_ms: r2(init_ms), intents: n, errors, rss_mb_end: Math.round(process.memoryUsage().rss / 1048576),
  first_submit_epoch_ms: firstSubmit === Infinity ? null : performance.timeOrigin + firstSubmit,
  last_decision_epoch_ms: lastDecision === -Infinity ? null : performance.timeOrigin + lastDecision,
  committed, broker_stats: broker?.stats ?? null, decisions: broker?.decisions ?? [],
}, null, 1));
process.send({ type: 'done', worker: workerId });
process.disconnect?.();
