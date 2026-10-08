// Steward writer arm (C1/C2): agents propose PatchProposals; a neutral steward
// composes + applies. Proposers never write the canonical file.
//
// C2 batch closure (METRIC_DEFINITIONS §0 / §3):
//   Close = first of (a) expected peer count, (b) compose_window_ms elapsed,
//           (c) window_ms===0 or expectedCount===1 → immediate single-proposal.
//   Late joiner after close → NEW batch (never joins a closed window).
//   Scheduler = this ComposeWindowManager (harness), not ATM core.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { atmCoreBroker, requireNodeForRealAtm, resolveAtmMonorepo } from './atm-resolve.mjs';
import { markerFor, tsTaipei } from './util.mjs';

export const NEUTRAL_STEWARD_ID = 'neutral-write-steward';
export const DEFAULT_COMPOSE_WINDOW_MS = 80;

const r2 = (x) => Math.round(x * 100) / 100;

async function loadStewardApis() {
  requireNodeForRealAtm();
  const root = resolveAtmMonorepo();
  const imp = (rel) => import(pathToFileURL(atmCoreBroker(rel)).href);
  const [{ composeBrokerProposals }, { applyStewardPlan, readGitHeadCommit }] = await Promise.all([
    imp('compose.ts'),
    imp('steward.ts'),
  ]);
  return { root, composeBrokerProposals, applyStewardPlan, readGitHeadCommit };
}

export function hashFileText(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/** Init git repo + initial commit so baseCommit / readGitHeadCommit work. Returns HEAD sha. */
export function initWorktreeGit(cwd) {
  const run = (args) => {
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
    }
    return r;
  };
  if (!existsSync(join(cwd, '.git'))) {
    run(['init']);
    run(['config', 'user.name', 'atm-bench']);
    run(['config', 'user.email', 'atm-bench@local']);
    run(['config', 'commit.gpgsign', 'false']);
  }
  run(['add', '-A']);
  const status = spawnSync('git', ['-C', cwd, 'status', '--porcelain'], { encoding: 'utf8' });
  if ((status.stdout || '').trim()) {
    run(['commit', '-m', 'atm-bench fixture base']);
  } else {
    const head = spawnSync('git', ['-C', cwd, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' });
    if (head.status !== 0) {
      run(['commit', '--allow-empty', '-m', 'atm-bench empty base']);
    }
  }
  return String(spawnSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout || '').trim();
}

/**
 * Build a unified-diff PatchProposal that inserts `// <markerLine>` just before
 * the region's closing tag — same semantics as util.insertIntoRegion.
 */
export function buildMarkerInsertPatch(content, targetFile, region, markerLine, prefix = '//') {
  const close = `${prefix} </region:${region}>`;
  const lines = content.split('\n');
  const endsWithNl = content.endsWith('\n');
  const logical = endsWithNl && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  let closeIdx = -1;
  for (let i = 0; i < logical.length; i++) {
    if (logical[i].includes(close)) { closeIdx = i; break; }
  }
  if (closeIdx < 0) {
    throw Object.assign(new Error(`region ${region} not found in ${targetFile}`), { code: 'REGION_MISSING' });
  }
  const insert = `${prefix} ${markerLine}`;
  const start = closeIdx;
  const contextStart = Math.max(0, start - 1);
  const contextEnd = Math.min(logical.length, start + 1 + 1);
  const before = logical.slice(contextStart, start).map((l) => ` ${l}`);
  const removed = logical.slice(start, start + 1).map((l) => `-${l}`);
  const added = [insert, logical[start]].map((l) => `+${l}`);
  const after = logical.slice(start + 1, contextEnd).map((l) => ` ${l}`);
  const oldLength = contextEnd - contextStart;
  const newLength = oldLength - 1 + 2;
  const patch = [
    `--- a/${targetFile}`,
    `+++ b/${targetFile}`,
    `@@ -${contextStart + 1},${oldLength} +${contextStart + 1},${newLength} @@`,
    ...before, ...removed, ...added, ...after, '',
  ].join('\n');
  return { patch, closeLine: closeIdx + 1, insert };
}

export function makeMarkerProposal({
  proposalId, taskId, actorId, targetFile, region, content, baseCommit, intentId, atomRefs,
}) {
  const markerLine = `${markerFor(intentId)} by ${actorId}`;
  const { patch, closeLine } = buildMarkerInsertPatch(content, targetFile, region, markerLine);
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'atm-bench steward writer' },
    proposalId,
    taskId: taskId || `TASK-${proposalId}`.replace(/[^A-Za-z0-9_-]/g, '_').toUpperCase(),
    actorId,
    baseCommit,
    fileBeforeHash: hashFileText(content),
    targetFile,
    atomRefs: atomRefs ?? [{ atomId: `atom.${proposalId}`, atomCid: `cid.${proposalId}` }],
    anchors: [{ kind: 'line', hint: `L${closeLine}:${region}` }],
    intent: `atm-bench marker insert for ${intentId} region ${region}`,
    patch,
    validators: [],
    rollback: 'discard',
  };
}

