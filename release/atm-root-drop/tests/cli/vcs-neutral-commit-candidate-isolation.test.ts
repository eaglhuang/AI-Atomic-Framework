import assert from 'node:assert/strict';

import {
  ATM_COMMIT_CANDIDATE_ADAPTER_REQUIRED,
  ATM_COMMIT_CANDIDATE_CONFLICT,
  ATM_COMMIT_CANDIDATE_INDEX_RESIDUE_BLOCKED,
  ATM_COMMIT_CANDIDATE_STALE_BASE,
  admitCommitCandidate,
  buildCommitCandidate,
  type CommitCandidate
} from '../../packages/core/src/commit-candidate/commit-candidate.ts';
import {
  InMemoryCommitCandidateStore,
  admitFromStore,
  emptyCommitCandidateCounters
} from '../../packages/core/src/commit-candidate/commit-candidate-store.ts';

const baseSeal = 'base-seal-1';

function candidate(overrides: Partial<CommitCandidate> = {}): CommitCandidate {
  return buildCommitCandidate({
    candidateId: overrides.candidateId ?? 'cand-a',
    actorId: 'actor-a',
    taskId: overrides.taskId ?? 'ATM-GOV-A',
    frameworkTempId: null,
    laneSessionId: null,
    leaseId: null,
    baseSeal: overrides.baseSeal ?? baseSeal,
    files: overrides.files ?? [{ path: 'docs/a.md', contentDigest: 'sha256:a', changeKind: 'modify' }],
    allowedResourceKeys: overrides.allowedResourceKeys ?? ['file:docs/a.md'],
    validationPlan: ['npm run typecheck'],
    evidenceRefs: [],
    expectedTrailers: { 'ATM-Actor': 'actor-a' },
    adapterTarget: overrides.adapterTarget === undefined ? 'local-git' : overrides.adapterTarget,
    composeEligible: overrides.composeEligible ?? false,
    createdAt: '2026-07-24T00:00:00.000Z'
  });
}

// The envelope is fully VCS-neutral: nothing here imports or touches Git, yet a
// candidate can be admitted end to end. This is the negative test that ATM core
// runs without Git-specific pathspec semantics.
const okCtx = { currentBaseSeal: baseSeal, aheadCandidates: [], adapterResolved: true };
assert.equal(admitCommitCandidate(candidate(), okCtx).verdict, 'execute-now');
assert.equal(admitCommitCandidate(candidate(), okCtx).ok, true);

// Two disjoint candidates coexist in the store without any shared index.
const store = new InMemoryCommitCandidateStore();
store.submit(candidate({ candidateId: 'cand-a', allowedResourceKeys: ['file:docs/a.md'] }));
store.submit(candidate({ candidateId: 'cand-b', allowedResourceKeys: ['file:docs/b.md'] }));
assert.equal(store.list().length, 2);
const disjoint = admitFromStore({
  store,
  candidate: candidate({ candidateId: 'cand-b', allowedResourceKeys: ['file:docs/b.md'] }),
  currentBaseSeal: baseSeal,
  adapterResolved: true
});
assert.equal(disjoint.verdict, 'execute-now');

// Stale base fails closed with the exact code and a recovery command.
const stale = admitCommitCandidate(candidate({ baseSeal: 'old-seal' }), okCtx);
assert.equal(stale.verdict, 'stale-base');
assert.equal(stale.code, ATM_COMMIT_CANDIDATE_STALE_BASE);
assert.ok(stale.recoveryCommand);

// Base advanced but revalidatable → revalidation-required, not stale.
const reval = admitCommitCandidate(candidate({ baseSeal: 'old-seal' }), { ...okCtx, revalidatable: true });
assert.equal(reval.verdict, 'revalidation-required');
assert.equal(reval.code, null);

// Adapter not resolved (or absent target) → adapter-required.
assert.equal(admitCommitCandidate(candidate(), { ...okCtx, adapterResolved: false }).code, ATM_COMMIT_CANDIDATE_ADAPTER_REQUIRED);
assert.equal(admitCommitCandidate(candidate({ adapterTarget: null }), okCtx).code, ATM_COMMIT_CANDIDATE_ADAPTER_REQUIRED);

// Overlapping non-composable keys ahead → conflict with named candidate.
const conflict = admitCommitCandidate(candidate({ candidateId: 'cand-c', allowedResourceKeys: ['atom:x'] }), {
  currentBaseSeal: baseSeal,
  adapterResolved: true,
  aheadCandidates: [{ candidateId: 'cand-ahead', allowedResourceKeys: ['atom:x'], composeEligible: false }]
});
assert.equal(conflict.verdict, 'blocked');
assert.equal(conflict.code, ATM_COMMIT_CANDIDATE_CONFLICT);
assert.deepEqual(conflict.conflictingCandidateIds, ['cand-ahead']);

// Overlapping but both compose-eligible → compose-eligible (fallback, not block).
const compose = admitCommitCandidate(candidate({ candidateId: 'cand-d', allowedResourceKeys: ['atom:y'], composeEligible: true }), {
  currentBaseSeal: baseSeal,
  adapterResolved: true,
  aheadCandidates: [{ candidateId: 'cand-ahead', allowedResourceKeys: ['atom:y'], composeEligible: true }]
});
assert.equal(compose.verdict, 'compose-eligible');
assert.equal(compose.code, null);

// Unrelated index residue is fine unless the adapter would consume it.
const residuePresent = admitCommitCandidate(candidate(), {
  ...okCtx,
  unrelatedIndexResidue: ['file:unrelated.ts'],
  adapterWouldConsumeResidue: false
});
assert.equal(residuePresent.verdict, 'execute-now', 'residue existing alone must not block');
const residueConsumed = admitCommitCandidate(candidate(), {
  ...okCtx,
  unrelatedIndexResidue: ['file:unrelated.ts'],
  adapterWouldConsumeResidue: true
});
assert.equal(residueConsumed.code, ATM_COMMIT_CANDIDATE_INDEX_RESIDUE_BLOCKED);

// Counters record isolation of unrelated residue on a clean admit.
const counters = emptyCommitCandidateCounters();
admitFromStore({
  store: new InMemoryCommitCandidateStore(),
  candidate: candidate(),
  currentBaseSeal: baseSeal,
  adapterResolved: true,
  unrelatedIndexResidue: ['file:unrelated.ts'],
  counters
});
assert.equal(counters.unrelatedIndexResidueIsolationCount, 1);
assert.equal(counters.candidateCount, 1);

console.log('vcs-neutral-commit-candidate-isolation.test passed');
