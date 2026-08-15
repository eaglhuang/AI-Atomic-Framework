/**
 * Git adapter for the sealed commit attribution contract.
 *
 * The pure policy lives in `packages/core/src/commit-attribution`. This module
 * is the only place that turns Git index/tree state into sealed entries and
 * back, so the transaction rule stays enforceable without spreading Git
 * plumbing through the commit orchestration.
 *
 * The ordering rule this module exists to hold: seal the admitted content
 * first, assemble the candidate tree *from the seal* rather than from the
 * mutable live index, and prove the candidate equals the seal before anything
 * moves a ref.
 */
import { type CommitAttributionProof, type CommitTreeEntry, type SealedCommitBundle, type SealedCommitEntryProvenance } from '../../../../../core/src/commit-attribution/sealed-commit-bundle.ts';
import { type LiveIndexReconciliation } from './live-index-reconciliation.ts';
/**
 * Seal the admitted paths against the live index exactly once. Every later
 * step reads this snapshot instead of the index, which is what closes the
 * substitution window between admission and assembly.
 */
export declare function sealCommitBundleFromLiveIndex(input: {
    readonly cwd: string;
    readonly paths: readonly string[];
    readonly provenance: SealedCommitEntryProvenance;
    readonly baseTreeSha?: string | null;
    readonly baseRef?: string | null;
}): SealedCommitBundle;
/**
 * Seal an explicit task-owned worktree overlay without touching the shared
 * index.  Auto-stage admission uses this so a stale shared-index entry cannot
 * turn a present protected artifact into a tombstone before the transaction
 * gets its isolated candidate index.
 */
export declare function withWorktreeCandidateIndex<T>(input: {
    readonly cwd: string;
    readonly paths: readonly string[];
    readonly run: (env: NodeJS.ProcessEnv) => T;
}): T;
/**
 * Merge overlay entries (governance evidence) onto an already sealed bundle.
 *
 * Composition is where accountability can be quietly rewritten: the overlay
 * wins on duplicate paths, so an entry that re-declares an admitted path under
 * a different provenance would leave the seal describing the right content and
 * the wrong author. Supersession is therefore allowed only for the paths the
 * caller declares it staged in this transaction; every other cross-provenance
 * re-declaration is a named finding and fails closed.
 */
export declare function mergeSealedCommitBundles(base: SealedCommitBundle, overlay: SealedCommitBundle, options?: {
    readonly supersedingPaths?: readonly string[];
    readonly surface?: string;
}): SealedCommitBundle;
/**
 * Build the candidate index from sealed content only. `update-index
 * --cacheinfo` writes the sealed `{mode, blobId}` directly, so a concurrent
 * worktree or index mutation on the same path cannot leak into the candidate.
 */
export declare function assembleSealedCommitIndex(input: {
    readonly cwd: string;
    readonly bundle: SealedCommitBundle;
    readonly env: NodeJS.ProcessEnv;
    readonly baseRef?: string;
}): void;
/**
 * What the candidate index will actually commit, expressed so it can be
 * compared to a seal.
 *
 * Two sources are needed. A sealed path whose content already matches the base
 * tree produces no diff entry at all, so the index itself is the authority for
 * sealed paths. Anything that appears in the diff without being sealed is an
 * intruder, and only the diff can reveal it — the index is full of base-tree
 * entries that are not part of this commit.
 */
export declare function readCandidateTreeEntries(input: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly baseRef?: string;
    readonly sealedPaths?: readonly string[];
}): readonly CommitTreeEntry[];
/**
 * Post-image entries recorded by an existing commit, projected to the sealed
 * paths plus any changed intruders. A diff alone cannot represent a sealed
 * path inherited unchanged from the parent; the committed tree is therefore
 * authoritative for sealed paths, while the diff remains authoritative for
 * unsealed additions, modifications, and deletions.
 */
