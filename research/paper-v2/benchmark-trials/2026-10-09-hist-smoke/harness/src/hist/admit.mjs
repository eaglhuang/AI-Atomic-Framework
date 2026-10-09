// HIST admission: real ATM broker admission for general hunks (no region tags). One write intent per
// (writer, file); atom sourceRange = union of the writer's hunk lines on that file (1-based, base coordinates).
// Shared registry file + ATM createBrokerRegistryStore CAS, same as mp-broker. Wait policy = r1-r5 default
// cold 'once': on queue/true-conflict wait (poll) for the blockers on that file to release, up to
// queue_timeout_ms, then re-evaluate once; still not admissible -> intents blocked (atm_<disposition>).
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAtmApis, mapAtmToHarness } from '../real-broker.mjs';
import { atmCoreBroker } from '../atm-resolve.mjs';

const SAB = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms) => Atomics.wait(SAB, 0, 0, ms);
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const cid = (parts) => createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);

export class HistAdmit {
  constructor(worktree, { queue_timeout_ms = 2000, poll_ms = 3 } = {}) {
    this.worktree = worktree; this.queue_timeout_ms = queue_timeout_ms; this.poll_ms = poll_ms;
    this.registryPath = join(worktree, '.atm/runtime/write-broker.registry.json');
    this.stats = { txns: 0, cas_conflicts: 0 };
  }
  async init() {
    this.api = await loadAtmApis();
    const { createBrokerRegistryStore } = await import(pathToFileURL(atmCoreBroker('registry-store.ts')).href);
    this.store = createBrokerRegistryStore(this.registryPath);
    return this;
  }
  txn(fn) {
    this.stats.txns++;
    for (let attempt = 0; ; attempt++) {
      const snap = this.store.read();
      const { next, result } = fn(snap.document);
      if (!next) return result;
      try { this.store.write({ base: snap, next, transactionId: `hist:${process.pid}:${Date.now()}:${attempt}` }); return result; }
      catch (e) {
        if (e.code !== 'ATM_BROKER_REGISTRY_CAS_CONFLICT') throw e;
        this.stats.cas_conflicts++; if (attempt > 2000) throw new Error('registry CAS livelock');
        sleepSync(Math.random() * Math.min(4, 0.25 * (attempt + 1)));
      }
    }
  }
  writeIntent({ taskId, actorId, path, hunks }) {
    const lineStart = Math.min(...hunks.map((h) => h.start)) + 1;
    const lineEnd = Math.max(...hunks.map((h) => Math.max(h.end, h.start + 1)));
    return {
      schemaId: 'atm.writeIntent.v1', specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'atm-bench hist' },
      taskId, actorId, baseCommit: 'atm-bench-base', targetFiles: [path],
      atomRefs: [{ atomId: `atom-${taskId}`, atomCid: cid([taskId, path, String(lineStart)]), operation: 'modify',
        sourceRange: { filePath: path, lineStart, lineEnd } }],
      sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
      requestedLane: 'auto', leaseBounds: { requestedSeconds: 120, maxSeconds: 300 },
    };
  }
  async admit({ taskId, actorId, path, hunks }) {
    const wi = this.writeIntent({ taskId, actorId, path, hunks });
    const started = Date.now(); let rounds = 0, first = null;
    for (;;) {
      const r = this.txn((doc) => {
        const decision = this.api.calculateBrokerDecision(wi, doc);
        const admission = this.api.evaluateBrokerAdmission({ intent: wi }, doc, { preferProposalForBoundedWork: true, startedAtMs: started, nowMs: Date.now() });
        const mapped = mapAtmToHarness(admission, decision, { hot_or_cold_hint: 'cold' }, { cold_policy: 'queue' });
        if (!first) first = admission.disposition;
        const blockers = doc.activeIntents.filter((a) => a.taskId !== wi.taskId && a.resourceKeys.files.includes(path)).map((a) => a.taskId);
        if (['queue', 'true-conflict'].includes(admission.disposition) && rounds < 1 && blockers.length) return { result: { wait: true, blockers, mapped } };
        if (mapped.decision === 'reject' || mapped.decision === 'cold_block') return { result: { granted: false, mapped, blockers } };
        const lane = decision.lane === 'blocked' ? 'direct-brokered' : decision.lane;
        return { next: this.api.registerIntent(doc, wi, lane, 120, decision.admission), result: { granted: true, mapped } };
      });
      if (!r.wait) {
        const t = { granted: r.granted, decision: r.mapped.decision, atm_disposition: r.mapped.atm_disposition, atm_first_disposition: first,
          reason_code: r.mapped.reason_code, wait_ms: Date.now() - started, queue_rounds: rounds, composer: !!r.mapped.composer };
        t.release = r.granted ? () => this.txn((doc) => ({ next: this.api.releaseTask(doc, wi.taskId), result: null })) : () => {};
        return t;
      }
      rounds++;
      const deadline = started + this.queue_timeout_ms; let gone = false;
      while (Date.now() < deadline) {
        await sleep(this.poll_ms);
        const active = new Set(this.store.read().document.activeIntents.map((a) => a.taskId));
        if (r.blockers.every((b) => !active.has(b))) { gone = true; break; }
      }
      if (!gone) return { granted: false, decision: 'reject', atm_disposition: r.mapped.atm_disposition, atm_first_disposition: first,
        reason_code: 'overlay_queue_timeout', wait_ms: Date.now() - started, queue_rounds: rounds, release: () => {} };
    }
  }
}
