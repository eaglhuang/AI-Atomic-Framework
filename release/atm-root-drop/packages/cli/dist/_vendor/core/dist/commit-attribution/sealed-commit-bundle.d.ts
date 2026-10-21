/**
 * Sealed commit attribution contract.
 *
 * A governed commit is admitted as a set of paths, but a path is not what gets
 * committed — a `{mode, blobId}` pair is. Between the moment a bundle is
 * admitted and the moment the candidate tree is assembled, another actor
 * sharing the same worktree can replace the content behind an admitted path.
 * Path-scoped admission cannot see that substitution, so the commit ships
 * content that was never admitted while every path-level check still passes.
 *
 * This module makes the admitted content itself the transaction authority:
 * the bundle seals `{path, mode, blobId, provenance}`, and the candidate tree
 * must equal that seal exactly before any ref may move. It is deliberately
 * VCS-neutral — callers supply entries, and the Git adapter lives in the CLI
 * boundary.
 *
 * Error codes below are prefix-documented under `ATM_COMMIT_`.
 */
export declare const ATM_COMMIT_ATTRIBUTION_MISMATCH: "ATM_COMMIT_ATTRIBUTION_MISMATCH";
export declare const ATM_COMMIT_ATTRIBUTION_EMPTY_BUNDLE: "ATM_COMMIT_ATTRIBUTION_EMPTY_BUNDLE";
export declare const ATM_COMMIT_ATTRIBUTION_UNSEALED_BUNDLE: "ATM_COMMIT_ATTRIBUTION_UNSEALED_BUNDLE";
/**
 * Why an entry is allowed in the bundle. Provenance is sealed alongside the
 * content so a later reader can tell an admitted task-scope change apart from
 * governance evidence ATM staged on the actor's behalf.
 */
export type SealedCommitEntryProvenance = 'task-scope' | 'governance-evidence' | 'framework-claim' | 'shared-delivery-slice' | 'pre-staged-index';
/**
 * `present` seals content that must exist in the committed tree. `deleted` is
 * a tombstone: the path must be absent from the committed tree.
 *
 * Tombstones exist because absence cannot be sealed by omission. A staged
 * deletion has no index entry, so a bundle that only records what `ls-files`
 * returns has no way to distinguish "this path must go" from "this path is not
 * mine" — and the removal is silently dropped from the candidate tree.
 */
export type SealedCommitEntryDisposition = 'present' | 'deleted';
export interface SealedCommitBundleEntry {
    /** Repository-relative, forward-slash normalized. */
    readonly path: string;
    /** Git file mode. For a tombstone this is the pre-image mode from the base tree. */
    readonly mode: string;
    /** Content identity: a blob object id, or any digest the adapter seals. Empty for a tombstone. */
    readonly blobId: string;
    readonly provenance: SealedCommitEntryProvenance;
    /** Defaults to `present` so existing callers keep their meaning. */
    readonly disposition?: SealedCommitEntryDisposition;
}
export interface SealedCommitBundle {
    readonly schemaId: 'atm.sealedCommitBundle.v1';
    readonly specVersion: '0.1.0';
    readonly sealedAt: string;
    /** Tree the candidate is built on top of, when the adapter knows it. */
    readonly baseTreeSha: string | null;
    readonly entries: readonly SealedCommitBundleEntry[];
}
export type CommitAttributionFindingKind = 'missing-path' | 'unexpected-path' | 'mode-mismatch' | 'content-mismatch'
/** A tombstoned path is still present in the candidate tree. */
 | 'undeleted-path'
/**
 * One path is claimed by two different provenances inside a single seal.
 * Content equality is not enough here: an overlay that re-declares an
 * admitted task-scope path as governance evidence relabels who is
 * accountable for it, and a later reader can no longer tell the admitted
 * change apart from what ATM staged on the actor's behalf.
 */
 | 'provenance-mismatch';
export interface CommitAttributionFinding {
    readonly kind: CommitAttributionFindingKind;
    readonly path: string;
    readonly sealedMode: string | null;
    readonly actualMode: string | null;
    readonly sealedBlobId: string | null;
    readonly actualBlobId: string | null;
    /** Only carried by `provenance-mismatch`, where the conflict is the label. */
    readonly sealedProvenance?: SealedCommitEntryProvenance | null;
    readonly conflictingProvenance?: SealedCommitEntryProvenance | null;
}
export interface CommitAttributionProof {
    readonly schemaId: 'atm.commitAttributionProof.v1';
    readonly specVersion: '0.1.0';
    readonly ok: boolean;
    readonly code: typeof ATM_COMMIT_ATTRIBUTION_MISMATCH | null;
    readonly sealedEntryCount: number;
    readonly actualEntryCount: number;
    readonly matchedEntryCount: number;
    readonly findings: readonly CommitAttributionFinding[];
    readonly summary: string;
}
export interface CommitTreeEntry {
    readonly path: string;
    readonly mode: string;
    readonly blobId: string;
    /**
     * `deleted` when the observed tree removes the path. Adapters that only
     * report present entries may omit this.
     */
    readonly disposition?: SealedCommitEntryDisposition;
}
export declare function isTombstone(entry: SealedCommitBundleEntry): boolean;
export declare function sealCommitBundle(input: {
    readonly entries: readonly SealedCommitBundleEntry[];
    readonly baseTreeSha?: string | null;
    readonly sealedAt?: string | null;
}): SealedCommitBundle;
/**
 * Duplicate declarations of one path that disagree about provenance.
 *
 * `sealCommitBundle` resolves duplicates by last-declaration-wins so an overlay
 * can supersede an earlier entry, which is safe only while both declarations
 * agree about who admitted the path. When they do not, the surviving entry
 * silently carries the wrong accountability, so the seal has to be refused
 * before it is ever compared against a tree.
 */
export declare function findSealedBundleProvenanceConflicts(entries: readonly SealedCommitBundleEntry[]): readonly CommitAttributionFinding[];
/**
 * Exact-match assertion. The candidate tree diff must equal the sealed bundle
 * at path, mode and content granularity — a missing path, an extra path, or a
 * same-path different-blob substitution are all failures. There is no
 * "close enough" verdict: the caller either has the admitted content or it
 * must not move a ref.
 */
export declare function compareCommitTreeToSealedBundle(input: {
    readonly sealed: SealedCommitBundle;
    readonly actual: readonly CommitTreeEntry[];
}): CommitAttributionProof;
/**
 * An empty bundle is not a permission to commit whatever the shared index
 * happens to hold. Callers must resolve emptiness explicitly before assembly.
 */
export declare function assertSealedBundleNotEmpty(bundle: SealedCommitBundle): void;
