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

import {
  admitCommitCandidate,
  type CommitCandidate,
  type CommitCandidateAdmissionDecision,
  type CommitCandidateAdmissionContext,
  type CommitCandidateQueueMember
} from './commit-candidate.ts';

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
export class InMemoryCommitCandidateStore implements CommitCandidateStore {
  private readonly order: string[] = [];
  private readonly byId = new Map<string, CommitCandidate>();

  submit(candidate: CommitCandidate): void {
    if (!this.byId.has(candidate.candidateId)) {
      this.order.push(candidate.candidateId);
    }
    this.byId.set(candidate.candidateId, candidate);
  }

  get(candidateId: string): CommitCandidate | null {
    return this.byId.get(candidateId) ?? null;
  }

  list(): readonly CommitCandidate[] {
    return this.order
      .map((id) => this.byId.get(id))
      .filter((candidate): candidate is CommitCandidate => candidate !== undefined);
  }

  supersede(candidateId: string, replacement: CommitCandidate): void {
    this.remove(candidateId);
    this.submit(replacement);
  }

  remove(candidateId: string): void {
    if (!this.byId.has(candidateId)) return;
    this.byId.delete(candidateId);
    const index = this.order.indexOf(candidateId);
    if (index >= 0) this.order.splice(index, 1);
  }
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

export function emptyCommitCandidateCounters(): CommitCandidateCounters {
  return {
    candidateCount: 0,
    queueResidency: 0,
    composeDecisions: 0,
    adapterFallbackCount: 0,
    emergencyPathspecCount: 0,
    falseBlockCount: 0,
    unrelatedIndexResidueIsolationCount: 0
  };
}

/**
 * Admit a candidate against the current store contents, deriving the ahead-of
 * queue members from the store (single keyspace, no second queue). The physical
 * index residue is passed in by the caller/adapter, never read here.
 */
export function admitFromStore(input: {
  readonly store: CommitCandidateStore;
  readonly candidate: CommitCandidate;
  readonly currentBaseSeal: string;
  readonly adapterResolved: boolean;
  readonly unrelatedIndexResidue?: readonly string[];
  readonly adapterWouldConsumeResidue?: boolean;
  readonly revalidatable?: boolean;
  readonly counters?: CommitCandidateCounters;
}): CommitCandidateAdmissionDecision {
  const aheadCandidates: CommitCandidateQueueMember[] = input.store
    .list()
    .filter((member) => member.candidateId !== input.candidate.candidateId)
    .map((member) => ({
      candidateId: member.candidateId,
      allowedResourceKeys: member.allowedResourceKeys,
      composeEligible: member.composeEligible
    }));

  const context: CommitCandidateAdmissionContext = {
    currentBaseSeal: input.currentBaseSeal,
    aheadCandidates,
    adapterResolved: input.adapterResolved,
    unrelatedIndexResidue: input.unrelatedIndexResidue,
    adapterWouldConsumeResidue: input.adapterWouldConsumeResidue,
    revalidatable: input.revalidatable
  };
  const decision = admitCommitCandidate(input.candidate, context);

  if (input.counters) {
    tallyCounters(input.counters, decision, input.unrelatedIndexResidue ?? []);
  }
  return decision;
}

function tallyCounters(
  counters: CommitCandidateCounters,
  decision: CommitCandidateAdmissionDecision,
  residue: readonly string[]
): void {
  counters.candidateCount += 1;
  if (decision.verdict === 'queued' || decision.verdict === 'revalidation-required') counters.queueResidency += 1;
  if (decision.verdict === 'compose-eligible') counters.composeDecisions += 1;
  if (decision.verdict === 'adapter-required') counters.adapterFallbackCount += 1;
  if (residue.length > 0 && decision.verdict !== 'blocked') counters.unrelatedIndexResidueIsolationCount += 1;
}
