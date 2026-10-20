import type { PatchProposal } from '../broker/types.js';
import { type HunkOffset } from '../broker/unified-patch.js';
import { type CrossSessionOverlap } from './cross-session-overlap.js';
export type LiveWriteDecision = 'accepted' | 'rejected-by-design' | 'kit-error';
export type LiveWriteReasonCode = 'overlapping-write-queued' | 'stale-base' | 'patch-malformed' | 'no-op-patch' | 'patch-context-mismatch' | 'cross-session-overlap' | 'outside-scope' | 'live-write-lock-timeout' | 'live-write-commit-failed';
export interface LiveQueuedWrite {
    readonly proposalId: string;
    readonly file: string;
    readonly decision: LiveWriteDecision;
    readonly reasonCode: LiveWriteReasonCode | null;
    readonly verdict: 'applied' | 'blocked';
    readonly queued: boolean;
    readonly currentFileText: string | null;
    readonly currentFileHash: string | null;
    readonly commitSha: string | null;
    readonly hunkOffsets: readonly HunkOffset[] | null;
    readonly detail: string;
    /** #360: other sessions' committed lines this write targeted (only on `cross-session-overlap`). */
    readonly crossSessionOverlap?: readonly CrossSessionOverlap[];
    readonly instruction?: string;
    /** #360: overlapping proposals this write overrode with `--ack-overlap`. */
    readonly acknowledgedOverlap?: readonly string[];
}
export interface LiveQueuedWriteResult {
    readonly ok: boolean;
    readonly writes: readonly LiveQueuedWrite[];
    readonly queuePath: string;
    readonly planRequired: false;
}
export declare function applyLiveQueuedWrites(input: {
    readonly cwd: string;
    readonly proposals: readonly PatchProposal[];
    readonly scopeFiles?: readonly string[];
    readonly stewardId?: string;
    /** Proposal ids an explicit `--ack-overlap` overrides (#360 AC5b). */
    readonly ackOverlap?: readonly string[];
}): LiveQueuedWriteResult;
