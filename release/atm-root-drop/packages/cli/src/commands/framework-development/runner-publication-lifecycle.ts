import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildRunnerPublicationReceipt } from './runner-publication-receipt.ts';
import {
  captureRunnerBuildOutputSnapshot,
  deriveRunnerBuildOutputInventory,
  evaluateRunnerPublicationDisposition,
  planRunnerPublicationTakeover,
  validateRunnerBuildOutputInventory,
  type RunnerBuildOutputInventory,
  type RunnerBuildOutputTarget,
  type RunnerPublicationTakeoverPlan,
  type RunnerPublicationDispositionReport
} from '../../../../core/src/broker/runner-build-output-inventory.ts';

export function authorizeRunnerPublicationTakeover(input: { readonly cwd: string; readonly taskId: string; readonly sealedSourceSha: string; readonly buildTarget: RunnerBuildOutputTarget; readonly currentTaskAllowedFiles: readonly string[] }): RunnerPublicationTakeoverPlan {
  const snapshot = captureRunnerBuildOutputSnapshot({ cwd: input.cwd, buildTarget: input.buildTarget, currentTaskId: input.taskId, currentTaskAllowedFiles: input.currentTaskAllowedFiles });
  const plan = planRunnerPublicationTakeover({ sealedSourceSha: input.sealedSourceSha, snapshot });
  if (plan.entries.length === 0) throw new Error('ATM_RUNNER_PUBLICATION_PENDING: takeover requires at least one pre-existing generated publication member.');
  const receiptPath = path.join(input.cwd, '.atm', 'history', 'evidence', `${input.taskId}.runner-publication-takeover.json`);
  writeFileSync(receiptPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  return plan;
}

/**
 * Pure lifecycle for a sealed runner: private prepare/build/seal, then a
 * queue-head-gated shared publication, receipt archival, and idempotent retry.
 */

export type PublicationPhase =
  | 'prepared'
  /** Legacy persisted spelling. It has the same queue-free build semantics as prepared. */
  | 'reservation'
  | 'build-ready'
  | 'built-sealed'
  | 'publication-ready'
  | 'published'
  | 'receipt-archived';

const PHASE_ORDER: readonly PublicationPhase[] = [
  'prepared',
  'reservation',
  'build-ready',
  'built-sealed',
  'publication-ready',
  'published',
  'receipt-archived'
];

export type PublicationAction =
  | 'reserve'
  | 'build'
  | 'seal'
  | 'prepare-publication'
  | 'publish'
  | 'archive-receipt'
  | 'complete'
  | 'wait';

export interface PublicationAuthority {
  readonly taskId: string;
  readonly laneSessionId: string | null;
  readonly stewardActorId: string;
}

export interface PublicationSnapshot {
  readonly phase: PublicationPhase;
  readonly sealedSourceSha: string | null;
  readonly generation: number;
  readonly runnerBuildDigest: string | null;
  readonly manifestDigest: string | null;
  readonly publicationCommitSha: string | null;
  readonly publishedGenerations: readonly number[];
  readonly archivedReceiptPath: string | null;
  /** Queue-head ownership for the sealed source (gate only before publication). */
  readonly queueHeadOwned: boolean;
}

export interface PublicationRequest {
  readonly authority: PublicationAuthority;
  readonly sealedSourceSha: string;
  readonly surfaces: readonly string[];
  /** 'remote' publishes onward; 'local' keeps the runner in-repo only. */
  readonly remoteVisibility: 'local' | 'remote';
  readonly now?: string;
}

export type PublicationErrorCode = 'ATM_RUNNER_SYNC_STEWARD_REQUIRED' | 'ATM_RUNNER_PUBLICATION_DUPLICATE_GENERATION' | null;

export interface PublicationReceipt {
  readonly schemaId: 'atm.sealedRunnerPublicationReceipt.v1';
  readonly taskId: string;
  readonly laneFingerprint: string | null;
  readonly stewardActorId: string;
  readonly sealedSourceSha: string;
  readonly generation: number;
  readonly runnerBuildDigest: string | null;
  readonly manifestDigest: string | null;
  readonly surfaces: readonly string[];
  readonly publicationCommitSha: string | null;
  readonly remoteVisibility: 'local' | 'remote';
  readonly receiptDisposition: 'archived' | 'pending';
  readonly receiptDigest: string;
  readonly issuedAt: string;
}

export interface PublicationDecision {
  readonly schemaId: 'atm.sealedRunnerPublicationDecision.v1';
  readonly action: PublicationAction;
  readonly phase: PublicationPhase;
  readonly allowed: boolean;
  readonly errorCode: PublicationErrorCode;
  readonly idempotent: boolean;
  /** Present once the lifecycle reaches receipt-archived (or a prior archive). */
  readonly receipt: PublicationReceipt | null;
  readonly recoveryCommand: string | null;
  readonly reason: string;
}

export interface RunnerPublicationContinuationInput {
  readonly taskId: string;
  readonly queueMemberTaskIds: readonly string[];
  readonly stewardWorkId: string;
  readonly queueHeadStewardWorkId: string;
  readonly sealedSourceSha: string;
  readonly receiptSealedSourceSha: string;
  readonly receiptDigest: string;
  readonly inventoryDigest: string;
  readonly receiptInventoryDigest: string;
}

export interface RunnerPublicationContinuationDecision {
  readonly schemaId: 'atm.runnerPublicationContinuationDecision.v1';
  readonly allowed: boolean;
  readonly code: 'ATM_RUNNER_PUBLICATION_CONTINUATION_MISMATCH' | null;
  readonly reason: string;
}

/**
 * Validates the durable continuation authority for publishing a receipt after
 * its source task has closed.  The authority is the sealed queue/receipt
 * tuple, never a reopened task, actor override, or task-id exception.
 */
export function evaluateRunnerPublicationContinuation(
  input: RunnerPublicationContinuationInput,
): RunnerPublicationContinuationDecision {
  const mismatches = [
    input.queueMemberTaskIds.includes(input.taskId) ? null : 'queue-member-task',
    input.stewardWorkId === input.queueHeadStewardWorkId ? null : 'queue-head-work',
    input.sealedSourceSha === input.receiptSealedSourceSha ? null : 'sealed-source',
    input.inventoryDigest === input.receiptInventoryDigest ? null : 'output-inventory',
    /^sha256:[a-f0-9]{64}$/i.test(input.receiptDigest) ? null : 'receipt-digest',
  ].filter((entry): entry is string => entry !== null);
  return mismatches.length === 0
    ? {
      schemaId: 'atm.runnerPublicationContinuationDecision.v1',
      allowed: true,
      code: null,
      reason: 'Queue-head, sealed source, receipt digest, and output inventory form one durable publication continuation.',
    }
    : {
      schemaId: 'atm.runnerPublicationContinuationDecision.v1',
      allowed: false,
      code: 'ATM_RUNNER_PUBLICATION_CONTINUATION_MISMATCH',
      reason: `Publication continuation facts do not match: ${mismatches.join(', ')}.`,
    };
}

export interface RunnerPublicationInspection {
  readonly schemaId: 'atm.runnerPublicationInspection.v1';
  readonly ok: boolean;
  readonly code: 'ATM_RUNNER_PUBLICATION_PENDING' | 'ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE' | null;
  readonly receiptPath: string | null;
  readonly sealedSourceSha: string | null;
  readonly report: RunnerPublicationDispositionReport;
}


export interface RunnerPublicationReceiptReconciliation {
  readonly schemaId: 'atm.runnerPublicationReceiptReconciliation.v1';
  readonly taskId: string;
  readonly actorId: string;
  readonly legacyReceiptPath: string;
  readonly legacyTaskId: string;
  readonly expectedHeadDigest: string | null;
  readonly dirtyBeforeDigest: string;
  readonly restoredAfterDigest: string | null;
  readonly legacyInventoryDigest: string;
  readonly sealedSourceSha: string;
  readonly decision: 'restored-from-head' | 'already-restored' | 'deleted-untracked-orphan';
  readonly reconciledAt: string;
}

interface RunnerPublicationRecoveryLedger {
  readonly schemaId: 'atm.runnerPublicationRecoveryLedger.v1';
  readonly taskId: string;
  readonly records: readonly RunnerPublicationReceiptReconciliation[];
}

function buildReceipt(request: PublicationRequest, snapshot: PublicationSnapshot, disposition: 'archived' | 'pending', now: string): PublicationReceipt {
  return buildRunnerPublicationReceipt({
    taskId: request.authority.taskId,
    laneSessionId: request.authority.laneSessionId,
    stewardActorId: request.authority.stewardActorId,
    sealedSourceSha: request.sealedSourceSha,
    generation: snapshot.generation,
    runnerBuildDigest: snapshot.runnerBuildDigest,
    manifestDigest: snapshot.manifestDigest,
    surfaces: request.surfaces,
    publicationCommitSha: snapshot.publicationCommitSha,
    remoteVisibility: request.remoteVisibility,
    receiptDisposition: disposition,
    issuedAt: now
  });
}

/**
 * Advance (or report) the sealed runner publication lifecycle by exactly one
 * governed phase. Fail-closed on missing queue-head ownership; idempotent on an
 * already-published generation.
 */
export function publishSealedRunner(
  request: PublicationRequest,
  snapshot: PublicationSnapshot
): PublicationDecision {
  const now = request.now ?? new Date().toISOString();
  const decide = (
    action: PublicationAction,
    phase: PublicationPhase,
    allowed: boolean,
    reason: string,
    extra?: Partial<Pick<PublicationDecision, 'errorCode' | 'idempotent' | 'receipt' | 'recoveryCommand'>>
  ): PublicationDecision => ({
    schemaId: 'atm.sealedRunnerPublicationDecision.v1',
    action,
    phase,
    allowed,
    errorCode: extra?.errorCode ?? null,
    idempotent: extra?.idempotent ?? false,
    receipt: extra?.receipt ?? null,
    recoveryCommand: extra?.recoveryCommand ?? null,
    reason
  });

  // Idempotency: this generation was already published. Return the archived
  // receipt (or instruct archival) without re-publishing.
  if (snapshot.publishedGenerations.includes(snapshot.generation)) {
    if (snapshot.archivedReceiptPath) {
      return decide('complete', 'receipt-archived', true, 'Generation already published and receipt archived; publication is idempotent (no re-publish).', {
        idempotent: true,
        receipt: buildReceipt(request, snapshot, 'archived', now)
      });
    }
    return decide('archive-receipt', 'published', true, 'Generation already published; archive the canonical receipt as the governed terminal phase.', {
      idempotent: true,
      receipt: buildReceipt(request, snapshot, 'pending', now)
    });
  }

  const enqueueRecovery = `node atm.mjs broker runner-sync enqueue --task ${request.authority.taskId} --actor ${request.authority.stewardActorId} --sealed-source-sha ${request.sealedSourceSha} --surface release/atm-onefile/atm.mjs --surface release/atm-root-drop --json`;

  switch (snapshot.phase) {
    case 'prepared':
      return decide('build', 'prepared', true, 'Private candidate preparation holds no shared queue reservation; build and seal outside the publication mutex.');
    case 'reservation': {
      return decide('build', 'reservation', true, 'Legacy reservation state is treated as queue-free candidate preparation; build and seal before requesting publication.');
    }
    case 'build-ready':
      return decide('build', 'build-ready', true, 'Build the runner from the sealed source; frozen bootstrap validates against the newly built runner, not the stale one.');
    case 'built-sealed':
      return decide('seal', 'built-sealed', true, 'Runner built and sealed; compute build/manifest digests and prepare publication.');
    case 'publication-ready':
      if (!snapshot.queueHeadOwned) {
        return decide('reserve', 'publication-ready', false, 'Queue-head ownership is required only for the final shared publication mutation.', {
          errorCode: 'ATM_RUNNER_SYNC_STEWARD_REQUIRED',
          recoveryCommand: enqueueRecovery
        });
      }
      return decide('publish', 'publication-ready', true, 'Publish the sealed runner + generated manifest onto the declared surfaces.');
    case 'published':
      return decide('archive-receipt', 'published', true, 'Publication landed; archive the canonical receipt as the governed terminal phase.', {
        receipt: buildReceipt(request, snapshot, 'pending', now)
      });
    case 'receipt-archived':
      return decide('complete', 'receipt-archived', true, 'Lifecycle complete: receipt archived and generation recorded; further calls are idempotent no-ops.', {
        idempotent: true,
        receipt: buildReceipt(request, snapshot, 'archived', now)
      });
    default: {
      const exhaustive: never = snapshot.phase;
      throw new Error(`Unhandled publication phase: ${String(exhaustive)}`);
    }
  }
}

/** The next lifecycle phase after the given one, or null at the terminal phase. */
export function nextPublicationPhase(phase: PublicationPhase): PublicationPhase | null {
  const index = PHASE_ORDER.indexOf(phase);
  return index >= 0 && index < PHASE_ORDER.length - 1 ? PHASE_ORDER[index + 1] : null;
}

/**
 * Filesystem/Git adapter for the pure BuildOutputInventory disposition rule.
 * It selects the receipt that actually names dirty runner artifacts, never an
 * unrelated task's evidence receipt.
 */
export function inspectRunnerPublicationDisposition(cwd: string, receiptRef?: string | null): RunnerPublicationInspection {
  const dirtyPaths = readDirtyPaths(cwd);
  const receipts = readRunnerReceipts(cwd);
  const requested = receiptRef ? normalizeReceiptRef(receiptRef) : null;
  // A release transition is explicitly receipt-addressed.  Do not silently
  // fall back to directory discovery when its caller supplied one: test,
  // recovery, and alternate evidence roots are all legitimate as long as the
  // reference is repository-local and the receipt validates.  Discovery is a
  // convenience only for callers that did not name a receipt.
  const selected = (requested
    ? readRunnerReceiptAtPath(cwd, requested)
    : null) ?? receipts.find((candidate) => {
    const members = new Set(candidate.inventory.entries.map((entry) => entry.path));
    return dirtyPaths.some((entry) => members.has(entry));
  }) ?? receipts[0] ?? null;
  const inventory = selected?.inventory ?? deriveRunnerBuildOutputInventory({
    sealedSourceSha: readHeadSha(cwd),
    observedPaths: []
  });
  const terminalDisposition = selected?.terminalDisposition ?? null;
  const report = evaluateRunnerPublicationDisposition({ inventory, dirtyPaths, terminalDisposition });
  const code = report.disposition === 'publication-pending'
    ? 'ATM_RUNNER_PUBLICATION_PENDING'
    : report.disposition === 'inventory-incomplete'
      ? 'ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE'
      : null;
  return {
    schemaId: 'atm.runnerPublicationInspection.v1',
    ok: report.ok,
    code,
    receiptPath: selected?.path ?? null,
    sealedSourceSha: selected?.inventory.sealedSourceSha ?? null,
    report
  };
}

function readRunnerReceiptAtPath(cwd: string, receiptRef: string): {
  readonly path: string;
  readonly inventory: RunnerBuildOutputInventory;
  readonly terminalDisposition: 'published' | 'recovery-retained' | null;
} | null {
  const absolute = path.resolve(cwd, receiptRef);
  if (!absolute.startsWith(path.resolve(cwd) + path.sep) || !existsSync(absolute)) return null;
  try {
    const document = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>;
    const validated = validateRunnerBuildOutputInventory(document.outputInventory);
    if (!validated.ok || !validated.inventory) return null;
    const disposition = document.publicationDisposition;
    return {
      path: receiptRef,
      inventory: validated.inventory,
      terminalDisposition: disposition === 'published' || disposition === 'recovery-retained' ? disposition : null
    };
  } catch {
    return null;
  }
}

/**
 * The sole controlled terminal route for one stale runner-sync receipt. It is
 * deliberately narrower than generic filesystem cleanup: it restores a named
 * receipt only when its committed predecessor verifies, or deletes an untracked
 * orphan only when the exact inventory is otherwise clean. Unrelated evidence
 * is never examined as runner output.
 */
export function reconcileReceiptOnlyRunnerPublicationResidue(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly receiptRef: string;
  readonly activeStewardWorkIds: readonly string[];
  readonly now?: string;
}): RunnerPublicationReceiptReconciliation {
  const receiptRef = normalizeReceiptRef(input.receiptRef);
  const legacyTaskId = taskIdFromRunnerReceiptPath(receiptRef);
  if (!legacyTaskId) {
    throw new Error('ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: reconciliation accepts only a repository-local runner-sync receipt path with attributable task identity.');
  }
  const absoluteReceipt = path.join(input.cwd, receiptRef);
  if (!existsSync(absoluteReceipt)) {
    throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt does not exist: ${receiptRef}.`);
  }
  const currentRaw = readFileSync(absoluteReceipt, 'utf8');
  const currentDocument = parseRunnerReceipt(currentRaw, receiptRef);
  const currentInventory = currentDocument.inventory;
  if (String(currentDocument.document.taskId ?? '') !== legacyTaskId) {
    throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt task attribution does not match ${receiptRef}.`);
  }
  const stewardWorkId = typeof currentDocument.document.stewardWorkId === 'string'
    ? currentDocument.document.stewardWorkId.trim()
    : '';
  if (!stewardWorkId) {
    throw new Error('ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt is missing stewardWorkId.');
  }
  if (input.activeStewardWorkIds.includes(stewardWorkId)) {
    throw new Error(`ATM_RUNNER_SYNC_RESUME_REQUIRED: receipt ${receiptRef} belongs to active steward work ${stewardWorkId}; publish or release it instead of reconciling.`);
  }

  const dirtyPaths = readDirtyPaths(input.cwd);
  const report = evaluateRunnerPublicationDisposition({ inventory: currentInventory, dirtyPaths });
  const dirtyInventoryPaths = report.dirtyInventoryPaths;
  if (report.extraOutputPaths.length > 0 || dirtyInventoryPaths.length !== 1 || dirtyInventoryPaths[0] !== receiptRef) {
    throw new Error(`ATM_RUNNER_PUBLICATION_PENDING: reconciliation requires ${receiptRef} to be the sole dirty inventory member and all generated outputs to be clean.`);
  }

  const dirtyBeforeDigest = digestText(currentRaw);
  const committedRaw = tryReadGitFileAtHead(input.cwd, receiptRef);
  let expectedHeadDigest: string | null = null;
  let restoredAfterDigest: string | null = null;
  let decision: RunnerPublicationReceiptReconciliation['decision'];
  let reconciledInventory = currentInventory;
  if (committedRaw === null) {
    if (!isUntrackedPath(input.cwd, receiptRef)) {
      throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: ${receiptRef} has no committed predecessor and is not an untracked orphan.`);
    }
    rmSync(absoluteReceipt);
    decision = 'deleted-untracked-orphan';
  } else {
    const committedDocument = parseRunnerReceipt(committedRaw, receiptRef);
    if (String(committedDocument.document.taskId ?? '') !== legacyTaskId) {
      throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: committed predecessor task attribution does not match ${receiptRef}.`);
    }
    expectedHeadDigest = digestText(committedRaw);
    reconciledInventory = committedDocument.inventory;
    decision = currentRaw === committedRaw ? 'already-restored' : 'restored-from-head';
    if (decision === 'restored-from-head') {
      writeFileSync(absoluteReceipt, committedRaw, 'utf8');
    }
    restoredAfterDigest = digestText(readFileSync(absoluteReceipt, 'utf8'));
  }
  const reconciliation: RunnerPublicationReceiptReconciliation = {
    schemaId: 'atm.runnerPublicationReceiptReconciliation.v1',
    taskId: input.taskId,
    actorId: input.actorId,
    legacyReceiptPath: receiptRef,
    legacyTaskId,
    expectedHeadDigest,
    dirtyBeforeDigest,
    restoredAfterDigest,
    legacyInventoryDigest: reconciledInventory.digest,
    sealedSourceSha: reconciledInventory.sealedSourceSha,
    decision,
    reconciledAt: input.now ?? new Date().toISOString()
  };
  appendRunnerPublicationRecovery(input.cwd, reconciliation);
  return reconciliation;
}

