// Run loop for one mode. Each agent is an independent async worker (Promise.all);
// there is no central scheduler: agents only share a wall clock (t0) and the seeded intent list.
// Contention emerges from timing; the broker (atm) or the filesystem (control) resolves it.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { MockBroker } from './mock-broker.mjs';
import { RealAtmBroker } from './real-broker.mjs';
import { ControlWriter } from './control-writer.mjs';
import { agentForSlot, scenarioHash } from './scenario.mjs';
import { applyEditSync, jsonlSink, markerFor, sleep, slug, tsTaipei } from './util.mjs';

export const CLI_VERSION = '0.3.0-latency';

const r2 = (x) => Math.round(x * 100) / 100;

class AtmGateway {
  constructor(broker, worktree, artifactsDir) {
    this.broker = broker; this.worktree = worktree; this.artifactsDir = artifactsDir;
  }
  async execute(intent, agent, emit) {
    // Timing (performance.now, ms, 2dp):
    //   admission_ms = submit -> broker ticket returned (incl. lock wait + queue wait_ms)
    //   broker_ms    = admission_ms - queue wait (pure broker CPU + critical-section lock)
    //   hold_ms      = simulated think/edit time (scenario, identical in control)
    //   apply_ms     = file write + version bump + ticket.release() (registry save on real)
    const abs = join(this.worktree, intent.path);
    const tSubmit = performance.now();
    const ticket = await this.broker.admit(intent, agent, {
      onEnqueue: (q) => emit({ event: 'enqueue', decision: 'cold_queue', reason_code: q.overlay || 'cold_enqueued', wait_ms: 0, ...q }),
      onDequeue: (q) => emit({ event: 'dequeue', decision: 'cold_queue', reason_code: `cold_dequeue_${q.outcome}`, wait_ms: q.wait_ms, overlay: q.overlay }),
    });
    const tDecided = performance.now();
    const admission_ms = tDecided - tSubmit;
    const common = {
      decision: ticket.decision, reason_code: ticket.reason_code, wait_ms: ticket.wait_ms,
      serialized: ticket.serialized, composer: ticket.composer, blocked_by: ticket.blocked_by, cowriters: ticket.cowriters,
      atm_disposition: ticket.atm_disposition, atm_verdict: ticket.atm_verdict, atm_lane: ticket.atm_lane,
      atm_reason: ticket.atm_reason, atm_admission_state: ticket.atm_admission_state,
      atm_ticket_state: ticket.atm_ticket_state, atm_write_intent_task: ticket.atm_write_intent_task,
      overlay: ticket.overlay, atm_first_disposition: ticket.atm_first_disposition, queue_rounds: ticket.queue_rounds, timed_out: ticket.timed_out,
    };
    const timing = (extra = {}) => ({
      admission_ms: r2(admission_ms),
      broker_ms: r2(Math.max(0, admission_ms - (ticket.wait_ms || 0))),
      hold_ms: 0, promotion_wait_ms: 0, apply_ms: 0, ...extra,
    });
    if (ticket.decision === 'reject' || ticket.decision === 'cold_block') return { ...common, ...timing(), outcome: 'reject' };
    if (ticket.timed_out) return { ...common, ...timing(), outcome: 'timeout' };
    let res;
    let tApply0 = null;
    let hold_ms = 0, promotion_wait_ms = 0;
    try {
      const line = `${markerFor(intent.intent_id)} by ${agent.agent_id}`;
      const tH = performance.now();
      await sleep(intent.hold_ms);
      hold_ms = performance.now() - tH;
      let wait_ms = ticket.wait_ms;
      let artifact;
      if (ticket.promotion) {
        const tP = performance.now();
        mkdirSync(join(this.artifactsDir, 'provisional'), { recursive: true });
        artifact = `provisional/${slug(intent.intent_id)}.patch`;
        writeFileSync(join(this.artifactsDir, artifact), `${intent.path}#${intent.region}\n+ ${line}\n`);
        wait_ms += await ticket.promotion;
        promotion_wait_ms = performance.now() - tP;
      }
      tApply0 = performance.now();
      let cas_retry = 0;
      if (this.broker.version(intent.path) !== ticket.base_version) cas_retry = 1;
      applyEditSync(abs, intent.region, line);
      this.broker.bump(intent.path);
      res = {
        ...common, wait_ms, cas_retry, artifact,
        reason_code: cas_retry && ticket.decision !== 'cold_queue' ? `${ticket.reason_code}+cas_rebase` : ticket.reason_code,
        outcome: 'commit',
      };
    } catch (e) {
      res = { ...common, outcome: 'error', reason_code: e.code || 'io_error', error: String(e.message) };
    } finally {
      ticket.release();
    }
    const apply_ms = tApply0 == null ? 0 : performance.now() - tApply0;
    return { ...res, ...timing({ hold_ms: r2(hold_ms), promotion_wait_ms: r2(promotion_wait_ms), apply_ms: r2(apply_ms) }) };
  }
}

export function modeDirs(runDir, mode) {
  const base = join(runDir, mode);
  return {
    base, scenarios: join(base, 'scenarios'), events: join(base, 'events'),
    artifacts: join(base, 'artifacts'), worktree: join(base, 'worktree'),
  };
}

