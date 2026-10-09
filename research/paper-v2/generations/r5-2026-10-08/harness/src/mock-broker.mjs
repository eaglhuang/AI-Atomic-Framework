// MOCK ATM broker (atm_backend: "mock"). NOT the real ATM monorepo broker.
// Models the hot/cold admission behaviour the paper wants to measure:
//   cold file  + overlap -> cold_queue (FIFO, wait_ms recorded)   [cold_policy=queue, target behaviour]
//                        -> cold_block (fast reject)               [cold_policy=block, legacy behaviour]
//   hot file   + overlap, different region -> composer_merge (co-write, CAS rebase on apply)
//              + overlap, same region      -> hot_provisional (speculative, promoted after blockers release)
//              + provisional depth exceeded-> reject
//   no overlap -> admit
import { deferred } from './util.mjs';

export class MockBroker {
  constructor({ cold_policy = 'queue', composer_enabled = true, queue_timeout_ms = 2000, max_provisional_depth = 1 } = {}) {
    this.opts = { cold_policy, composer_enabled, queue_timeout_ms, max_provisional_depth };
    this.hotActive = new Map();   // path -> [{intent_id, agent_id, region, released}]
    this.coldLocks = new Map();   // path -> {holder, queue: [{intent_id, wake}]}
    this.versions = new Map();    // path -> monotonically increasing version (CAS)
    this.decisions = [];          // record of every admission decision
  }

  capability() {
    return {
      backend: 'mock',
      cold_behaviour: this.opts.cold_policy === 'queue' ? 'queue' : 'block',
      composer: this.opts.composer_enabled,
      provisional: true,
      max_provisional_depth: this.opts.max_provisional_depth,
    };
  }

  version(path) { return this.versions.get(path) ?? 0; }
  bump(path) { this.versions.set(path, this.version(path) + 1); }

  activeIntentCount() {
    let n = 0;
    for (const l of this.hotActive.values()) n += l.length;
    for (const l of this.coldLocks.values()) n += l.holder ? 1 : 0;
    return n;
  }

  record(intent, agent, d) {
    this.decisions.push({ intent_id: intent.intent_id, agent_id: agent.agent_id, path: intent.path, region: intent.region,
      temperature: intent.hot_or_cold_hint, decision: d.decision, reason_code: d.reason_code, wait_ms: d.wait_ms ?? 0,
      at_ms: Date.now() });
  }

  /**
   * Submit a WriteIntent. Resolves to an admission ticket:
   * { decision, reason_code, wait_ms, serialized, composer, base_version, promotion?: Promise<wait_ms>, release() }
   * hooks.onEnqueue / hooks.onDequeue let the caller log queue events.
   */
  async admit(intent, agent, hooks = {}) {
    const t = intent.hot_or_cold_hint === 'hot' ? this.#admitHot(intent, agent) : await this.#admitCold(intent, agent, hooks);
    this.record(intent, agent, t);
    return t;
  }

  #admitHot(intent, agent) {
    const { path, region } = intent;
    const list = this.hotActive.get(path) ?? [];
    this.hotActive.set(path, list);
    const sameRegion = list.filter((e) => e.region === region);
    const entry = { intent_id: intent.intent_id, agent_id: agent.agent_id, region, released: deferred() };
    const release = () => {
      const i = list.indexOf(entry);
      if (i >= 0) list.splice(i, 1);
      entry.released.resolve();
    };
    const base = { base_version: this.version(path), wait_ms: 0, serialized: false, composer: false, release };

    if (list.length === 0) {
      list.push(entry);
      return { ...base, decision: 'admit', reason_code: 'hot_no_overlap' };
    }
    if (sameRegion.length === 0 && this.opts.composer_enabled) {
      list.push(entry);
      return { ...base, decision: 'composer_merge', reason_code: 'hot_disjoint_region_cowrite', composer: true,
        cowriters: list.filter((e) => e !== entry).map((e) => e.intent_id) };
    }
    const blockers = this.opts.composer_enabled ? sameRegion : list.slice();
    if (sameRegion.length > this.opts.max_provisional_depth) {
      return { ...base, release: () => {}, decision: 'reject', reason_code: 'provisional_depth_exceeded' };
    }
    list.push(entry);
    const started = Date.now();
    const promotion = Promise.all(blockers.map((b) => b.released.promise)).then(() => Date.now() - started);
    return { ...base, decision: 'hot_provisional', reason_code: 'hot_same_region_speculative', promotion,
      blocked_by: blockers.map((b) => b.intent_id) };
  }

  async #admitCold(intent, agent, hooks) {
    const { path } = intent;
    let lock = this.coldLocks.get(path);
    if (!lock) { lock = { holder: null, queue: [] }; this.coldLocks.set(path, lock); }
    const release = () => {
      const next = lock.queue.shift();
      if (next) { lock.holder = next.intent_id; next.wake(); } else lock.holder = null;
    };
    const base = { base_version: this.version(path), wait_ms: 0, serialized: false, composer: false, release };

    if (!lock.holder) {
      lock.holder = intent.intent_id;
      return { ...base, decision: 'admit', reason_code: 'cold_free' };
    }
    if (this.opts.cold_policy === 'block') {
      return { ...base, release: () => {}, decision: 'cold_block', reason_code: 'cold_held_fast_reject', blocked_by: [lock.holder] };
    }
    const holderAtEnqueue = lock.holder;
    const position = lock.queue.length + 1;
    const started = Date.now();
    hooks.onEnqueue?.({ position, blocked_by: holderAtEnqueue });
    const outcome = await new Promise((resolve) => {
      const waiter = { intent_id: intent.intent_id, wake: () => { clearTimeout(timer); resolve('granted'); } };
      const timer = setTimeout(() => {
        const i = lock.queue.indexOf(waiter);
        if (i >= 0) lock.queue.splice(i, 1);
        resolve('timeout');
      }, this.opts.queue_timeout_ms);
      lock.queue.push(waiter);
    });
    const wait_ms = Date.now() - started;
    hooks.onDequeue?.({ wait_ms, outcome });
    if (outcome === 'timeout') {
      return { ...base, release: () => {}, wait_ms, serialized: true, decision: 'cold_queue', reason_code: 'cold_queue_timeout', timed_out: true };
    }
    return { ...base, base_version: this.version(path), wait_ms, serialized: true, decision: 'cold_queue',
      reason_code: 'cold_queued_then_granted', queue_position: position, blocked_by: [holderAtEnqueue] };
  }
}
