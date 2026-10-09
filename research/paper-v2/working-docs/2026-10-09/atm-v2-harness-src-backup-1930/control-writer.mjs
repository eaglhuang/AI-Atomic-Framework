// CONTROL mode writer: NO ATM, NO broker. Agents read, "think", then write the whole file back.
// We only *observe* (never prevent) races so the event log can say racy_overwrite / lost update.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { insertIntoRegion, markerFor, sleep } from './util.mjs';

export class ControlWriter {
  constructor(worktree) {
    this.worktree = worktree;
    this.versions = new Map();   // observation only
    this.writeLog = new Map();   // path -> [{version, intent_id}]
    this.inflight = new Map();   // path -> Set(intent_id)
  }

  async execute(intent, agent) {
    const abs = join(this.worktree, intent.path);
    const inflight = this.inflight.get(intent.path) ?? new Set();
    this.inflight.set(intent.path, inflight);
    const concurrentAtStart = [...inflight];
    inflight.add(intent.intent_id);
    const r2 = (x) => Math.round(x * 100) / 100;
    const tSubmit = performance.now();
    let admission_ms = 0, hold_ms = 0, tApply0 = null;
    try {
      admission_ms = performance.now() - tSubmit;   // no admission step in control (~0)
      const base = readFileSync(abs, 'utf8');
      const baseVersion = this.versions.get(intent.path) ?? 0;
      const tH = performance.now();
      await sleep(intent.hold_ms);                          // model think/edit time (stale base)
      hold_ms = performance.now() - tH;
      tApply0 = performance.now();
      const next = insertIntoRegion(base, intent.region, `${markerFor(intent.intent_id)} by ${agent.agent_id}`);
      const curVersion = this.versions.get(intent.path) ?? 0;
      const log = this.writeLog.get(intent.path) ?? [];
      const clobbered = log.filter((w) => w.version > baseVersion).map((w) => w.intent_id);
      writeFileSync(abs, next);                             // direct write, last-writer-wins
      this.versions.set(intent.path, curVersion + 1);
      log.push({ version: curVersion + 1, intent_id: intent.intent_id });
      this.writeLog.set(intent.path, log);
      const racy = clobbered.length > 0;
      const apply_ms = performance.now() - tApply0;
      return {
        admission_ms: r2(admission_ms), broker_ms: 0, hold_ms: r2(hold_ms), promotion_wait_ms: 0, apply_ms: r2(apply_ms),
        decision: 'direct_write',
        reason_code: racy ? 'racy_overwrite' : concurrentAtStart.length ? 'concurrent_no_clobber' : 'clean',
        wait_ms: 0, serialized: false, composer: false, outcome: 'commit',
        racy, overwrote_intents: clobbered, concurrent_writers: concurrentAtStart,
      };
    } catch (e) {
      return { admission_ms: r2(admission_ms), broker_ms: 0, hold_ms: r2(hold_ms), promotion_wait_ms: 0,
        apply_ms: tApply0 == null ? 0 : r2(performance.now() - tApply0), decision: 'direct_write', reason_code: e.code || 'io_error', wait_ms: 0, serialized: false,
        composer: false, outcome: 'error', error: String(e.message) };
    } finally {
      inflight.delete(intent.intent_id);
    }
  }
}