/**
 * Resolve expected batch size from an admission ticket + window setting.
 * Real ATM never fills `cowriters` today → composer_merge falls back to timeout-only.
 */
export function resolveExpectedCount(ticket, compose_window_ms) {
  // Window 0: every proposal is its own immediate batch (METRIC_DEFINITIONS §0).
  if (compose_window_ms === 0) return { expectedCount: 1, expected_source: 'window_zero' };
  if (Array.isArray(ticket?.cowriters) && ticket.cowriters.length > 0) {
    return { expectedCount: ticket.cowriters.length + 1, expected_source: 'ticket_cowriters' };
  }
  if (ticket?.composer || ticket?.decision === 'composer_merge') {
    // Timeout-primary: no finite peer count from real ATM.
    return { expectedCount: Infinity, expected_source: 'composer_timeout_only' };
  }
  return { expectedCount: 1, expected_source: 'single' };
}

/**
 * Per-file compose window. Harness owns close (not ATM core).
 *
 * Frozen late-joiner rule: after a window closes + deletes, a later proposal for
 * the same file opens a **new** batch — it never joins the closed one.
 */
export class ComposeWindowManager {
  constructor({
    cwd,
    artifactsDir,
    compose_window_ms = DEFAULT_COMPOSE_WINDOW_MS,
    onApplied = null,
    onBatchClose = null, // (compose_batch event object) => void
    applyLock = null, // r2: (path, fn) => fn() under a cross-process lock (MP steward serialization); null = r1 behaviour
    evidenceTag = null, // r2: e.g. 'w0' in multi-process so batch ids / evidence files never collide across processes
    onApplyTelemetry = null, // r2 forensics: (steward_apply record) => void
  }) {
    this.cwd = cwd;
    this.artifactsDir = artifactsDir;
    this.compose_window_ms = Number(compose_window_ms);
    if (!Number.isFinite(this.compose_window_ms) || this.compose_window_ms < 0) {
      throw new Error(`compose_window_ms must be >= 0 (got ${compose_window_ms})`);
    }
    this.onApplied = onApplied;
    this.onBatchClose = onBatchClose;
    this.applyLock = applyLock;
    this.evidenceTag = evidenceTag;
    this.onApplyTelemetry = onApplyTelemetry;
    this.windows = new Map(); // targetFile -> open window (absent/closed ⇒ new batch)
    this.api = null;
    this._apiReady = null;
    this._batchSeq = 0;
    this.proposer_direct_writes = 0;
  }

  async ensureApi() {
    if (this.api) return this.api;
    if (!this._apiReady) this._apiReady = loadStewardApis().then((api) => { this.api = api; return api; });
    return this._apiReady;
  }

