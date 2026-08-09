import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  deriveRunnerBuildOutputInventory,
  evaluateRunnerPublicationDisposition,
  validateRunnerBuildOutputInventory,
  type RunnerBuildOutputInventory,
  type RunnerPublicationDispositionReport
} from '../../../../core/src/broker/runner-build-output-inventory.ts';

/**
 * Sealed runner publication lifecycle.
 *
 * `publishSealedRunner` owns the durable state machine
 *   reservation -> build-ready -> built-sealed -> publication-ready
 *   -> published -> receipt-archived
 * and returns one canonical publication receipt. Taskflow close and internal
 * release consume the same lifecycle, so a successful normal task never needs a
 * later framework-temp hygiene conversation, native pathspec, manual receipt
 * archival, or manual release-artifact commit.
 *
 * Receipt archival is a governed terminal phase, not untracked advisory
 * residue. Repeated publication/reconcile calls are idempotent and never
 * publish the same generation twice. The module is pure: the caller supplies
 * the current lifecycle snapshot and executes the returned next action through
 * ports.
 */

export type PublicationPhase =
  | 'reservation'
  | 'build-ready'
  | 'built-sealed'
  | 'publication-ready'
  | 'published'
  | 'receipt-archived';

const PHASE_ORDER: readonly PublicationPhase[] = [
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
  /** Generation of the authority window this publication is bound to. */
  readonly generation: number;
  /** Digest of the built+sealed runner, once built. */
  readonly runnerBuildDigest: string | null;
  /** Generated release manifest digest, once built. */
  readonly manifestDigest: string | null;
  /** Publication commit sha, once published. */
  readonly publicationCommitSha: string | null;
  /** Generations already published (idempotency ledger). */
  readonly publishedGenerations: readonly number[];
  /** Path of an already-archived receipt for this generation, if any. */
  readonly archivedReceiptPath: string | null;
  /** Queue-head ownership for the sealed source (gate before build/publish). */
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

function fingerprint(value: string | null | undefined, kind: string): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return `${kind}fp:${createHash('sha256').update(`${kind}\n${value}`).digest('hex').slice(0, 16)}`;
}

function buildReceipt(request: PublicationRequest, snapshot: PublicationSnapshot, disposition: 'archived' | 'pending', now: string): PublicationReceipt {
  const surfaces = [...new Set(request.surfaces.map((s) => s.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const core = {
    schemaId: 'atm.sealedRunnerPublicationReceipt.v1' as const,
    taskId: request.authority.taskId,
    laneFingerprint: fingerprint(request.authority.laneSessionId, 'lane'),
    stewardActorId: request.authority.stewardActorId,
    sealedSourceSha: request.sealedSourceSha,
    generation: snapshot.generation,
    runnerBuildDigest: snapshot.runnerBuildDigest,
    manifestDigest: snapshot.manifestDigest,
    surfaces,
    publicationCommitSha: snapshot.publicationCommitSha,
    remoteVisibility: request.remoteVisibility,
    receiptDisposition: disposition,
    issuedAt: now
  };
  const receiptDigest = `sha256:${createHash('sha256').update(JSON.stringify(core)).digest('hex')}`;
  return { ...core, receiptDigest };
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
    case 'reservation': {
      // Queue-head ownership is mandatory before any build/publish.
      if (!snapshot.queueHeadOwned) {
        return decide('reserve', 'reservation', false, 'Runner-sync steward queue-head reservation is required before build or publication.', {
          errorCode: 'ATM_RUNNER_SYNC_STEWARD_REQUIRED',
          recoveryCommand: enqueueRecovery
        });
      }
      return decide('build', 'reservation', true, 'Reservation held; proceed to the sealed build from committed source.');
    }
    case 'build-ready':
      return decide('build', 'build-ready', true, 'Build the runner from the sealed source; frozen bootstrap validates against the newly built runner, not the stale one.');
    case 'built-sealed':
      return decide('seal', 'built-sealed', true, 'Runner built and sealed; compute build/manifest digests and prepare publication.');
    case 'publication-ready':
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
  const selected = (requested
    ? receipts.find((candidate) => candidate.path === requested)
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
