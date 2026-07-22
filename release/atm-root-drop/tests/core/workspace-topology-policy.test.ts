import assert from 'node:assert/strict';
import { evaluateWorkspaceTopologyPolicy } from '../../packages/core/src/broker/workspace-topology-policy.ts';

const canonical = 'C:/repo/canonical';

const proposal = evaluateWorkspaceTopologyPolicy({
  canonicalWorktreeRoot: canonical,
  executionWorktreeRoot: 'c:\\repo\\canonical\\',
  purpose: 'normal-development',
  operation: 'submit-proposal',
  actorRole: 'worker'
});
assert.equal(proposal.allowed, true);
assert.equal(proposal.verdict, 'canonical-development');

const steward = evaluateWorkspaceTopologyPolicy({
  canonicalWorktreeRoot: canonical,
  executionWorktreeRoot: canonical,
  purpose: 'normal-development',
  operation: 'apply-shared-delivery',
  actorRole: 'neutral-steward'
});
assert.equal(steward.allowed, true);

const directWorkerWrite = evaluateWorkspaceTopologyPolicy({
  canonicalWorktreeRoot: canonical,
  executionWorktreeRoot: canonical,
  purpose: 'normal-development',
  operation: 'apply-shared-delivery',
  actorRole: 'worker'
});
assert.equal(directWorkerWrite.verdict, 'rejected-direct-worker-write');

const detachedWorktree = evaluateWorkspaceTopologyPolicy({
  canonicalWorktreeRoot: canonical,
  executionWorktreeRoot: 'C:/repo/detached',
  purpose: 'normal-development',
  operation: 'submit-proposal',
  actorRole: 'worker'
});
assert.equal(detachedWorktree.verdict, 'rejected-noncanonical-development');

const exceptionWithoutReceipt = evaluateWorkspaceTopologyPolicy({
  canonicalWorktreeRoot: canonical,
  executionWorktreeRoot: 'C:/repo/recovery',
  purpose: 'emergency-anomaly-recovery',
  operation: 'read-only',
  actorRole: 'worker'
});
assert.equal(exceptionWithoutReceipt.verdict, 'rejected-missing-exception-receipt');

const documentedException = evaluateWorkspaceTopologyPolicy({
  canonicalWorktreeRoot: canonical,
  executionWorktreeRoot: 'C:/repo/recovery',
  purpose: 'emergency-anomaly-recovery',
  operation: 'read-only',
  actorRole: 'worker',
  exceptionReceiptId: 'receipt-recovery-001'
});
assert.equal(documentedException.allowed, true);
assert.equal(documentedException.verdict, 'documented-exception');

for (const purpose of ['historical-read-only-discrimination', 'non-development-sealed-packaging'] as const) {
  const decision = evaluateWorkspaceTopologyPolicy({
    canonicalWorktreeRoot: canonical,
    executionWorktreeRoot: 'C:/repo/isolated-tooling',
    purpose,
    operation: 'read-only',
    actorRole: 'worker',
    exceptionReceiptId: `receipt-${purpose}`
  });
  assert.equal(decision.verdict, 'documented-exception');
}

const unknownPurpose = evaluateWorkspaceTopologyPolicy({
  canonicalWorktreeRoot: canonical,
  executionWorktreeRoot: 'C:/repo/unknown',
  purpose: 'normal-development-but-isolated' as never,
  operation: 'read-only',
  actorRole: 'worker',
  exceptionReceiptId: 'receipt-must-not-be-a-waiver'
});
assert.equal(unknownPurpose.verdict, 'rejected-unsupported-purpose');

const posixCaseMismatch = evaluateWorkspaceTopologyPolicy({
  canonicalWorktreeRoot: '/srv/repo',
  executionWorktreeRoot: '/srv/Repo',
  purpose: 'normal-development',
  operation: 'submit-proposal',
  actorRole: 'worker'
});
assert.equal(posixCaseMismatch.verdict, 'rejected-noncanonical-development');

console.log('[workspace-topology-policy] ok');
