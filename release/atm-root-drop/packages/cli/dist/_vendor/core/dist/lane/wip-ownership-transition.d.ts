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
export type WipTransitionClass = 'release-wip-retained' | 'release-clean' | 'reclaim-resume' | 'handoff-transfer' | 'discard-sealed' | 'blocked-foreign-wip' | 'blocked-unsealed-handoff' | 'blocked-discard-requires-receipt';
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
export declare function retainReleasedWipOwnership(input: {
    readonly plan: WipTransitionPlan;
    readonly actorId: string | null | undefined;
    readonly laneSessionId: string | null | undefined;
    readonly dirtyPaths: readonly string[];
}): RetainedWipOwnership | null;
/**
 * Decide the WIP ownership transition. Fail-closed: any path that would leave
 * dirty WIP ownerless is refused with an executable recovery command instead.
 */
export declare function planWipTransition(request: WipTransitionRequest, snapshot: WipOwnershipSnapshot, policy?: WipTransitionPolicy): WipTransitionPlan;
