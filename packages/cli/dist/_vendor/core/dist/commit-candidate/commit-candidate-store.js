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
import { admitCommitCandidate } from './commit-candidate.js';
/**
 * In-memory candidate store. Submission never mutates any physical index, so
 * two disjoint candidates can coexist while the real worktree holds unrelated
 * staged or dirty files.
 */
export class InMemoryCommitCandidateStore {
    order = [];
    byId = new Map();
    submit(candidate) {
        if (!this.byId.has(candidate.candidateId)) {
            this.order.push(candidate.candidateId);
        }
        this.byId.set(candidate.candidateId, candidate);
    }
    get(candidateId) {
        return this.byId.get(candidateId) ?? null;
    }
    list() {
        return this.order
            .map((id) => this.byId.get(id))
            .filter((candidate) => candidate !== undefined);
    }
    supersede(candidateId, replacement) {
        this.remove(candidateId);
        this.submit(replacement);
    }
    remove(candidateId) {
        if (!this.byId.has(candidateId))
            return;
        this.byId.delete(candidateId);
        const index = this.order.indexOf(candidateId);
        if (index >= 0)
            this.order.splice(index, 1);
    }
}
export function emptyCommitCandidateCounters() {
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
export function admitFromStore(input) {
    const aheadCandidates = input.store
        .list()
        .filter((member) => member.candidateId !== input.candidate.candidateId)
        .map((member) => ({
        candidateId: member.candidateId,
        allowedResourceKeys: member.allowedResourceKeys,
        composeEligible: member.composeEligible
    }));
    const context = {
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
function tallyCounters(counters, decision, residue) {
    counters.candidateCount += 1;
    if (decision.verdict === 'queued' || decision.verdict === 'revalidation-required')
        counters.queueResidency += 1;
    if (decision.verdict === 'compose-eligible')
        counters.composeDecisions += 1;
    if (decision.verdict === 'adapter-required')
        counters.adapterFallbackCount += 1;
    if (residue.length > 0 && decision.verdict !== 'blocked')
        counters.unrelatedIndexResidueIsolationCount += 1;
}