  #nextBatchId(targetFile) {
    this._batchSeq += 1;
    const safe = String(targetFile).replace(/[^\w.-]+/g, '_');
    const tag = this.evidenceTag ? `${this.evidenceTag}-` : '';
    return `cb-${safe}-${tag}${String(this._batchSeq).padStart(4, '0')}`;
  }

  /**
   * @returns {Promise<object>} fields for the per-agent decision event
   */
  async submit(input) {
    const api = await this.ensureApi();
    const key = input.targetFile;
    const logical_id = input.logical_id ?? input.intent_id;
    const attempt_id = input.attempt_id ?? `att-${input.intent_id}-r0`;
    const repropose_rounds = input.repropose_rounds ?? 0;

    // Late joiner: only join if there is an *open* (not closed) window for this file.
    let win = this.windows.get(key);
    if (!win || win.closed) {
      win = {
        closed: false,
        batch_id: this.#nextBatchId(key),
        expectedCount: Math.max(1, input.expectedCount || 1),
        expected_source: input.expected_source || 'caller',
        entries: [],
        openedAt: performance.now(),
        timer: null,
        resultPromise: null,
        resolveResult: null,
        close_reason: null,
      };
      win.resultPromise = new Promise((r) => { win.resolveResult = r; });
      this.windows.set(key, win);
    } else {
      // Tighten expectedCount if a peer arrives with a concrete count (e.g. cowriters).
      const incoming = input.expectedCount || 1;
      if (Number.isFinite(incoming)) {
        win.expectedCount = Math.max(1, Math.min(win.expectedCount, incoming));
      }
      if (input.expected_source && win.expected_source === 'composer_timeout_only'
          && input.expected_source === 'ticket_cowriters') {
        win.expected_source = input.expected_source;
      }
    }

    win.entries.push({
      proposal: input.proposal,
      intent_id: input.intent_id,
      logical_id,
      attempt_id,
      actorId: input.proposal.actorId,
      enteredAt: performance.now(),
    });

    const tryClose = (reason) => {
      if (win.closed) return;
      this.#closeWindow(key, win, api, reason);
    };

    // Close conditions (first wins):
    // (c) window=0 or expectedCount===1 → immediate
    // (a) count reached
    // (b) else arm timeout (skipped when window_ms===0 — already immediate)
    if (this.compose_window_ms === 0 || win.expectedCount === 1) {
      tryClose('immediate');
    } else if (win.entries.length >= win.expectedCount) {
      tryClose('count');
    } else if (!win.timer) {
      win.timer = setTimeout(() => tryClose('timeout'), this.compose_window_ms);
    }

    const batch = await win.resultPromise;
    const mine = batch.proposalIds.includes(input.proposal.proposalId);
    return {
      atm_writer: 'steward',
      batch_id: batch.batch_id,
      logical_id,
      attempt_id,
      steward_verdict: batch.steward_verdict,
      blocked_reason: batch.blocked_reason,
      blocked_reasons: batch.blocked_reasons,
      repropose_rounds,
      proposer_direct_writes: 0,
      compose_verdict: batch.compose_verdict,
      compose_apply_method: batch.compose_apply_method,
      compose_batch_size: batch.compose_batch_size,
      compose_window_ms: this.compose_window_ms,
      window_wait_ms: batch.window_wait_ms,
      close_reason: batch.close_reason,
      expected_source: batch.expected_source,
      steward_id: NEUTRAL_STEWARD_ID,
      proposal_id: input.proposal.proposalId,
      proposalIds: batch.proposalIds,
      outcome: batch.steward_verdict === 'applied' && mine ? 'commit' : 'blocked',
      reason_code: batch.steward_verdict === 'applied'
        ? (input.reason_code_base || 'steward_applied')
        : (batch.blocked_reason || 'steward_blocked'),
    };
  }

  #closeWindow(key, win, api, close_reason) {
    if (win.closed) return;
    win.closed = true;
    win.close_reason = close_reason;
    if (win.timer) { clearTimeout(win.timer); win.timer = null; }

    const closedAt = performance.now();
    const window_wait_ms = r2(closedAt - win.openedAt);
    const proposals = win.entries.map((e) => e.proposal);
    const proposalIds = proposals.map((p) => p.proposalId);
    const intent_ids = win.entries.map((e) => e.intent_id);
    const attempt_ids = win.entries.map((e) => e.attempt_id);
    const logical_ids = win.entries.map((e) => e.logical_id);

    let compose_verdict = null;
    let compose_apply_method = null;
    let steward_verdict = 'blocked';
    let blocked_reasons = [];
    let blocked_reason = null;
    let thrown = null;
    let written = false;
    let output_digest = null;
    let base_digest = proposals[0]?.fileBeforeHash ?? null;

    const readHash = (rel) => {
      try { return hashFileText(readFileSync(join(this.cwd, rel), 'utf8')); } catch { return null; }
    };
    const tel = {
      event: 'steward_apply', batch_id: win.batch_id, path: key, pid: process.pid,
      evidence_tag: this.evidenceTag, apply_lock: !!this.applyLock, proposalIds: [...proposalIds],
      intent_ids: [...intent_ids], proposal_base_hashes: proposals.map((p) => p.fileBeforeHash ?? null),
    };
    const t_req = performance.now();
    const doComposeApply = () => {
    tel.lock_wait_ms = r2(performance.now() - t_req);
    tel.t_start_epoch_ms = r2(performance.timeOrigin + performance.now());
    tel.pre_apply_hash = readHash(key);
    try {
      const composed = api.composeBrokerProposals(proposals);
      compose_verdict = composed.mergePlan?.verdict ?? null;
      compose_apply_method = composed.mergePlan?.applyMethod ?? null;
      const evidencePath = join(
        this.artifactsDir,
        'steward',
        `${win.batch_id}.json`,
      );
      mkdirSync(dirname(evidencePath), { recursive: true });
      const result = api.applyStewardPlan({
        cwd: this.cwd,
        stewardId: NEUTRAL_STEWARD_ID,
        mergePlan: composed.mergePlan,
        proposals,
        scopeFiles: [...new Set(proposals.map((p) => p.targetFile))],
        evidenceOutPath: evidencePath,
      });
      steward_verdict = result?.evidence?.verdict ?? (result?.ok ? 'applied' : 'blocked');
      blocked_reasons = [...(result?.evidence?.blockedReasons ?? [])];
      if (!result?.ok) {
        blocked_reason = blocked_reasons[0] || `steward_${steward_verdict}`;
      } else {
        written = true;
        const afterHashes = result?.evidence?.fileAfterHashes ?? {};
        const h = afterHashes[key] ?? afterHashes[proposals[0]?.targetFile];
        if (h) output_digest = h.startsWith('sha256:') ? h : `sha256:${h}`;
      }
      if (steward_verdict === 'applied' && this.onApplied) {
        try { this.onApplied(key); } catch { /* ignore bump errors */ }
      }
      tel.receipt_before_hash = (() => { const h = result?.evidence?.fileBeforeHashes?.[key]; return h ? (h.startsWith('sha256:') ? h : `sha256:${h}`) : null; })();
      tel.receipt_after_hash = output_digest;
    } catch (e) {
      thrown = String(e?.message || e);
      steward_verdict = 'blocked';
      blocked_reason = e?.code || 'steward_exception';
      blocked_reasons = [thrown];
    }
    tel.post_apply_hash = readHash(key);
    tel.t_end_epoch_ms = r2(performance.timeOrigin + performance.now());
    };
    if (this.applyLock) this.applyLock(key, doComposeApply); else doComposeApply();
    tel.steward_verdict = steward_verdict;
    tel.written = written;
    // Interleave signature: the bytes ATM re-read right before its canonical write differ from what was
    // on disk when this steward started composing => another writer landed inside the check→write window.
    tel.interleave_suspect = !!(written && tel.receipt_before_hash && tel.pre_apply_hash
      && tel.receipt_before_hash !== tel.pre_apply_hash);
    // Post-write overwrite signature: after our write, disk already differs from our output.
    tel.post_write_drift = !!(written && tel.receipt_after_hash && tel.post_apply_hash
      && tel.receipt_after_hash !== tel.post_apply_hash);
    try { this.onApplyTelemetry?.(tel); } catch { /* telemetry never fails the run */ }

    const batch = {
      batch_id: win.batch_id,
      steward_verdict,
      blocked_reason,
      blocked_reasons,
      compose_verdict,
      compose_apply_method,
      proposalIds,
      compose_batch_size: proposalIds.length,
      window_wait_ms,
      close_reason,
      expected_source: win.expected_source,
      thrown,
      written,
    };

    // Dedicated compose_batch event (METRIC_DEFINITIONS §3 / checklist C2).
    const composeBatchEvent = {
      event: 'compose_batch',
      ts: tsTaipei(),
      batch_id: win.batch_id,
      path: key,
      proposalIds,
      intent_ids,
      attempt_ids,
      logical_ids,
      // logical_id from scenario (log:…); falls back to intent_id for legacy cells.
      members: win.entries.map((e) => ({
        intent_id: e.intent_id,
        logical_id: e.logical_id,
        attempt_id: e.attempt_id,
        proposal_id: e.proposal.proposalId,
        actorId: e.actorId,
      })),
      compose_verdict,
      steward_verdict,
      blocked_reasons,
      blocked_reason,
      window_wait_ms,
      compose_window_ms: this.compose_window_ms,
      compose_batch_size: proposalIds.length,
      close_reason,
      expected_source: win.expected_source,
      expected_count: Number.isFinite(win.expectedCount) ? win.expectedCount : null,
      proposer_direct_writes: 0,
      repropose_rounds: 0, // C2-out / P1-3: no stale→repropose loop yet
      steward_id: NEUTRAL_STEWARD_ID,
      base_digest,
      written,
      output_digest,
      reason: steward_verdict === 'applied' ? 'steward_applied' : (blocked_reason || 'steward_blocked'),
    };
    try {
      this.onBatchClose?.(composeBatchEvent);
    } catch { /* never fail the run on telemetry */ }

    win.resolveResult(batch);
    // Late joiner rule: delete so the next submit opens a fresh window/batch.
    this.windows.delete(key);
  }
}

/** Snapshot HEAD for proposals; throws if worktree is not a git repo. */
export async function readBaseCommit(cwd) {
  const api = await loadStewardApis();
  const head = api.readGitHeadCommit(cwd);
  if (!head) throw new Error(`worktree is not a git repo (no HEAD): ${cwd}`);
  return head;
}