function readDirtyPaths(cwd: string): string[] {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, encoding: 'utf8' });
  if ((result.status ?? 1) !== 0) return [];
  return String(result.stdout ?? '').split(/\r?\n/)
    .map((line) => line.length >= 4 ? line.slice(3).replace(/\\/g, '/').trim() : '')
    .filter(Boolean);
}

function readHeadSha(cwd: string): string {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, encoding: 'utf8' });
  return (result.status ?? 1) === 0 ? String(result.stdout ?? '').trim() : 'unknown';
}

function readRunnerReceipts(cwd: string): Array<{
  readonly path: string;
  readonly inventory: RunnerBuildOutputInventory;
  readonly terminalDisposition: 'published' | 'recovery-retained' | null;
}> {
  const evidenceRoot = path.join(cwd, '.atm', 'history', 'evidence');
  if (!existsSync(evidenceRoot)) return [];
  return readdirSync(evidenceRoot)
    .filter((entry) => entry.endsWith('.runner-sync-receipt.json'))
    .map((entry) => path.join(evidenceRoot, entry))
    .map((absolute) => {
      try {
        const document = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>;
        const validated = validateRunnerBuildOutputInventory(document.outputInventory);
        if (!validated.ok || !validated.inventory) return null;
        const disposition = document.publicationDisposition;
        return {
          path: path.relative(cwd, absolute).replace(/\\/g, '/'),
          inventory: validated.inventory,
          terminalDisposition: disposition === 'published' || disposition === 'recovery-retained' ? disposition : null,
          mtimeMs: statSync(absolute).mtimeMs
        };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is {
      readonly path: string;
      readonly inventory: RunnerBuildOutputInventory;
      readonly terminalDisposition: 'published' | 'recovery-retained' | null;
      readonly mtimeMs: number;
    } => entry !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map(({ mtimeMs: _mtimeMs, ...entry }) => entry);
}

function normalizeReceiptRef(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => part === '..')) {
    throw new Error('ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt reference must be a repository-local path.');
  }
  return normalized;
}

function taskIdFromRunnerReceiptPath(receiptRef: string): string | null {
  // The filename is an attribution hint only. The receipt's taskId is checked
  // against this value before any recovery write, so accept every canonical
  // hyphenated work-item family instead of coupling recovery to two prefixes.
  const match = /^\.atm\/history\/evidence\/([A-Z][A-Z0-9_]*(?:-[A-Z0-9_]+)+)\.runner-sync-receipt\.json$/i.exec(receiptRef);
  return match?.[1] ?? null;
}

function parseRunnerReceipt(raw: string, receiptRef: string): { document: Record<string, unknown>; inventory: RunnerBuildOutputInventory } {
  let document: Record<string, unknown>;
  try {
    document = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt is not valid JSON: ${receiptRef}.`);
  }
  if (document.schemaId !== 'atm.runnerSyncReceipt.v1') {
    throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt schema is invalid: ${receiptRef}.`);
  }
  const validated = validateRunnerBuildOutputInventory(document.outputInventory);
  if (!validated.ok || !validated.inventory) {
    throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: receipt inventory is invalid: ${validated.reason ?? receiptRef}.`);
  }
  return { document, inventory: validated.inventory };
}

function tryReadGitFileAtHead(cwd: string, receiptRef: string): string | null {
  // `cat-file blob` has a single, machine-oriented output contract. Unlike
  // `git show`, it cannot inject commit headers or invoke text conversion.
  const result = spawnSync('git', ['cat-file', 'blob', `HEAD:${receiptRef}`], {
    cwd,
    encoding: 'utf8',
    // Runner-sync receipts enumerate release trees and routinely exceed the
    // Node default 1 MiB child-process buffer.
    maxBuffer: 16 * 1024 * 1024
  });
  if ((result.status ?? 1) !== 0) {
    return null;
  }
  return String(result.stdout ?? '');
}

function isUntrackedPath(cwd: string, receiptRef: string): boolean {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', receiptRef], { cwd, encoding: 'utf8' });
  if ((result.status ?? 1) !== 0) return false;
  return String(result.stdout ?? '').split(/\r?\n/).some((line) => line.startsWith('?? ') && line.slice(3).replace(/\\/g, '/').trim() === receiptRef);
}

function appendRunnerPublicationRecovery(cwd: string, reconciliation: RunnerPublicationReceiptReconciliation): void {
  const recoveryPath = path.join(cwd, '.atm', 'history', 'evidence', `${reconciliation.taskId}.runner-publication-recovery.json`);
  mkdirSync(path.dirname(recoveryPath), { recursive: true });
  const records = readRecoveryRecords(recoveryPath, reconciliation.taskId);
  const duplicate = records.some((record) =>
    record.legacyReceiptPath === reconciliation.legacyReceiptPath
    && record.dirtyBeforeDigest === reconciliation.dirtyBeforeDigest
    && record.decision === reconciliation.decision);
  const ledger: RunnerPublicationRecoveryLedger = {
    schemaId: 'atm.runnerPublicationRecoveryLedger.v1',
    taskId: reconciliation.taskId,
    records: duplicate ? records : [...records, reconciliation]
  };
  writeFileSync(recoveryPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

function readRecoveryRecords(recoveryPath: string, taskId: string): readonly RunnerPublicationReceiptReconciliation[] {
  if (!existsSync(recoveryPath)) return [];
  try {
    const existing = JSON.parse(readFileSync(recoveryPath, 'utf8')) as Record<string, unknown>;
    if (existing.schemaId === 'atm.runnerPublicationRecoveryLedger.v1'
      && existing.taskId === taskId
      && Array.isArray(existing.records)) {
      return existing.records as RunnerPublicationReceiptReconciliation[];
    }
    if (existing.schemaId === 'atm.runnerPublicationReceiptReconciliation.v1') {
      return [existing as unknown as RunnerPublicationReceiptReconciliation];
    }
  } catch {
    // A malformed recovery file is not a valid basis for a destructive recovery.
  }
  throw new Error(`ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE: recovery ledger is invalid for ${taskId}.`);
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
