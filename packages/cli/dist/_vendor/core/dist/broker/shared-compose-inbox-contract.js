// Frozen numbers for the shared compose inbox. Behavior reads these fields
// instead of scattering the prereg limits through control flow.
// Source of the limits: research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/
// (R2-D2, R2-D3, R4-D2, R4-D3, R6-D2). That directory stays read-only.
export const SHARED_COMPOSE_CONTRACT = Object.freeze({
    schemaId: 'atm.sharedComposeInbox.v1',
    policyVersion: 'atm.sharedComposeInbox.v1',
    /** 0 keeps one proposal per batch. A window opens only when this is set. */
    defaultComposeWindowMs: 0,
    defaultDeadlineMs: 30_000,
    /** Retries after the first submit. Attempt 0 plus these retries is 9 attempts. */
    maxRetriesAfterFirstSubmit: 8,
    maxAttempts: 9,
    defaultMaxBatchSize: 32,
    /**
     * Exhaustive git merge-file order proof is n*2^(n-1) process spawns.
     * Subsets larger than this are not treated as proven, so the coordinator
     * will not accept them.
     */
    legalProofMaxMembers: 8,
    defaultComposingStaleMs: 2_000,
    lockWaitMs: 5_000
});
export function compareProposalId(left, right) {
    if (left < right)
        return -1;
    if (left > right)
        return 1;
    return 0;
}
export function setKey(proposalIds) {
    return [...new Set(proposalIds)].sort(compareProposalId);
}
export function appendProposalStage(stages, stage) {
    return stages.includes(stage) ? [...stages] : [...stages, stage];
}
