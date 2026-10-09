// MULTI-PROCESS real ATM broker (atm_backend: "real", run-mp).
// Every agent process shares ONE worktree and ONE ATM registry file:
//   <worktree>/.atm/runtime/write-broker.registry.json
// There is no in-process critical section across processes, so every admission/release is a
// registry transaction against the file:
//   registry_sync='cas'   (default): ATM's own store — createBrokerRegistryStore(path).read() -> evaluate on that
//                         snapshot -> registerIntent -> store.write({ base: snapshot, next }) which rejects with
//                         ATM_BROKER_REGISTRY_CAS_CONFLICT if the generation/digest moved (or another writer holds the
//                         .write-lock). On conflict we reread + re-ask ATM (optimistic concurrency).
//   registry_sync='naive': legacy API loadRegistry() ... saveRegistry() (saveRegistry re-reads the base right before
//                         writing, so it is NOT CAS against what we evaluated) -> lost registry updates possible.
// Waiting (hot_retry/cold_retry loop overlay) polls the registry file until the ATM-registered blockers are gone.
import { closeSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { buildWriteIntent, loadAtmApis, mapAtmToHarness } from './real-broker.mjs';
import { atmCoreBroker } from './atm-resolve.mjs';
import { pathToFileURL } from 'node:url';

const SAB = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms) => Atomics.wait(SAB, 0, 0, ms);
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export class MpRealAtmBroker {
  constructor(worktree, opts = {}) {
    this.worktree = worktree;
    this.opts = {
      cold_policy: opts.cold_policy ?? 'queue',
      composer_enabled: opts.composer_enabled !== false,
      queue_timeout_ms: opts.queue_timeout_ms ?? 2000,
      baseCommit: 'atm-bench-base',
      cold_atom_identity: opts.cold_atom_identity ?? 'intent',
      cold_retry: opts.cold_retry ?? 'once',
      hot_retry: opts.hot_retry ?? 'none',
      registry_sync: opts.registry_sync ?? 'cas',
      apply_lock: opts.apply_lock !== false,
      poll_ms: opts.poll_ms ?? 3,
    };
    this.registryPath = join(worktree, '.atm/runtime/write-broker.registry.json');
    this.decisions = [];
    this.stats = { txns: 0, cas_conflicts: 0, lock_busy: 0, txn_retries_max: 0, polls: 0, apply_lock_spins: 0 };
    this._lastActive = 0;
  }

  async init() {
    this.api = await loadAtmApis();
    const { createBrokerRegistryStore } = await import(pathToFileURL(atmCoreBroker('registry-store.ts')).href);
    this.store = createBrokerRegistryStore(this.registryPath);
    return this;
  }

  capability() {
    return {
      backend: 'real', process_model: 'multi-process', pid: process.pid, atm_version: this.api?.version,
      registry_path: this.registryPath, registry_sync: this.opts.registry_sync, apply_lock: this.opts.apply_lock,
      hot_retry: this.opts.hot_retry, cold_retry: this.opts.cold_retry, cold_atom_identity: this.opts.cold_atom_identity,
      native_queue_reachable: false,
      note: 'Shared registry file across OS processes; ATM createBrokerRegistryStore CAS (or legacy saveRegistry when registry_sync=naive).',
    };
  }

  // Cross-process "version" = content hash (cas_retry/stale semantics: did the file change since base?)
  version(path) { try { return createHash('sha1').update(readFileSync(join(this.worktree, path))).digest('hex').slice(0, 12); } catch { return 'missing'; } }
  bump() {}
  activeIntentCount() { return this._lastActive; }

  /** One registry transaction. fn(doc) -> { next?: doc, result }. Retries on ATM CAS conflict / write-lock busy. */
  #txn(fn) {
    this.stats.txns++;
    for (let attempt = 0; ; attempt++) {
      if (attempt === 1) this.stats.txns_retried = (this.stats.txns_retried ?? 0) + 1;
      if (this.opts.registry_sync === 'naive') {
        const doc = this.api.loadRegistry(this.registryPath, { persistCleanup: false });
        const { next, result } = fn(doc);
        this._lastActive = (next ?? doc).activeIntents.length;
        if (!next) return result;
        try { this.api.saveRegistry(this.registryPath, next); return result; }
        catch (e) {
          if (e.code !== 'ATM_BROKER_REGISTRY_CAS_CONFLICT') throw e;
          this.stats.lock_busy++; this.stats.txn_retries_max = Math.max(this.stats.txn_retries_max, attempt + 1);
          sleepSync(Math.random()); continue; // naive: retry the whole thing (re-evaluates) only when the lock was busy
        }
      }
      const snap = this.store.read();
      const { next, result } = fn(snap.document);
      this._lastActive = (next ?? snap.document).activeIntents.length;
      if (!next) return result;
      try {
        this.store.write({ base: snap, next, transactionId: `atm-bench:${process.pid}:${Date.now()}:${attempt}` });
        return result;
      } catch (e) {
        if (e.code !== 'ATM_BROKER_REGISTRY_CAS_CONFLICT') throw e;
        this.stats.cas_conflicts++;
        if (/active compare\/write/.test(e.message)) this.stats.cas_lock_busy = (this.stats.cas_lock_busy ?? 0) + 1;
        else this.stats.cas_stale_generation = (this.stats.cas_stale_generation ?? 0) + 1;
        this.stats.txn_retries_max = Math.max(this.stats.txn_retries_max, attempt + 1);
        if (attempt > 2000) throw new Error('registry CAS livelock (>2000 retries)');
        sleepSync(Math.random() * Math.min(4, 0.25 * (attempt + 1)));   // jittered backoff
      }
    }
  }

  #evaluate(doc, writeIntent, started) {
    const decision = this.api.calculateBrokerDecision(writeIntent, doc);
    const admission = this.api.evaluateBrokerAdmission({ intent: writeIntent }, doc,
      { preferProposalForBoundedWork: true, startedAtMs: started, nowMs: Date.now() });
    return { decision, admission };
  }

  record(intent, agent, d) {
    this.decisions.push({ intent_id: intent.intent_id, agent_id: agent.agent_id, pid: process.pid, path: intent.path,
      region: intent.region, temperature: intent.hot_or_cold_hint, decision: d.decision, reason_code: d.reason_code,
      wait_ms: d.wait_ms ?? 0, atm_disposition: d.atm_disposition, atm_verdict: d.atm_verdict, atm_lane: d.atm_lane,
      atm_first_disposition: d.atm_first_disposition, queue_rounds: d.queue_rounds, at_ms: Date.now() });
  }

  async admit(intent, agent, hooks = {}) {
    const writeIntent = buildWriteIntent(this.worktree, this.opts, intent, agent);
    const started = Date.now();
    const hot = intent.hot_or_cold_hint === 'hot';
    const nativeQueue = !hot && this.opts.cold_policy === 'queue' && this.opts.cold_retry === 'native-queue';
    const loop = hot ? this.opts.hot_retry === 'loop' : (this.opts.cold_policy === 'queue' && (this.opts.cold_retry === 'loop' || nativeQueue));
    const maxRounds = loop ? Infinity : (!hot && this.opts.cold_policy === 'queue' ? 1 : 0);  // cold 'once' overlay = 1 wait round
    const overlay = hot ? 'hot_retry_loop' : (nativeQueue ? 'native_queue_wait' : (loop ? 'cold_retry_loop' : 'cold_policy_queue_retry'));
    const waitDisp = hot ? new Set(['true-conflict'])
      : (nativeQueue ? new Set(['queue', 'true-conflict'])
        : (this.opts.cold_policy === 'queue' ? new Set(['true-conflict', 'queue']) : new Set(['true-conflict'])));
    // note: cold_retry=once also waits once on queue|true-conflict via maxRounds=1; loop (legacy) only true-conflict when not nativeQueue
    const deadline = started + this.opts.queue_timeout_ms;
    let rounds = 0, first = null, enqueued = false;
    for (;;) {
      const r = this.#txn((doc) => {
        const { decision, admission } = this.#evaluate(doc, writeIntent, started);
        const mapped = mapAtmToHarness(admission, decision, intent, this.opts);
        if (!first) first = { disposition: admission.disposition, verdict: decision.verdict };
        const blockers = doc.activeIntents.filter((a) => a.taskId !== writeIntent.taskId && a.resourceKeys.files.includes(intent.path)).map((a) => a.taskId);
        // cold_retry=loop (legacy): only true-conflict; native-queue / once: queue|true-conflict
        const legacyLoopOnlyTc = !hot && this.opts.cold_retry === 'loop' && !nativeQueue;
        const waitNow = legacyLoopOnlyTc
          ? (admission.disposition === 'true-conflict' && rounds < maxRounds && blockers.length)
          : (waitDisp.has(admission.disposition) && rounds < maxRounds && blockers.length);
        if (waitNow) return { result: { conflict: true, mapped, blockers, disposition: admission.disposition } };
        if (mapped.decision === 'reject' || mapped.decision === 'cold_block' || (mapped.decision === 'composer_merge' && !this.opts.composer_enabled)) {
          return { result: { final: { ...mapped, ...(mapped.decision === 'composer_merge' ? { decision: 'reject', reason_code: 'composer_disabled' } : {}), blocked_by: blockers } } };
        }
        const lane = decision.lane === 'blocked' ? 'direct-brokered' : decision.lane;
        const next = this.api.registerIntent(doc, writeIntent, lane, 120, decision.admission);
        return { next, result: { final: mapped, granted: true } };
      });
      if (!r.conflict) {
        const wait_ms = enqueued ? Date.now() - started : 0;
        const t = { ...r.final, wait_ms, atm_first_disposition: first.disposition, atm_first_verdict: first.verdict, queue_rounds: rounds,
          base_version: this.version(intent.path), task_id: writeIntent.taskId, atm_write_intent_task: writeIntent.taskId };
        if (enqueued) {
          if (!hot && r.granted) t.decision = 'cold_queue';
          t.reason_code = `overlay_wait_on_atm_${first.disposition}_then_${r.final.atm_disposition}`;
          t.serialized = true; t.overlay = overlay;
          hooks.onDequeue?.({ wait_ms, outcome: r.granted ? 'granted' : 'rejected', overlay });
        }
        t.release = r.granted
          ? () => this.#txn((doc) => ({ next: this.api.releaseTask(doc, writeIntent.taskId), result: null }))
          : () => {};
        this.record(intent, agent, t);
        return t;
      }
      if (!enqueued) {
        enqueued = true;
        hooks.onEnqueue?.({ position: r.blockers.length, blocked_by: r.blockers[0] ?? null, atm_disposition: r.disposition ?? 'true-conflict', overlay });
      }
      rounds++;
      // poll the shared registry until blockers release (hot: any, cold: all) or timeout
      const which = hot ? 'any' : 'all';
      let outcome = 'timeout';
      while (Date.now() < deadline) {
        await sleep(this.opts.poll_ms);
        this.stats.polls++;
        const active = new Set(this.store.read().document.activeIntents.map((a) => a.taskId));
        const gone = r.blockers.filter((b) => !active.has(b)).length;
        if (which === 'any' ? gone > 0 : gone === r.blockers.length) { outcome = 'granted'; break; }
      }
      if (outcome === 'timeout') {
        const wait_ms = Date.now() - started;
        hooks.onDequeue?.({ wait_ms, outcome, overlay });
        const t = { ...r.mapped, wait_ms, serialized: true, timed_out: true, reason_code: 'overlay_queue_timeout',
          base_version: this.version(intent.path), release: () => {}, atm_first_disposition: first.disposition, queue_rounds: rounds, overlay };
        this.record(intent, agent, t);
        return t;
      }
    }
  }

  /** Cross-process per-file apply lock (models a serial composer/steward apply step). Sync spin on O_EXCL lockfile. */
  withApplyLock(path, fn) {
    if (!this.opts.apply_lock) return fn();
    const lock = join(this.worktree, '.atm/runtime', `apply-${path.replace(/[^A-Za-z0-9]+/g, '_')}.lock`);
    let fd;
    for (let i = 0; ; i++) {
      try { fd = openSync(lock, 'wx'); break; }
      catch (e) { if (e.code !== 'EEXIST') throw e; this.stats.apply_lock_spins++; if (i > 200000) throw new Error('apply lock stuck ' + lock); sleepSync(0.2); }
    }
    try { return fn(); } finally { closeSync(fd); rmSync(lock, { force: true }); }
  }
}

/** Atomic text write (tmp + rename) so other processes never read a half-written file. */
export function writeAtomic(abs, text) {
  const tmp = `${abs}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmp, text);
  renameSync(tmp, abs);
}