export declare function readCommittedTreeEntries(cwd: string, commitSha: string, sealedPaths?: readonly string[]): readonly CommitTreeEntry[];
export declare function proveCommitAttribution(input: {
    readonly sealed: SealedCommitBundle;
    readonly actual: readonly CommitTreeEntry[];
}): CommitAttributionProof;
/**
 * Fail closed before a ref moves. This is intentionally a hard error rather
 * than a diagnostic: an unexplained entry in the candidate tree means the
 * commit would attribute someone else's content to this actor.
 */
export declare function assertCommitAttribution(input: {
    readonly sealed: SealedCommitBundle;
    readonly actual: readonly CommitTreeEntry[];
    readonly surface: string;
    readonly actorId?: string | null;
    readonly taskId?: string | null;
}): CommitAttributionProof;
export interface SealedCommitIndexOutcome<T> {
    readonly result: T;
    readonly bundle: SealedCommitBundle;
    readonly proof: CommitAttributionProof;
    /** Which named route produced the seal this transaction was proved against. */
    readonly sealSource: SealedCommitSealSource['kind'];
    /** Non-null only on the diagnostic route, and carried into the receipt. */
    readonly liveIndexSealDiagnostic: {
        readonly reason: string;
    } | null;
    /** Task paths advanced to the new HEAD without overwriting concurrent bytes. */
    readonly liveIndexReconciliation: LiveIndexReconciliation;
}
/**
 * Where the seal came from. There is deliberately no "unset" case: sealing the
 * live index is a decision, not a default. A governed commit passes the bundle
 * it admitted; the diagnostic route exists for probes and tests that have no
 * prior admission, and it has to say why in a string that reaches the outcome.
 */
export type SealedCommitSealSource = {
    readonly kind: 'sealed-bundle';
    readonly bundle: SealedCommitBundle;
} | {
    readonly kind: 'live-index-diagnostic';
    readonly reason: string;
};
/**
 * Resolve the seal a governed commit will be proved against.
 *
 * Both governed branches seal explicitly: a resolved task-scope bundle is
 * reused as admitted, and a commit that has only a pre-staged index seals that
 * index here, under its own provenance, rather than letting the transaction
 * discover an unsealed state later and improvise.
 */
export declare function resolveGovernedCommitSeal(input: {
    readonly cwd: string;
    readonly admittedBundle?: SealedCommitBundle | null;
    readonly paths: readonly string[];
    readonly provenance: SealedCommitEntryProvenance;
}): SealedCommitSealSource;
/**
 * Run `run` against a candidate index that provably contains the sealed bundle
 * and nothing else.
 *
 * Governance evidence ATM itself writes during the transaction is folded into
 * the seal through `stageGovernanceEvidence`, which reports the exact paths it
 * added. That keeps the seal honest — content authored by this transaction is
 * admitted, content authored concurrently by anyone else is not — without
 * degrading the assertion into "accept whatever ended up in the index".
 */
export declare function runWithSealedTaskScopedCommitIndex<T>(input: {
    readonly cwd: string;
    readonly paths: readonly string[];
    readonly provenance: SealedCommitEntryProvenance;
    readonly actorId?: string | null;
    readonly taskId?: string | null;
    readonly surface: string;
    readonly stageGovernanceEvidence?: (env: NodeJS.ProcessEnv) => readonly string[];
    /**
     * Where the seal comes from. Governed callers resolve and admit their bundle
     * before reaching the commit step and pass it here, so the content admitted
     * is the content committed even if the live index changed in between. There
     * is no implicit fallback: a caller with no bundle has to ask for the named
     * diagnostic route and say why.
     */
    readonly sealSource: SealedCommitSealSource;
    readonly run: (env: NodeJS.ProcessEnv) => T;
}): SealedCommitIndexOutcome<T>;
/** Seal specific paths from an already-assembled candidate index. */
export declare function sealCommitBundleFromCandidateIndex(input: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly paths: readonly string[];
}): SealedCommitBundle;
