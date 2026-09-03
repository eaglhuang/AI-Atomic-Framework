import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildRunnerPublicationReceipt } from './runner-publication-receipt.ts';
import {
  normalizeRunnerPublicationReceiptRef as normalizeReceiptRef,
  readPublishedRunnerSealedSourceSha,
  readRunnerPublicationDirtyPaths as readDirtyPaths,
  readRunnerPublicationHeadSha as readHeadSha,
  readRunnerPublicationReceiptAtPath,
  readRunnerPublicationReceipts as readRunnerReceipts,
  reconcileReceiptOnlyRunnerPublicationResidue
} from './runner-publication-residue.ts';
export { reconcileReceiptOnlyRunnerPublicationResidue } from './runner-publication-residue.ts';
export type { RunnerPublicationReceiptReconciliation } from './runner-publication-residue.ts';
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
  // Authority is checked above; the takeover plan must describe the physical dirty surface seen by the publisher.
  const snapshot = captureRunnerBuildOutputSnapshot({ cwd: input.cwd, buildTarget: input.buildTarget, currentTaskId: null, currentTaskAllowedFiles: [] });
  const plan = planRunnerPublicationTakeover({ sealedSourceSha: input.sealedSourceSha, snapshot });
  if (plan.entries.length === 0) throw new Error('ATM_RUNNER_PUBLICATION_PENDING: takeover requires at least one pre-existing generated publication member.');
  const receiptPath = path.join(input.cwd, '.atm', 'history', 'evidence', `${input.taskId}.runner-publication-takeover.json`);
  // The plan digest remains provider-neutral, while the persisted evidence
  // carries semantic task identity required by protected-state consumers.
  // A filename is never authority.
  writeFileSync(receiptPath, `${JSON.stringify({ ...plan, taskId: input.taskId }, null, 2)}\n`, 'utf8');
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
  const publishedSealedSourceSha = readPublishedRunnerSealedSourceSha(cwd);
  // A release transition is explicitly receipt-addressed.  Do not silently
  // fall back to directory discovery when its caller supplied one: test,
  // recovery, and alternate evidence roots are all legitimate as long as the
  // reference is repository-local and the receipt validates.  Discovery is a
  // convenience only for callers that did not name a receipt.
  const selected = (requested
    ? readRunnerPublicationReceiptAtPath(cwd, requested)
    : null) ?? receipts.find((candidate) => {
    // A historical receipt can name the same generated output as the current
    // runner.  Once the release manifest binds that runner to a sealed source,
    // path overlap alone is not authority to select older evidence.
    if (publishedSealedSourceSha !== null && candidate.inventory.sealedSourceSha !== publishedSealedSourceSha) {
      return false;
    }
    const members = new Set(candidate.inventory.entries.map((entry) => entry.path));
    return dirtyPaths.some((entry) => members.has(entry));
  }) ?? null;
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
