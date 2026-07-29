import { createHash } from 'node:crypto';

/**
 * WIP ownership transition policy.
 *
 * `planWipTransition` is the single decision that owns release, handoff,
 * reclaim, and discard of in-scope dirty work-in-progress for the lane-security
 * vertical (TASK-LANE-0022). There is no duplicate WIP ownership inference
 * anywhere else: a lane's uncommitted content always has exactly one recorded
 * owner, and every transition emits an append-only ownership journal entry plus
 * an exact executable recovery command.
 *
 * The invariant it protects: a task with in-scope dirty WIP can never become
 * ownerless on release. The original authorized lane can resume its recorded
 * WIP, a sealed handoff can transfer it, and explicit discard requires a
 * destructive-action receipt. This directly closes ATM-BUG-2026-07-22-229,
 * where release followed by same-task reclaim produced unowned/foreign dirty
 * with no recovery command.
 *
 * The module is pure: the caller supplies the current ownership snapshot and
 * appends the returned journal entry to durable storage. Only fingerprints and
 * safe metadata are returned.
 */

export type WipTransitionKind = 'release' | 'handoff' | 'reclaim' | 'discard';

export type WipTransitionClass =
  | 'release-wip-retained'
  | 'release-clean'
  | 'reclaim-resume'
  | 'handoff-transfer'
  | 'discard-sealed'
  | 'blocked-foreign-wip'
  | 'blocked-unsealed-handoff'
  | 'blocked-discard-requires-receipt';

export type WipTransitionErrorCode = 'ATM_CLAIM_FOREIGN_UNSTAGED_WIP' | null;

export interface WipOwnershipSnapshot {
  readonly taskId: string;
  /** Lane currently recorded as owning the task's in-scope WIP, if any. */
  readonly ownerLaneId: string | null;
  /** In-scope dirty paths currently recorded against the owner lane. */
  readonly recordedDirtyPaths: readonly string[];
  /** Highest journal sequence number already recorded (append-only). */
  readonly journalHead: number;
}

export interface DestructiveActionReceipt {
  readonly receiptId: string;
  readonly approver: string;
  readonly taskId: string;
  readonly laneId: string;
}

export interface SealedHandoff {
  readonly handoffId: string;
  readonly fromLaneId: string;
  readonly toLaneId: string;
  readonly taskId: string;
}

export interface WipTransitionRequest {
  readonly kind: WipTransitionKind;
  readonly taskId: string;
  /** The lane requesting the transition. */
  readonly requestingLaneId: string;
  /** Attribution only. */
  readonly actorId?: string | null;
  /** In-scope dirty paths observed in the working tree for this request. */
  readonly dirtyPaths?: readonly string[];
  /** Required for a sealed handoff transfer. */
  readonly handoff?: SealedHandoff | null;
  /** Required to authorize a destructive discard. */
  readonly destructiveReceipt?: DestructiveActionReceipt | null;
  readonly now?: string;
}

export interface WipTransitionPolicy {
  /** Discard always requires a destructive-action receipt. Default true. */
  readonly requireReceiptForDiscard?: boolean;
}

export interface WipJournalEntry {
  readonly schemaId: 'atm.wipOwnershipJournalEntry.v1';
  readonly seq: number;
  readonly at: string;
  readonly kind: WipTransitionKind;
  readonly transitionClass: WipTransitionClass;
  readonly taskId: string;
  readonly requestingLaneFingerprint: string | null;
  readonly ownerLaneFingerprint: string | null;
  readonly nextOwnerLaneFingerprint: string | null;
  readonly dirtyPathCount: number;
  readonly recoveryCommand: string;
}

export interface WipTransitionPlan {
  readonly schemaId: 'atm.wipOwnershipTransitionPlan.v1';
  readonly allowed: boolean;
  readonly transitionClass: WipTransitionClass;
  readonly errorCode: WipTransitionErrorCode;
  readonly taskId: string;
  /** Lane that owns the WIP after this transition. Never null while dirty. */
  readonly nextOwnerLaneId: string | null;
  readonly nextOwnerLaneFingerprint: string | null;
  readonly ownerless: boolean;
  readonly dirtyPathCount: number;
  readonly recoveryCommand: string;
  readonly journalEntry: WipJournalEntry;
  readonly reason: string;
}

