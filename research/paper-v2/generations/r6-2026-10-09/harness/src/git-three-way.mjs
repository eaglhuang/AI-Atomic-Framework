// D3: Git three-way baseline — concurrent same-file edits folded via `git merge-file`.
//
// N-way disclosure (frozen):
//   True n-way merge is not available from `git merge-file` (pairwise only).
//   This arm left-folds proposals against a **shared batch base blob**:
//     acc0 = base
//     acc_{k+1} = merge-file(ours=acc_k, orig=base, theirs=apply(base, patch_{k+1}))
//   That is an **n-way fold**, not a true multi-parent merge. Order = submit order.
//   Same-line / same-hunk concurrent edits typically conflict → blocked (no silent overwrite).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { insertIntoRegion, markerFor } from './util.mjs';

export const DEFAULT_COMPOSE_WINDOW_MS = 80;
export const GIT_MERGE_FOLD_METHOD = 'pairwise_left_fold_shared_base';
export const GIT_MERGE_NWAY_DISCLOSURE =
  'n-way is pairwise left-fold of git merge-file against a shared batch base (not true multi-parent n-way)';

const r2 = (x) => Math.round(x * 100) / 100;

export function digestText(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * Run `git merge-file -p` (stdout result). Returns { ok, status, text, conflict }.
 * status 0 = clean; >0 = conflict count; <0 = error.
 */
export function gitMergeFile({ ours, base, theirs, labels = ['ours', 'base', 'theirs'] }) {
  const dir = mkdtempSync(join(tmpdir(), 'atm-bench-merge-'));
  try {
    const oursP = join(dir, 'ours');
    const baseP = join(dir, 'base');
    const theirsP = join(dir, 'theirs');
    writeFileSync(oursP, ours);
    writeFileSync(baseP, base);
    writeFileSync(theirsP, theirs);
    const r = spawnSync(
      'git',
      [
        'merge-file', '-p',
        '-L', labels[0], '-L', labels[1], '-L', labels[2],
        oursP, baseP, theirsP,
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    const status = r.status == null ? -1 : r.status;
    const text = r.stdout ?? '';
    const conflict = status > 0 || text.includes('<<<<<<<');
    if (r.error) {
      return { ok: false, status: -1, text: '', conflict: true, error: String(r.error.message || r.error) };
    }
    return { ok: status === 0 && !conflict, status, text, conflict, stderr: r.stderr || '' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Pairwise left-fold of independent patches against a shared base blob.
 * Each patch.theirs must be `apply(base, edit)` — not apply(acc).
 */
export function foldMergeFile({ base, patches }) {
  let acc = base;
  const steps = [];
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    const merged = gitMergeFile({
      ours: acc,
      base,
      theirs: p.theirs,
      labels: [`acc_${i}`, 'batch_base', p.label || `patch_${i}`],
    });
    steps.push({
      index: i,
      label: p.label || `patch_${i}`,
      intent_id: p.intent_id ?? null,
      status: merged.status,
      ok: merged.ok,
      conflict: merged.conflict,
      error: merged.error ?? null,
    });
    if (!merged.ok) {
      return {
        ok: false,
        conflict: true,
        text: merged.text,
        steps,
        fold_method: GIT_MERGE_FOLD_METHOD,
        nway_disclosure: GIT_MERGE_NWAY_DISCLOSURE,
        failed_at: i,
      };
    }
    acc = merged.text;
  }
  return {
    ok: true,
    conflict: false,
    text: acc,
    steps,
    fold_method: GIT_MERGE_FOLD_METHOD,
    nway_disclosure: GIT_MERGE_NWAY_DISCLOSURE,
    failed_at: null,
  };
}

/**
 * Per-file batch window → shared-base git merge-file fold.
 * Close conditions mirror C2 steward windows (count / timeout / immediate).
 * Late joiner after close → new batch.
 */
export class GitThreeWayManager {
  constructor({
    cwd,
    artifactsDir,
    compose_window_ms = DEFAULT_COMPOSE_WINDOW_MS,
    onApplied = null,
    onBatchClose = null,
  }) {
    this.cwd = cwd;
    this.artifactsDir = artifactsDir;
    this.compose_window_ms = Number(compose_window_ms);
    if (!Number.isFinite(this.compose_window_ms) || this.compose_window_ms < 0) {
      throw new Error(`compose_window_ms must be >= 0 (got ${compose_window_ms})`);
    }
    this.onApplied = onApplied;
    this.onBatchClose = onBatchClose;
    this.windows = new Map();
    this._batchSeq = 0;
  }

  #nextBatchId(targetFile) {
    this._batchSeq += 1;
    const safe = String(targetFile).replace(/[^\w.-]+/g, '_');
    return `gm-${safe}-${String(this._batchSeq).padStart(4, '0')}`;
  }

  /**
   * @param {object} input
   * @param {string} input.targetFile relative path
   * @param {string} input.absPath absolute path to file
   * @param {string} input.region
   * @param {string} input.line full marker line (without // prefix)
   * @param {string} input.intent_id
   * @param {number} [input.expectedCount]
   * @param {string} [input.expected_source]
   */
  async submit(input) {
    const key = input.targetFile;
    const logical_id = input.logical_id ?? input.intent_id;
    const attempt_id = input.attempt_id ?? `att-${input.intent_id}-r0`;

    let win = this.windows.get(key);
    if (!win || win.closed) {
      const baseText = readFileSync(input.absPath, 'utf8');
      win = {
        closed: false,
        batch_id: this.#nextBatchId(key),
        expectedCount: Math.max(1, input.expectedCount || 1),
        expected_source: input.expected_source || 'caller',
        entries: [],
        baseText,
        baseDigest: digestText(baseText),
        absPath: input.absPath,
        targetFile: key,
        openedAt: performance.now(),
        timer: null,
        resultPromise: null,
        resolveResult: null,
        close_reason: null,
      };
      win.resultPromise = new Promise((r) => { win.resolveResult = r; });
      this.windows.set(key, win);
    } else {
      const incoming = input.expectedCount || 1;
      if (Number.isFinite(incoming)) {
        win.expectedCount = Math.max(1, Math.min(win.expectedCount, incoming));
      }
      if (input.expected_source && win.expected_source === 'composer_timeout_only'
          && input.expected_source === 'ticket_cowriters') {
        win.expected_source = input.expected_source;
      }
    }

    // Independent patch against the **batch** shared base (not current worktree).
    let theirs;
    try {
      theirs = insertIntoRegion(win.baseText, input.region, input.line);
    } catch (e) {
      theirs = null;
      win.entries.push({
        intent_id: input.intent_id,
        logical_id,
        attempt_id,
        region: input.region,
        line: input.line,
        label: input.intent_id,
        theirs: null,
        build_error: String(e.message || e),
        enteredAt: performance.now(),
      });
      // Still participate in batch close so peers are not stranded.
    }
    if (theirs != null) {
      win.entries.push({
        intent_id: input.intent_id,
        logical_id,
        attempt_id,
        region: input.region,
        line: input.line,
        label: input.intent_id,
        theirs,
        build_error: null,
        enteredAt: performance.now(),
      });
    }

    const tryClose = (reason) => {
      if (win.closed) return;
      this.#closeWindow(key, win, reason);
    };

    if (this.compose_window_ms === 0 || win.expectedCount === 1) {
      tryClose('immediate');
    } else if (win.entries.length >= win.expectedCount) {
      tryClose('count');
    } else if (!win.timer) {
      win.timer = setTimeout(() => tryClose('timeout'), this.compose_window_ms);
    }

    const batch = await win.resultPromise;
    const mineOk = batch.ok && batch.intent_ids.includes(input.intent_id)
      && !batch.build_errors?.[input.intent_id];
    return {
      atm_writer: 'git_three_way',
      batch_id: batch.batch_id,
      logical_id,
      attempt_id,
      git_merge_verdict: batch.ok ? 'applied' : 'blocked',
      git_fold_method: batch.fold_method,
      nway_disclosure: batch.nway_disclosure,
      compose_batch_size: batch.compose_batch_size,
      compose_window_ms: this.compose_window_ms,
      window_wait_ms: batch.window_wait_ms,
      close_reason: batch.close_reason,
      expected_source: batch.expected_source,
      proposalIds: batch.proposalIds,
      intent_ids: batch.intent_ids,
      base_digest: batch.base_digest,
      output_digest: batch.output_digest,
      merge_steps: batch.merge_steps,
      blocked_reason: batch.blocked_reason,
      composer: false,
      serialized: false,
      proposer_direct_writes: 0,
      outcome: mineOk ? 'commit' : 'blocked',
      reason_code: mineOk
        ? (input.reason_code_base || 'git_three_way_applied')
        : (batch.blocked_reason || 'git_merge_conflict'),
    };
  }

  #closeWindow(key, win, close_reason) {
    if (win.closed) return;
    win.closed = true;
    win.close_reason = close_reason;
    if (win.timer) { clearTimeout(win.timer); win.timer = null; }

    const closedAt = performance.now();
    const window_wait_ms = r2(closedAt - win.openedAt);
    const intent_ids = win.entries.map((e) => e.intent_id);
    const proposalIds = intent_ids.map((id) => `git-${id}`);
    const build_errors = {};
    for (const e of win.entries) {
      if (e.build_error) build_errors[e.intent_id] = e.build_error;
    }

    const artDir = join(this.artifactsDir, 'git_merge', win.batch_id);
    mkdirSync(artDir, { recursive: true });
    writeFileSync(join(artDir, 'base.txt'), win.baseText);
    for (const e of win.entries) {
      if (e.theirs != null) writeFileSync(join(artDir, `theirs-${e.intent_id}.txt`), e.theirs);
    }

    let ok = false;
    let blocked_reason = null;
    let output_digest = null;
    let merge_steps = [];
    let fold_method = GIT_MERGE_FOLD_METHOD;
    let nway_disclosure = GIT_MERGE_NWAY_DISCLOSURE;
    let resultText = null;

    const patches = win.entries.filter((e) => e.theirs != null);
    if (Object.keys(build_errors).length && patches.length === 0) {
      blocked_reason = 'git_patch_build_failed';
    } else if (patches.length === 0) {
      blocked_reason = 'git_empty_batch';
    } else {
      // Single patch: still run through merge-file(ours=base, base, theirs) for uniform receipts,
      // or write directly — merge-file(base, base, theirs) ≡ theirs when clean.
      const fold = foldMergeFile({
        base: win.baseText,
        patches: patches.map((e) => ({
          theirs: e.theirs,
          label: e.label,
          intent_id: e.intent_id,
        })),
      });
      merge_steps = fold.steps;
      fold_method = fold.fold_method;
      nway_disclosure = fold.nway_disclosure;
      writeFileSync(join(artDir, 'fold_receipt.json'), JSON.stringify({
        batch_id: win.batch_id,
        fold_method,
        nway_disclosure,
        steps: merge_steps,
        ok: fold.ok,
        failed_at: fold.failed_at,
      }, null, 2) + '\n');

      if (!fold.ok) {
        blocked_reason = 'git_merge_conflict';
        writeFileSync(join(artDir, 'conflict.txt'), fold.text || '');
        // Do NOT write conflict markers into the canonical worktree.
      } else {
        // Guard: worktree must still match batch base (no silent clobber of interleaved writers).
        const live = readFileSync(win.absPath, 'utf8');
        if (live !== win.baseText) {
          blocked_reason = 'git_base_drift';
          writeFileSync(join(artDir, 'live_drift.txt'), live);
        } else {
          writeFileSync(win.absPath, fold.text);
          resultText = fold.text;
          output_digest = digestText(fold.text);
          ok = true;
          if (typeof this.onApplied === 'function') this.onApplied(key);
        }
      }
    }

    if (Object.keys(build_errors).length && ok) {
      // Mixed: some entries failed to build — whole batch blocked to avoid partial silent loss.
      // (Should be rare; revert write if we already wrote.)
      if (resultText != null) writeFileSync(win.absPath, win.baseText);
      ok = false;
      blocked_reason = 'git_patch_build_failed';
      output_digest = null;
    }

    const batch = {
      event: 'compose_batch',
      atm_writer: 'git_three_way',
      batch_id: win.batch_id,
      targetFile: key,
      proposalIds,
      intent_ids,
      logical_ids: win.entries.map((e) => e.logical_id),
      compose_batch_size: win.entries.length,
      compose_verdict: ok ? 'merged' : 'conflict',
      steward_verdict: ok ? 'applied' : 'blocked', // parallel field for compare tooling
      git_merge_verdict: ok ? 'applied' : 'blocked',
      fold_method,
      nway_disclosure,
      window_wait_ms,
      close_reason,
      expected_source: win.expected_source,
      expectedCount: win.expectedCount,
      base_digest: win.baseDigest,
      output_digest,
      merge_steps,
      blocked_reason,
      build_errors: Object.keys(build_errors).length ? build_errors : undefined,
      ok,
    };
    writeFileSync(join(artDir, 'batch.json'), JSON.stringify(batch, null, 2) + '\n');
    if (typeof this.onBatchClose === 'function') this.onBatchClose(batch);
    // Drop closed window so late joiners open a new batch.
    this.windows.delete(key);
    win.resolveResult(batch);
  }
}
