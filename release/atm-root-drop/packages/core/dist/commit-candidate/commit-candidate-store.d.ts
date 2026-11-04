/**
 * VCS-neutral commit-candidate store and repository adapter boundary
 * (ATM-GOV-0261).
 *
 * The store holds admitted/pending candidates without touching any repository
 * index. A RepositoryCommitAdapter is the only thing that translates an
 * admitted candidate into the host's final persistence mechanism. ATM core
 * tests can run entirely against the in-memory store + a fake adapter, proving
 * the isolation model does not depend on Git.
 */
import { type CommitCandidate, type CommitCandidateAdmissionDecision } from './commit-candidate.js';
export interface CommitCandidateStore {
    submit(candidate: CommitCandidate): void;
    get(candidateId: string): CommitCandidate | null;
    list(): readonly CommitCandidate[];
    supersede(candidateId: string, replacement: CommitCandidate): void;
    remove(candidateId: string): void;
}
/**
 * In-memory candidate store. Submission never mutates any physical index, so
 * two disjoint candidates can coexist while the real worktree holds unrelated
 * staged or dirty files.
 */
export declare class InMemoryCommitCandidateStore implements CommitCandidateStore {
    private readonly order;
    private readonly byId;
    submit(candidate: CommitCandidate): void;
    get(candidateId: string): CommitCandidate | null;
    list(): readonly CommitCandidate[];
    supersede(candidateId: string, replacement: CommitCandidate): void;
    remove(candidateId: string): void;
}
/** Evidence the adapter emits so pathspec is recorded as an operation, not authority. */
export interface RepositoryAdapterCommitEvidence {
    readonly schemaId: 'atm.repositoryAdapterCommit.v1';
    readonly adapterTarget: string;
    readonly candidateId: string;
    /** Adapter-specific operation label, e.g. 'temporary-index' or 'pathspec-only'. */
    readonly isolationMechanism: string;
    readonly persistedFiles: readonly string[];
    readonly consumedUnrelatedFiles: readonly string[];
    readonly emergencyPathspec: boolean;
    readonly revisionId: string | null;
}
export interface RepositoryCommitAdapter {
    readonly adapterTarget: string;
    persist(candidate: CommitCandidate): RepositoryAdapterCommitEvidence;
}
/**
 * Isolation-preserving counters the queue/steward path emits so Plan 3.1 can
 * separate normal candidate delivery from emergency pathspec anomalies.
 */
export interface CommitCandidateCounters {
    candidateCount: number;
    queueResidency: number;
    composeDecisions: number;
    adapterFallbackCount: number;
    emergencyPathspecCount: number;
    falseBlockCount: number;
    unrelatedIndexResidueIsolationCount: number;
}
export declare function emptyCommitCandidateCounters(): CommitCandidateCounters;
/**
 * Admit a candidate against the current store contents, deriving the ahead-of
 * queue members from the store (single keyspace, no second queue). The physical
 * index residue is passed in by the caller/adapter, never read here.
 */
export declare function admitFromStore(input: {
    readonly store: CommitCandidateStore;
    readonly candidate: CommitCandidate;
    readonly currentBaseSeal: string;
    readonly adapterResolved: boolean;
    readonly unrelatedIndexResidue?: readonly string[];
    readonly adapterWouldConsumeResidue?: boolean;
    readonly revalidatable?: boolean;
    readonly counters?: CommitCandidateCounters;
}): CommitCandidateAdmissionDecision;