/**
 * Durable, path-bounded ownership retained after a lease is released.
 *
 * The task ledger stores this only when a release actually observes dirty WIP.
 * It lets the original lane resume that WIP without treating every historical
 * released claim as a perpetual owner.
 */
export interface RetainedWipOwnership {
  readonly schemaId: 'atm.retainedWipOwnership.v1';
  readonly taskId: string;
  readonly actorId: string;
  readonly laneSessionId: string;
  readonly dirtyPaths: readonly string[];
  readonly retainedAt: string;
  readonly transitionClass: 'release-wip-retained';
}

export function retainReleasedWipOwnership(input: {
  readonly plan: WipTransitionPlan;
  readonly actorId: string | null | undefined;
  readonly laneSessionId: string | null | undefined;
  readonly dirtyPaths: readonly string[];
}): RetainedWipOwnership | null {
  const actorId = normalize(input.actorId);
  const laneSessionId = normalize(input.laneSessionId);
  const dirtyPaths = dedupe(input.dirtyPaths);
  if (
    !input.plan.allowed
    || input.plan.transitionClass !== 'release-wip-retained'
    || !actorId
    || !laneSessionId
    || dirtyPaths.length === 0
  ) return null;
  return {
    schemaId: 'atm.retainedWipOwnership.v1',
    taskId: input.plan.taskId,
    actorId,
    laneSessionId,
    dirtyPaths,
    retainedAt: input.plan.journalEntry.at,
    transitionClass: 'release-wip-retained'
  };
}

function fingerprint(value: string | null | undefined, kind: string): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const digest = createHash('sha256').update(`${kind}\n${value}`).digest('hex').slice(0, 16);
  return `${kind}fp:${digest}`;
}

// Recovery commands are exact and executable but never embed a raw lane key.
// They reference the lane through the holder's own `$ATM_LANE_SESSION_ID`, so
// only the lane that legitimately holds the capability can run them and no
// reusable secret is disclosed in shared output.
function reclaimCommand(taskId: string): string {
  return `node atm.mjs next --claim --task ${taskId} --lane-session "$ATM_LANE_SESSION_ID" --auto-intent --json`;
}

function repairCommand(taskId: string): string {
  return `node atm.mjs tasks repair-claim --task ${taskId} --lane-session "$ATM_LANE_SESSION_ID" --write --reason "resume recorded WIP owner" --json`;
}

function handoffCommand(taskId: string, toLaneFingerprint: string | null): string {
  return `node atm.mjs tasks handoff --task ${taskId} --to-lane ${toLaneFingerprint ?? '<target-lane>'} --seal --json`;
}

function discardCommand(taskId: string): string {
  return `node atm.mjs lane wip discard --task ${taskId} --lane-session "$ATM_LANE_SESSION_ID" --receipt <destructive-action-receipt> --json`;
}

/**
 * Decide the WIP ownership transition. Fail-closed: any path that would leave
 * dirty WIP ownerless is refused with an executable recovery command instead.
 */
