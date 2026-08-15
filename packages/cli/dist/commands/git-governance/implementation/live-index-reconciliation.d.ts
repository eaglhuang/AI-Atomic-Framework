/**
 * Reconcile the live shared index after a task-scoped commit moved HEAD through
 * a sealed candidate index.
 *
 * The candidate index intentionally isolates the commit from unrelated staged
 * work. That also means Git cannot advance the live index automatically. This
 * module restores the missing postcondition without treating the whole index as
 * owned by the committer: a path is advanced to the new HEAD only when its live
 * index entry still equals the pre-commit snapshot and its worktree bytes equal
 * the committed tree. Concurrent index or worktree changes are retained.
 *
 * The transaction boundary lives here rather than in the caller. Whether a
 * commit returned or threw, the only question that decides reconciliation is
 * whether HEAD actually advanced, and answering it in one place is what keeps
 * `try`/`finally`, HEAD comparison, and Git invocation details out of every
 * commit surface. The boundary also refuses to convert a reconciliation problem
 * into a commit failure: a commit that landed is reported as landed, and any
 * reconciliation trouble is reported as a diagnosable field beside it.
 *
 * Path lists reach this module already sized by a commit bundle, which for a
 * release-style commit means hundreds of entries. Every Git invocation here is
 * therefore batched against a platform argv budget; see `pathspec-argv-batching`
 * for why the stdin pathspec route is not an option in this repository.
 */
export declare const LIVE_INDEX_RECONCILIATION_SCHEMA_ID = "atm.liveIndexReconciliation.v1";
type Entry = {
    readonly mode: string;
    readonly blobId: string;
} | null;
export type LiveIndexRetentionReason = 'concurrent-index-change' | 'worktree-diverged';
export interface LiveIndexSnapshot {
    readonly paths: readonly string[];
    readonly entries: Readonly<Record<string, Entry>>;
}
export interface LiveIndexRetainedPath {
    readonly path: string;
    readonly reason: LiveIndexRetentionReason;
}
/**
 * The small stable result a governed commit reports.
 *
 * It answers three operator questions and nothing else: did this transaction
 * have anything to reconcile, which paths were left alone and why, and can the
 * index be treated as clean. The underlying snapshot, temporary indexes, and
 * batching plans stay inside this module.
 */
export interface LiveIndexReconciliation {
    readonly schemaId: typeof LIVE_INDEX_RECONCILIATION_SCHEMA_ID;
    /** False when the commit never landed, which is the only no-op case. */
    readonly headAdvanced: boolean;
    readonly reconciledPaths: readonly string[];
    readonly retainedPaths: readonly LiveIndexRetainedPath[];
    /** True only when nothing was retained and nothing failed. */
    readonly clean: boolean;
    readonly failure: {
        readonly code: string;
        readonly message: string;
    } | null;
}
interface BudgetOptions {
    readonly budgetBytes?: number;
}
/** The commit HEAD points at, or null in a repository with no commits yet. */
export declare function readHeadCommit(cwd: string): string | null;
export declare function captureLiveIndexSnapshot(cwd: string, pathsInput: readonly string[], options?: BudgetOptions): LiveIndexSnapshot;
export declare function reconcileCommittedPathsInLiveIndex(input: {
    readonly cwd: string;
    readonly snapshot: LiveIndexSnapshot;
    readonly budgetBytes?: number;
}): {
    readonly reconciledPaths: readonly string[];
    readonly retainedPaths: readonly LiveIndexRetainedPath[];
};
/**
 * The transaction boundary: reconcile if and only if the commit attempt moved
 * HEAD, and never throw.
 *
 * Both outcomes of a commit attempt reach this function, so it cannot signal by
 * throwing without changing what a commit failure means. A commit that landed
 * and then failed downstream must still surface the downstream error, and a
 * reconciliation that fails on top of that must not replace it. Trouble is
 * therefore returned as `failure`, which also drives `clean` to false so no
 * caller can read a half-reconciled index as a clean one.
 */
export declare function reconcileLiveIndexAfterCommitAttempt(input: {
    readonly cwd: string;
    readonly snapshot: LiveIndexSnapshot;
    readonly headBefore: string | null;
    readonly budgetBytes?: number;
}): LiveIndexReconciliation;
/**
 * Persist a reconciliation that did not finish cleanly.
 *
 * A clean reconciliation needs no record: the index matches HEAD and there is
 * nothing for an operator to act on. A retained path or a reconciliation
 * failure is the opposite — the commit itself succeeded, so nothing else in the
 * run will look wrong, and without a durable record the leftover staged entry
 * reads as unexplained residue that invites exactly the manual index edit this
 * governance forbids.
 */
export declare function recordLiveIndexReconciliation(cwd: string, taskId: string | null | undefined, reconciliation: LiveIndexReconciliation): string | null;
/**
 * Carry a reconciliation report on an error without altering the error itself.
 *
 * A commit failure has to propagate exactly as thrown — its type, message, and
 * code are what callers gate on — while the operator still needs to know what
 * happened to the index underneath it. A symbol-keyed, non-enumerable property
 * adds the second fact without disturbing the first.
 */
export declare function attachLiveIndexReconciliation<E>(error: E, reconciliation: LiveIndexReconciliation): E;
export declare function readLiveIndexReconciliationFromError(error: unknown): LiveIndexReconciliation | null;
export {};
