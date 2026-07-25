import { createHash } from 'node:crypto';

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
