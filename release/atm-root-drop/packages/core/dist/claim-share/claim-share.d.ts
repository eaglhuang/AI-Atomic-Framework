import { type ShareClaim } from './claim-share-store.js';
export type ClaimShareClock = () => number;
export interface ClaimShareOverlapNotice {
    readonly code: 'CLAIM_OVERLAP';
    readonly noticeId: string;
    readonly files: readonly string[];
    readonly message: string;
    readonly createdAt: string;
    readonly deliveredAt: string;
}
export interface ClaimOutcome {
    readonly code: 'CLAIM_GRANTED' | 'CLAIM_OVERLAP';
    readonly claimId: string;
    readonly actorId: string;
    readonly files: readonly string[];
    readonly overlapFiles: readonly string[];
    readonly expiresAt: string;
    readonly message: string;
}
export interface TouchOutcome {
    readonly renewedClaimIds: readonly string[];
    readonly expiredClaimIds: readonly string[];
    readonly notices: readonly ClaimShareOverlapNotice[];
}
export interface LiveWriteRecordInput {
    readonly actorId: string;
    readonly file: string;
    readonly proposalId: string;
}
export interface StewardOutcomeInput extends LiveWriteRecordInput {
    readonly decision: string;
    readonly reasonCode: string | null;
    readonly commitSha: string | null;
}
export declare function normalizeClaimFile(file: string): string;
export declare function claimOverlapMessage(files: readonly string[]): string;
/** Creates the registry, which switches the claim share layer on for this repository. */
export declare function initClaimShare(cwd: string): {
    readonly created: boolean;
};
export declare function claimFiles(input: {
    cwd: string;
    actorId: string;
    files: readonly string[];
    ttlSeconds?: number;
    now?: ClaimShareClock;
}): (ClaimOutcome & TouchOutcome) | null;
/** Per-command hook: sweep expired leases, renew the actor's lease and deliver pending overlap notices. */
export declare function touchClaimShareActor(input: {
    cwd: string;
    actorId: string;
    now?: ClaimShareClock;
}): TouchOutcome | null;
export declare function releaseClaimFiles(input: {
    cwd: string;
    actorId: string;
    files?: readonly string[] | null;
    now?: ClaimShareClock;
}): {
    readonly releasedFiles: readonly string[];
    readonly expiredClaimIds: readonly string[];
} | null;
export declare function claimShareStatus(input: {
    cwd: string;
    now?: ClaimShareClock;
}): {
    readonly claims: readonly ShareClaim[];
    readonly pendingNotices: number;
    readonly expiredClaimIds: readonly string[];
} | null;
/**
 * Before the steward applies: every write target not covered by the writer's live claim is
 * logged as `unclaimed-write` and auto-claimed (which may raise CLAIM_OVERLAP for the writer).
 */
export declare function recordUnclaimedWrites(input: {
    cwd: string;
    writes: readonly LiveWriteRecordInput[];
    ttlSeconds?: number;
    now?: ClaimShareClock;
}): {
    readonly unclaimed: readonly LiveWriteRecordInput[];
    readonly overlaps: readonly ClaimOutcome[];
} | null;
/** After the steward applies: log accept / reject and release the committed file from the writer's claim. */
export declare function recordStewardOutcomes(input: {
    cwd: string;
    writes: readonly StewardOutcomeInput[];
    now?: ClaimShareClock;
}): {
    readonly releasedFiles: readonly string[];
} | null;