export async function runMode({ runDir, run_id, mode, meta, scenarios, fixtureDir, log = console.log }) {
  const p = meta.params;
  const backend = mode === 'atm' ? (meta.atm_backend || 'mock') : null;
  const d = modeDirs(runDir, mode);
  if (existsSync(d.events)) rmSync(d.base, { recursive: true, force: true });
  for (const k of ['scenarios', 'events', 'artifacts']) mkdirSync(d[k], { recursive: true });
  cpSync(fixtureDir, d.worktree, { recursive: true, filter: (src) => !src.endsWith('manifest.json') });
  writeFileSync(join(d.scenarios, 'scenarios.json'), JSON.stringify(scenarios, null, 2));
  writeFileSync(join(d.scenarios, 'sha256.txt'), scenarioHash(scenarios) + '\n');

  let gateway, capability = null;
  let broker = null;
  if (mode === 'atm') {
    if (backend === 'real') {
      broker = new RealAtmBroker(d.worktree, p);
      await broker.init();
      capability = broker.capability();
      // persist capability snapshot for evidence
      writeFileSync(join(d.artifacts, 'atm_capability.json'), JSON.stringify(capability, null, 2));
    } else {
      broker = new MockBroker(p);
      capability = broker.capability();
    }
    gateway = new AtmGateway(broker, d.worktree, d.artifacts);
  } else {
    gateway = new ControlWriter(d.worktree);
  }

  const intents = scenarios.flatMap((s) => s.intents.map((i) => ({ ...i, scenario_id: s.scenario_id })));
  const agents = Array.from({ length: p.n_agents }, (_, s) => agentForSlot(s));
  const stopFile = join(d.base, 'STOP');
  const committed = [];
  const t0 = Date.now() + 25;
  const perfT0 = performance.now() + (t0 - Date.now());
  const started_at = tsTaipei();
  let firstSubmit = Infinity, lastDecision = -Infinity;
  let trialCounter = 0;

  async function agentLoop(agent) {
    const sink = jsonlSink(join(d.events, `${slug(agent.agent_id)}.jsonl`));
    const mine = intents.filter((i) => i.agent_slot === agent.slot).sort((a, b) => a.trial_index - b.trial_index);
    for (const intent of mine) {
      if (existsSync(stopFile)) break;
      await sleep(t0 + intent.trial_index * p.tick_interval_ms + intent.jitter_ms - Date.now());
      const baseEvt = {
        run_id, mode, trial_id: intent.trial_id, scenario_id: intent.scenario_id, intent_id: intent.intent_id,
        agent_id: agent.agent_id, vendor: agent.vendor, path: intent.path, region: intent.region,
        temperature: intent.hot_or_cold_hint,
        expected_class: mode === 'atm' ? intent.expected_class : intent.expected_class_control,
        atm_capability: capability, atm_backend: backend,
      };
      const emit = (e) => sink.write({ ts: tsTaipei(), ...baseEvt, ...e });
      const scheduled = intent.trial_index * p.tick_interval_ms + intent.jitter_ms;
      const tSub = performance.now();
      firstSubmit = Math.min(firstSubmit, tSub);
      emit({
        t_submit_ms: r2(tSub - perfT0), schedule_lag_ms: r2(tSub - perfT0 - scheduled),
        event: 'submit', decision: null, wait_ms: 0, outcome: null, reason_code: 'intent_submitted',
        active_intents: broker ? broker.activeIntentCount() : null,
      });
      const r = await gateway.execute(intent, agent, emit);
      const tEnd = performance.now();
      lastDecision = Math.max(lastDecision, tEnd);
      const total_ms = tEnd - tSub;
      emit({
        event: 'decision', serialized: false, composer: false, ...r,
        t_submit_ms: r2(tSub - perfT0), t_done_ms: r2(tEnd - perfT0),
        schedule_lag_ms: r2(tSub - perfT0 - scheduled),
        // latency_ms = submit -> decision available (ATM admission; control has no admission step)
        latency_ms: r.admission_ms,
        total_ms: r2(total_ms),
        // overhead_ms = everything except the simulated think time (hold) — the part ATM can slow down
        overhead_ms: r2(total_ms - (r.hold_ms || 0)),
      });
      trialCounter++;
      if (r.outcome === 'commit') committed.push({ intent, sink, emit });
    }
  }

  await Promise.all(agents.map(agentLoop));

  for (const { intent, emit } of committed) {
    const content = readFileSync(join(d.worktree, intent.path), 'utf8');
    const ok = content.includes(markerFor(intent.intent_id) + ' ');
    emit({
      event: 'oracle', decision: null, wait_ms: 0, outcome: ok ? 'test_pass' : 'test_fail',
      reason_code: ok ? 'marker_present' : 'lost_update',
    });
  }
  if (broker) {
    writeFileSync(
      join(d.artifacts, 'broker_decisions.jsonl'),
      broker.decisions.map((x) => JSON.stringify(x)).join('\n') + '\n'
    );
  }
  const finished_at = tsTaipei();
  const duration_ms = Date.now() - t0;
  const wall_clock_ms = r2(lastDecision - firstSubmit);
  log(`[${mode}] backend=${backend ?? 'n/a'} intents=${trialCounter} committed=${committed.length} duration_ms=${duration_ms} wall_clock_ms=${wall_clock_ms}`);
  return {
    mode, started_at, finished_at, duration_ms, wall_clock_ms,
    throughput_intents_per_s: wall_clock_ms > 0 ? r2(trialCounter / (wall_clock_ms / 1000)) : null,
    timing_clock: 'performance.now() (monotonic, same process); wall_clock_ms = first submit -> last decision',
    timing_caveats: [
      'single Node process: all agents share one event loop; sync fs work (ATM registry save, file edits) delays other agents (shows up as hold_ms/schedule_lag_ms inflation)',
      'hold_ms is simulated think time (sleep), not LLM latency; wall clock is pacing-bound when tick_interval_ms>0',
      'control latency_ms (admission) is ~0 by construction: control has no admission step',
      `writer=mock (in-process marker edits), atm_backend=${backend ?? 'none'}`,
    ],
    intents_processed: trialCounter, atm_capability: capability,
    agents: agents.map((a) => ({ agent_id: a.agent_id, vendor: a.vendor, joined_at: started_at, mode })),
  };
}
