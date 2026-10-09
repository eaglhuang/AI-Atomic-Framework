// REAL ATM backend (atm_backend: "real").
// Wraps AI-Atomic-Framework broker APIs:
//   calculateBrokerDecision, evaluateBrokerAdmission, registerIntent, releaseTask, saveRegistry
// Does NOT invent Claim Plane JIT. Maps ATM dispositions → harness decision codes honestly.
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { atmCoreBroker, atmVersionLabel, requireNodeForRealAtm, resolveAtmMonorepo } from './atm-resolve.mjs';
import { deferred } from './util.mjs';

async function loadAtmApis() {
  requireNodeForRealAtm();
  const root = resolveAtmMonorepo();
  const imp = (rel) => import(pathToFileURL(atmCoreBroker(rel)).href);
  const [
    { calculateBrokerDecision },
    { evaluateBrokerAdmission },
    { registerIntent, releaseTask, saveRegistry, loadRegistry },
    { createEmptyBrokerRegistryDocument },
  ] = await Promise.all([
    imp('decision.ts'),
    imp('admission/evaluate-broker-admission.ts'),
    imp('registry.ts'),
    imp('registry-store.ts'),
  ]);
  return {
    root,
    version: atmVersionLabel(root),
    calculateBrokerDecision,
    evaluateBrokerAdmission,
    registerIntent,
    releaseTask,
    saveRegistry,
    loadRegistry,
    createEmptyBrokerRegistryDocument,
  };
}

/** Find // <region:NAME> … // </region:NAME> line span (1-indexed, inclusive). */
export function regionLineSpan(fileContent, region) {
  const lines = fileContent.split('\n');
  const open = `// <region:${region}>`;
  const close = `// </region:${region}>`;
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(open)) start = i + 1;
    if (start > 0 && lines[i].includes(close)) {
      end = i + 1;
      break;
    }
  }
  if (start < 0 || end < 0) {
    throw Object.assign(new Error(`region ${region} not found`), { code: 'REGION_MISSING' });
  }
  const lineStart = Math.min(start + 1, end);
  const lineEnd = Math.max(lineStart, end - 1);
  return { lineStart, lineEnd };
}

