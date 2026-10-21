import type { PatchProposal } from '../broker/types.js';
import { type HunkOffset } from '../broker/unified-patch.js';
export type LiveWriteDecision = 'accepted' | 'rejected-by-design' | 'kit-error';
export type LiveWriteReasonCode = 'overlapping-write-queued' | 'stale-base' | 'patch-malformed' | 'no-op-patch' | 'patch-context-mismatch' | 'outside-scope' | 'live-write-lock-timeout' | 'live-write-commit-failed';
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
}): LiveQueuedWriteResult;