export function planWipTransition(
  request: WipTransitionRequest,
  snapshot: WipOwnershipSnapshot,
  policy: WipTransitionPolicy = {}
): WipTransitionPlan {
  const dirtyPaths = dedupe(request.dirtyPaths ?? snapshot.recordedDirtyPaths ?? []);
  const dirtyCount = dirtyPaths.length;
  const at = request.now ?? new Date().toISOString();
  const seq = snapshot.journalHead + 1;
  const requireReceipt = policy.requireReceiptForDiscard ?? true;

  const build = (
    allowed: boolean,
    transitionClass: WipTransitionClass,
    errorCode: WipTransitionErrorCode,
    nextOwnerLaneId: string | null,
    recoveryCommand: string,
    reason: string
  ): WipTransitionPlan => {
    const ownerless = allowed && dirtyCount > 0 && nextOwnerLaneId == null;
    const journalEntry: WipJournalEntry = {
      schemaId: 'atm.wipOwnershipJournalEntry.v1',
      seq,
      at,
      kind: request.kind,
      transitionClass,
      taskId: request.taskId,
      requestingLaneFingerprint: fingerprint(request.requestingLaneId, 'lane'),
      ownerLaneFingerprint: fingerprint(snapshot.ownerLaneId, 'lane'),
      nextOwnerLaneFingerprint: fingerprint(nextOwnerLaneId, 'lane'),
      dirtyPathCount: dirtyCount,
      recoveryCommand
    };
    return {
      schemaId: 'atm.wipOwnershipTransitionPlan.v1',
      allowed,
      transitionClass,
      errorCode,
      taskId: request.taskId,
      nextOwnerLaneId,
      nextOwnerLaneFingerprint: fingerprint(nextOwnerLaneId, 'lane'),
      ownerless,
      dirtyPathCount: dirtyCount,
      recoveryCommand,
      journalEntry,
      reason
    };
  };

  switch (request.kind) {
    case 'release': {
      if (dirtyCount === 0) {
        return build(
          true,
          'release-clean',
          null,
          null,
          reclaimCommand(request.taskId),
          'Release with no in-scope dirty WIP; nothing to own.'
        );
      }
      // Dirty WIP is retained under the releasing lane so it is never ownerless.
      // The lease is freed but ownership stays recorded and resumable.
      return build(
        true,
        'release-wip-retained',
        null,
        request.requestingLaneId,
        reclaimCommand(request.taskId),
        'Release retains in-scope dirty WIP ownership on the original lane; resume via reclaim.'
      );
    }

    case 'reclaim': {
      // Only the recorded owner lane may resume the recorded WIP. A different
      // lane reclaiming over foreign dirty is refused with a recovery command,
      // never silently adopted as ownerless/foreign. This is the
      // ATM-BUG-2026-07-22-229 fix.
      const owner = normalize(snapshot.ownerLaneId);
      if (dirtyCount > 0 && owner && owner !== request.requestingLaneId) {
        return build(
          false,
          'blocked-foreign-wip',
          'ATM_CLAIM_FOREIGN_UNSTAGED_WIP',
          owner,
          repairCommand(request.taskId),
          'Reclaim refused: in-scope dirty WIP belongs to a different recorded owner lane. Resume as that lane or seal a handoff.'
        );
      }
      return build(
        true,
        'reclaim-resume',
        null,
        dirtyCount > 0 ? request.requestingLaneId : null,
        reclaimCommand(request.taskId),
        'Reclaim resumes the recorded WIP under the original owner lane.'
      );
    }

    case 'handoff': {
      const handoff = request.handoff ?? null;
      const sealed =
        handoff != null &&
        handoff.taskId === request.taskId &&
        handoff.fromLaneId === request.requestingLaneId &&
        normalize(handoff.toLaneId) != null;
      if (!sealed) {
        return build(
          false,
          'blocked-unsealed-handoff',
          null,
          request.requestingLaneId,
          handoffCommand(request.taskId, fingerprint(handoff?.toLaneId, 'lane')),
          'Handoff refused: a sealed handoff naming this task and from-lane is required. WIP ownership stays on the original lane.'
        );
      }
      return build(
        true,
        'handoff-transfer',
        null,
        handoff.toLaneId,
        reclaimCommand(request.taskId),
        'Sealed handoff transfers in-scope WIP ownership to the target lane.'
      );
    }

    case 'discard': {
      const receipt = request.destructiveReceipt ?? null;
      const validReceipt =
        receipt != null && receipt.taskId === request.taskId && receipt.laneId === request.requestingLaneId;
      if (requireReceipt && !validReceipt) {
        return build(
          false,
          'blocked-discard-requires-receipt',
          null,
          request.requestingLaneId,
          discardCommand(request.taskId),
          'Discard refused: explicit discard of dirty WIP requires a destructive-action receipt bound to this task and lane.'
        );
      }
      return build(
        true,
        'discard-sealed',
        null,
        null,
        reclaimCommand(request.taskId),
        'Destructive-action receipt authorizes discard; recorded WIP ownership is cleared.'
      );
    }

    default: {
      const exhaustive: never = request.kind;
      throw new Error(`Unhandled WIP transition kind: ${String(exhaustive)}`);
    }
  }
}

function dedupe(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function normalize(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