function shortCid(parts) {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/**
 * Map ATM BrokerAdmissionDisposition + BrokerDecision → harness decision/reason.
 * Honest: we do not invent cold_queue when ATM returns compose.
 */
export function mapAtmToHarness(admission, decision, intent, { cold_policy = 'queue' } = {}) {
  const disposition = admission.disposition;
  const verdict = decision.verdict;
  const lane = decision.lane;
  const atm_reason = decision.reason || admission.decisionReason || '';
  const base = {
    atm_disposition: disposition,
    atm_verdict: verdict,
    atm_lane: lane,
    atm_reason,
    atm_admission_state: decision.admission?.state ?? null,
    atm_ticket_state: admission.ticket?.state ?? null,
  };

  switch (disposition) {
    case 'direct':
      return { ...base, decision: 'admit', reason_code: 'atm_direct', serialized: false, composer: false };
    case 'proposal-required':
      return {
        ...base,
        decision: 'hot_provisional',
        reason_code: decision.admission?.state === 'provisional-write-lease'
          ? 'atm_provisional_write_lease'
          : 'atm_proposal_required',
        serialized: false,
        composer: false,
      };
    case 'compose':
      return { ...base, decision: 'composer_merge', reason_code: 'atm_compose', serialized: false, composer: true };
    case 'queue':
      return { ...base, decision: 'cold_queue', reason_code: 'atm_serial_queue', serialized: true, composer: false };
    case 'revalidate':
      return { ...base, decision: 'reject', reason_code: 'atm_revalidate', serialized: false, composer: false };
    case 'true-conflict':
      if (intent.hot_or_cold_hint === 'cold' && cold_policy === 'block') {
        return { ...base, decision: 'cold_block', reason_code: 'atm_true_conflict_cold_block', serialized: false, composer: false };
      }
      return { ...base, decision: 'reject', reason_code: 'atm_true_conflict', serialized: false, composer: false };
    default:
      return { ...base, decision: 'reject', reason_code: `atm_unknown_${disposition}`, serialized: false, composer: false };
  }
}

export class RealAtmBroker {
  constructor(worktree, opts = {}) {
    this.worktree = worktree;
    this.opts = {
      cold_policy: opts.cold_policy ?? 'queue',
      composer_enabled: opts.composer_enabled !== false,
      queue_timeout_ms: opts.queue_timeout_ms ?? 2000,
      repoId: opts.repoId ?? 'atm-bench',
      workspaceId: opts.workspaceId ?? 'atm-bench-worktree',
      baseCommit: opts.baseCommit ?? 'atm-bench-base',
    };
    this.registryPath = join(worktree, '.atm/runtime/write-broker.registry.json');
    this.api = null;
    this.registry = null;
    this.versions = new Map();
    this.decisions = [];
    this._holders = new Map(); // taskId -> { wake: deferred, intent_id }
    this._busy = Promise.resolve();
    this._ready = null;
  }

  async init() {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      this.api = await loadAtmApis();
      mkdirSync(dirname(this.registryPath), { recursive: true });
      if (existsSync(this.registryPath)) {
        this.registry = this.api.loadRegistry(this.registryPath, { persistCleanup: false });
      } else {
        this.registry = this.api.createEmptyBrokerRegistryDocument({
          repoId: this.opts.repoId,
          workspaceId: this.opts.workspaceId,
        });
        this.api.saveRegistry(this.registryPath, this.registry);
      }
      return this;
    })();
    return this._ready;
  }

  capability() {
    return {
      backend: 'real',
      atm_monorepo: this.api?.root ?? resolveAtmMonorepo(),
      atm_version: this.api?.version ?? atmVersionLabel(),
      import_paths: [
        'packages/core/src/broker/decision.ts#calculateBrokerDecision',
        'packages/core/src/broker/admission/evaluate-broker-admission.ts#evaluateBrokerAdmission',
        'packages/core/src/broker/registry.ts#registerIntent|releaseTask|saveRegistry',
      ],
      cold_behaviour: 'atm_native_plus_optional_queue_overlay',
      composer: true,
      provisional: true,
      cold_policy_requested: this.opts.cold_policy,
      note: 'Decision codes come from real ATM disposition/verdict/lane; no Claim Plane JIT.',
      gaps: [
        'Same-file cold overlaps often disposition=compose (composer_merge), not cold_queue.',
        'cold_policy=queue overlay only waits+retries on true-conflict for cold files; final code still from ATM.',
        'Full CLI shared-surface freeze/ack workflow not driven end-to-end in this smoke path.',
      ],
    };
  }

  version(path) { return this.versions.get(path) ?? 0; }
  bump(path) { this.versions.set(path, this.version(path) + 1); }
  activeIntentCount() { return this.registry?.activeIntents?.length ?? 0; }

  /** Serialize critical registry sections only (never hold across awaits). */
  async #critical(fn) {
    let release;
    const gate = new Promise((r) => { release = r; });
    const prev = this._busy;
    this._busy = prev.then(() => gate);
    await prev;
    try {
      return fn();
    } finally {
      release();
    }
  }

  #toWriteIntent(intent, agent) {
    const abs = join(this.worktree, intent.path);
    const content = readFileSync(abs, 'utf8');
    const span = regionLineSpan(content, intent.region);
    const hot = intent.hot_or_cold_hint === 'hot';
    const atomId = `atom-${intent.intent_id}`;
    const atomCid = shortCid([intent.intent_id, intent.path, intent.region, String(span.lineStart)]);
    const taskId = `TASK-${intent.intent_id}`.replace(/[^A-Za-z0-9_-]/g, '_').toUpperCase();
    const writeIntent = {
      schemaId: 'atm.writeIntent.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'atm-bench real backend' },
      taskId,
      actorId: agent.agent_id,
      baseCommit: this.opts.baseCommit,
      targetFiles: [intent.path],
      atomRefs: [{
        atomId,
        atomCid,
        operation: 'modify',
        sourceRange: { filePath: intent.path, lineStart: span.lineStart, lineEnd: span.lineEnd },
      }],
      sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
      requestedLane: 'auto',
      leaseBounds: { requestedSeconds: 120, maxSeconds: 300 },
    };
    if (hot) {
      writeIntent.proposalAdmission = {
        trigger: 'hot-file',
        summarySubmitted: true,
        hotFiles: [intent.path],
        boundedRegions: [{ filePath: intent.path, lineStart: span.lineStart, lineEnd: span.lineEnd }],
        notes: `atm-bench hot region ${intent.region}`,
      };
    }
    return writeIntent;
  }

  #evaluate(writeIntent, started) {
    const decision = this.api.calculateBrokerDecision(writeIntent, this.registry);
    const admission = this.api.evaluateBrokerAdmission(
      { intent: writeIntent },
      this.registry,
      { preferProposalForBoundedWork: true, startedAtMs: started, nowMs: Date.now() }
    );
    return { decision, admission };
  }

  #blockersFor(path, excludeTaskId) {
    return this.registry.activeIntents
      .filter((a) => a.taskId !== excludeTaskId && a.resourceKeys.files.includes(path))
      .map((a) => a.taskId);
  }

  record(intent, agent, d) {
    this.decisions.push({
      intent_id: intent.intent_id,
      agent_id: agent.agent_id,
      path: intent.path,
      region: intent.region,
      temperature: intent.hot_or_cold_hint,
      decision: d.decision,
      reason_code: d.reason_code,
      wait_ms: d.wait_ms ?? 0,
      atm_disposition: d.atm_disposition,
      atm_verdict: d.atm_verdict,
      atm_lane: d.atm_lane,
      at_ms: Date.now(),
    });
  }

  async admit(intent, agent, hooks = {}) {
    await this.init();
    const writeIntent = this.#toWriteIntent(intent, agent);
    const started = Date.now();
    let wait_ms = 0;
    let overlayUsed = null;

    // First evaluation under lock
    let { decision, admission } = await this.#critical(() => this.#evaluate(writeIntent, started));

    // ATM native queue: wait outside lock
    if (admission.disposition === 'queue') {
      const blockers = await this.#critical(() => this.#blockersFor(intent.path, writeIntent.taskId));
      hooks.onEnqueue?.({ position: blockers.length || 1, blocked_by: blockers[0] ?? null, atm_disposition: 'queue' });
      const outcome = await this.#waitForBlockers(blockers);
      wait_ms = Date.now() - started;
      hooks.onDequeue?.({ wait_ms, outcome });
      if (outcome === 'timeout') {
        const mapped = mapAtmToHarness(admission, decision, intent, this.opts);
        const t = { ...mapped, wait_ms, serialized: true, timed_out: true, base_version: this.version(intent.path), release: () => {} };
        this.record(intent, agent, t);
        return t;
      }
      ({ decision, admission } = await this.#critical(() => this.#evaluate(writeIntent, started)));
    }

    // Optional cold_policy=queue overlay on true-conflict (wait+retry; final codes still from ATM)
    if (
      admission.disposition === 'true-conflict'
      && intent.hot_or_cold_hint === 'cold'
      && this.opts.cold_policy === 'queue'
    ) {
      const blockers = await this.#critical(() => this.#blockersFor(intent.path, writeIntent.taskId));
      if (blockers.length) {
        overlayUsed = 'cold_policy_queue_retry';
        hooks.onEnqueue?.({
          position: 1,
          blocked_by: blockers[0],
          atm_disposition: 'true-conflict',
          overlay: overlayUsed,
        });
        const outcome = await this.#waitForBlockers(blockers);
        wait_ms = Date.now() - started;
        hooks.onDequeue?.({ wait_ms, outcome, overlay: overlayUsed });
        if (outcome !== 'timeout') {
          ({ decision, admission } = await this.#critical(() => this.#evaluate(writeIntent, started)));
        }
      }
    }

    return this.#critical(() => {
      const mapped = mapAtmToHarness(admission, decision, intent, this.opts);
      if (overlayUsed) mapped.overlay = overlayUsed;

      const rejectNow = mapped.decision === 'reject' || mapped.decision === 'cold_block';
      if (rejectNow) {
        const t = {
          ...mapped,
          wait_ms,
          base_version: this.version(intent.path),
          release: () => {},
          blocked_by: this.#blockersFor(intent.path, writeIntent.taskId),
        };
        this.record(intent, agent, t);
        return t;
      }

      if (mapped.decision === 'composer_merge' && !this.opts.composer_enabled) {
        const t = {
          ...mapped,
          decision: 'reject',
          reason_code: 'composer_disabled',
          composer: false,
          wait_ms,
          base_version: this.version(intent.path),
          release: () => {},
        };
        this.record(intent, agent, t);
        return t;
      }

      const lane = decision.lane === 'blocked' ? 'direct-brokered' : decision.lane;
      this.registry = this.api.registerIntent(this.registry, writeIntent, lane, 120, decision.admission);
      this.api.saveRegistry(this.registryPath, this.registry);

      const holder = deferred();
      this._holders.set(writeIntent.taskId, { wake: holder, intent_id: intent.intent_id });

      const release = () => {
        // sync release so AtmGateway finally{} does not need await; serialize via busy flag spin
        const doRelease = () => {
          this.registry = this.api.releaseTask(this.registry, writeIntent.taskId);
          this.api.saveRegistry(this.registryPath, this.registry);
          const h = this._holders.get(writeIntent.taskId);
          this._holders.delete(writeIntent.taskId);
          h?.wake.resolve();
        };
        // If critical section busy, chain; else run now (sync path preferred)
        if (this._releaseQueue) {
          this._releaseQueue = this._releaseQueue.then(doRelease, doRelease);
        } else {
          try { doRelease(); } catch (e) { console.error('real-broker release failed', e); }
        }
      };

      const ticket = {
        ...mapped,
        wait_ms,
        base_version: this.version(intent.path),
        release,
        task_id: writeIntent.taskId,
        atm_write_intent_task: writeIntent.taskId,
      };
      if (ticket.decision === 'hot_provisional') ticket.promotion = Promise.resolve(0);
      if (admission.disposition === 'queue' && wait_ms > 0 && ticket.decision === 'admit') {
        ticket.decision = 'cold_queue';
        ticket.reason_code = 'atm_queued_then_granted';
        ticket.serialized = true;
      }
      this.record(intent, agent, ticket);
      return ticket;
    });
  }

  async #waitForBlockers(blockers) {
    if (!blockers.length) return 'granted';
    const timeout = this.opts.queue_timeout_ms;
    return new Promise((resolve) => {
      let done = false;
      const finish = (outcome) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(outcome);
      };
      const timer = setTimeout(() => finish('timeout'), timeout);
      const waits = blockers.map((taskId) => {
        const h = this._holders.get(taskId);
        return h ? h.wake.promise : Promise.resolve();
      });
      Promise.all(waits).then(() => finish('granted'));
    });
  }
}

export { loadAtmApis };
