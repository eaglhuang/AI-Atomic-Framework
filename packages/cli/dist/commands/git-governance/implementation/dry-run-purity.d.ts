type CommitRequest = ReturnType<typeof JSON.parse>;
/**
 * Decide purity from the request, before authority resolution picks a branch.
 *
 * A pure request may observe and report, but may not change HEAD, the index,
 * the worktree, the ledger, lease consumption, receipts, or artifacts. Only the
 * boolean flag grants purity: a truthy string is a caller error, not consent.
 */
export declare function resolveDryRunPurity(request: CommitRequest): boolean;
/**
 * The last line of the contract, asserted at the single executor call site.
 *
 * Arriving here while pure means every branch declined to preview and the
 * request fell through to execution. Fail closed and name the authority that
 * was missing: an operator who asked to look must never be silently upgraded
 * into having acted, and must not be handed an empty success either, which
 * reads the same as a preview that found nothing to do.
 */
export declare function assertDryRunReachedNoExecutor(dryRunPurity: boolean, context: {
    readonly taskId: string | null;
    readonly usesFrameworkClaimCommit: boolean;
}): void;
export {};
