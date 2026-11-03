/**
 * VCS-neutral commit-candidate isolation (ATM-GOV-0261).
 *
 * ATM core owns commit isolation as a durable, repository-agnostic envelope.
 * Git pathspec / `git commit --only` / temporary-index tricks are only one
 * repository adapter's final write operation; they must never become ATM's
 * authority model. Nothing in this module imports or assumes Git.
 */
/**
 * Exact ErrorCodes for the commit-candidate lane. `ATM_GIT_PATHSPEC_*` is
 * prefix-documented under `ATM_GIT_`; the `ATM_COMMIT_CANDIDATE_*` family is
 * owned by ATM-GOV-0261. Adapters re-export these; never mint parallels.
 */
export declare const ATM_COMMIT_CANDIDATE_CONFLICT: "ATM_COMMIT_CANDIDATE_CONFLICT";
export declare const ATM_COMMIT_CANDIDATE_STALE_BASE: "ATM_COMMIT_CANDIDATE_STALE_BASE";
export declare const ATM_COMMIT_CANDIDATE_ADAPTER_REQUIRED: "ATM_COMMIT_CANDIDATE_ADAPTER_REQUIRED";
export declare const ATM_GIT_PATHSPEC_FALLBACK_REQUIRES_EMERGENCY: "ATM_GIT_PATHSPEC_FALLBACK_REQUIRES_EMERGENCY";
export declare const ATM_COMMIT_CANDIDATE_INDEX_RESIDUE_BLOCKED: "ATM_COMMIT_CANDIDATE_INDEX_RESIDUE_BLOCKED";
export type CommitCandidateCode = typeof ATM_COMMIT_CANDIDATE_CONFLICT | typeof ATM_COMMIT_CANDIDATE_STALE_BASE | typeof ATM_COMMIT_CANDIDATE_ADAPTER_REQUIRED | typeof ATM_GIT_PATHSPEC_FALLBACK_REQUIRES_EMERGENCY | typeof ATM_COMMIT_CANDIDATE_INDEX_RESIDUE_BLOCKED;
export declare const COMMIT_CANDIDATE_SCHEMA_ID: "atm.commitCandidate.v1";
/** One file the candidate intends to persist, with its exact content digest. */
export interface CommitCandidateFile {
    readonly path: string;
    readonly contentDigest: string;
    readonly changeKind: 'add' | 'modify' | 'delete';
}
/**
 * VCS-neutral commit candidate. Carries everything a repository adapter needs
 * to persist the change, plus everything the broker/steward needs to admit it,
 * without referencing any Git-specific concept.
 */
export interface CommitCandidate {
    readonly schemaId: typeof COMMIT_CANDIDATE_SCHEMA_ID;
    readonly candidateId: string;
    readonly actorId: string;
    /** Governed task id, or a framework-temp id; one of them must be present. */
    readonly taskId: string | null;
    readonly frameworkTempId: string | null;
    readonly laneSessionId: string | null;
    readonly leaseId: string | null;
    /** Seal of the base the candidate was authored against (base/HEAD CAS). */
    readonly baseSeal: string;
    readonly files: readonly CommitCandidateFile[];
    /** Broker keyspace resource keys this candidate writes (atoms/files/etc.). */
    readonly allowedResourceKeys: readonly string[];
    readonly validationPlan: readonly string[];
    readonly evidenceRefs: readonly string[];
    readonly expectedTrailers: Readonly<Record<string, string>>;
    /** Which repository adapter persists this candidate (e.g. 'local-git'). */
    readonly adapterTarget: string | null;
    readonly composeEligible: boolean;
    readonly createdAt: string;
}
export type CommitCandidateVerdict = 'execute-now' | 'queued' | 'compose-eligible' | 'revalidation-required' | 'stale-base' | 'adapter-required' | 'blocked';
export interface CommitCandidateAdmissionContext {
    /** Current base seal of the canonical worktree (CAS check target). */
    readonly currentBaseSeal: string;
    /**
     * Other live candidates ahead of this one in the broker keyspace, ordered by
     * queue position. This is the SAME keyspace as git-index/branch-commit/
     * runner-sync writes — there is no second queue.
     */
    readonly aheadCandidates: readonly CommitCandidateQueueMember[];
    /** Whether the target repository adapter has been resolved and is ready. */
    readonly adapterResolved: boolean;
    /**
     * Physical index/worktree residue: staged or dirty resource keys NOT owned by
     * this candidate. Their mere presence never blocks (isolation is the point);
     * they only block if the adapter would consume them into the persisted set.
     */
    readonly unrelatedIndexResidue?: readonly string[];
    /** True when the adapter cannot isolate and would consume the residue. */
    readonly adapterWouldConsumeResidue?: boolean;
    /** True when the base advanced but this candidate can be revalidated in place. */
    readonly revalidatable?: boolean;
}
export interface CommitCandidateQueueMember {
    readonly candidateId: string;
    readonly allowedResourceKeys: readonly string[];
    readonly composeEligible: boolean;
}
export interface CommitCandidateAdmissionDecision {
    readonly schemaId: 'atm.commitCandidateAdmission.v1';
    readonly candidateId: string;
    readonly verdict: CommitCandidateVerdict;
    readonly code: CommitCandidateCode | null;
    readonly ok: boolean;
    readonly conflictingCandidateIds: readonly string[];
    readonly reasons: readonly string[];
    readonly recoveryCommand: string | null;
}
/**
 * Pure admission for a commit candidate. Returns exactly one verdict and, on a
 * blocking verdict, an exact recovery command. A bare refusal is never emitted
 * (INV-ATM-008): every blocked state names its resolution path.
 */
export declare function admitCommitCandidate(candidate: CommitCandidate, context: CommitCandidateAdmissionContext): CommitCandidateAdmissionDecision;
/**
 * Classify a direct native pathspec / `--only` commit. Outside the admitted
 * adapter path, this is emergency-only and must carry an emergency approval.
 */
export declare function classifyPathspecFallback(input: {
    readonly candidateAdmitted: boolean;
    readonly invokedByGitAdapter: boolean;
    readonly emergencyApprovalPresent: boolean;
}): CommitCandidateAdmissionDecision;
/** Build a well-formed candidate, filling schema id and stable ordering. */
export declare function buildCommitCandidate(input: Omit<CommitCandidate, 'schemaId'>): CommitCandidate;
