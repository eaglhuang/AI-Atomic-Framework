import assert from 'node:assert/strict';

import {
  ATM_GIT_PATHSPEC_FALLBACK_REQUIRES_EMERGENCY,
  classifyPathspecFallback
} from '../../packages/core/src/commit-candidate/commit-candidate.ts';
import {
  buildGitAdapterCommitEvidence,
  isPathspecAdapterOperation
} from '../../packages/cli/src/commands/git-governance/commit-bundle-filter.ts';

// Pathspec/--only after a candidate is admitted at queue head is a legitimate
// adapter operation, not the authority model.
const adapterOp = classifyPathspecFallback({
  candidateAdmitted: true,
  invokedByGitAdapter: true,
  emergencyApprovalPresent: false
});
assert.equal(adapterOp.verdict, 'execute-now');
assert.equal(adapterOp.ok, true);
assert.equal(adapterOp.code, null);

// Direct native pathspec without admission and without emergency approval is
// blocked with the exact emergency-required code.
const direct = classifyPathspecFallback({
  candidateAdmitted: false,
  invokedByGitAdapter: false,
  emergencyApprovalPresent: false
});
assert.equal(direct.verdict, 'blocked');
assert.equal(direct.code, ATM_GIT_PATHSPEC_FALLBACK_REQUIRES_EMERGENCY);
assert.equal(direct.ok, false);
assert.ok(direct.recoveryCommand && direct.recoveryCommand.includes('emergency approve'));

// With an emergency approval it is admitted only as anomaly evidence.
const emergency = classifyPathspecFallback({
  candidateAdmitted: false,
  invokedByGitAdapter: false,
  emergencyApprovalPresent: true
});
assert.equal(emergency.code, ATM_GIT_PATHSPEC_FALLBACK_REQUIRES_EMERGENCY);
assert.equal(emergency.ok, true);
assert.ok(emergency.reasons.some((reason) => reason.includes('anomaly')));

// The git adapter records that pathspec was an operation tied to a candidate id.
const evidence = buildGitAdapterCommitEvidence({
  candidateId: 'cand-1',
  isolationMechanism: 'temporary-index',
  persistedFiles: ['docs/backlog.md'],
  consumedUnrelatedFiles: [],
  emergencyPathspec: false,
  revisionId: 'deadbeef'
});
assert.equal(evidence.schemaId, 'atm.repositoryAdapterCommit.v1');
assert.equal(evidence.adapterTarget, 'local-git');
assert.equal(evidence.candidateId, 'cand-1');
assert.equal(evidence.emergencyPathspec, false);
assert.equal(isPathspecAdapterOperation(evidence), true);

// An adapter evidence that consumed unrelated files is not a clean adapter op.
const dirty = buildGitAdapterCommitEvidence({
  candidateId: 'cand-2',
  isolationMechanism: 'pathspec-only',
  persistedFiles: ['docs/backlog.md'],
  consumedUnrelatedFiles: ['src/foreign.ts'],
  emergencyPathspec: false,
  revisionId: 'cafef00d'
});
assert.equal(isPathspecAdapterOperation(dirty), false);

console.log('git-adapter-pathspec-fallback.test passed');
