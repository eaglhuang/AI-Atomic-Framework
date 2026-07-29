import assert from 'node:assert/strict';
import { buildReplayDashboardViewModel } from '../../packages/cli/src/commands/broker/replay/dashboard-view-model.ts';
import { summarizeLifecycleObservations } from '../../packages/cli/src/commands/broker/replay/dashboard-lifecycle-observations.ts';

const safeCompose = summarizeLifecycleObservations([
  {
    participantId: 'a',
    taskId: 'task-a',
    actorId: 'actor-a',
    claimDigest: 'sha256:claim-a',
    proposalDigest: 'sha256:proposal-a',
    composeBatchId: 'sha256:compose-batch',
    publishDigest: 'sha256:publish-a',
    wakeup: 'auto',
    validationDigest: 'sha256:validation',
    closeDigest: 'sha256:close-a'
  },
  {
    participantId: 'b',
    taskId: 'task-b',
    actorId: 'actor-b',
    claimDigest: 'sha256:claim-b',
    proposalDigest: 'sha256:proposal-b',
    composeBatchId: 'sha256:compose-batch',
    publishDigest: 'sha256:publish-b',
    wakeup: 'auto',
    validationDigest: 'sha256:validation',
    closeDigest: 'sha256:close-b'
  }
]);

assert.equal(safeCompose.observationCount, 2);
assert.equal(safeCompose.participantCount, 2);
assert.equal(safeCompose.composeBatchCount, 1);
assert.equal(safeCompose.sharedComposeBatch, true);
assert.equal(safeCompose.zeroWaitSafeComposeEligible, true);
assert.equal(safeCompose.missingCloseCount, 0);

const queuedFallback = summarizeLifecycleObservations([
  {
    participantId: 'a',
    taskId: 'task-a',
    actorId: 'actor-a',
    claimDigest: 'sha256:claim-a',
    proposalDigest: 'sha256:proposal-a',
    composeBatchId: 'sha256:compose-a',
    publishDigest: 'sha256:publish-a',
    wakeup: 'auto',
    validationDigest: 'sha256:validation',
    closeDigest: null,
    lifecycleEvents: [{ phase: 'compose', digest: 'sha256:compose-a', status: 'observed', waitedMs: 73 }]
  },
  {
    participantId: 'b',
    taskId: 'task-b',
    actorId: 'actor-b',
    claimDigest: 'sha256:claim-b',
    proposalDigest: 'sha256:proposal-b',
    composeBatchId: 'sha256:compose-b',
    publishDigest: 'sha256:publish-b',
    wakeup: 'manual',
    validationDigest: 'sha256:validation',
    closeDigest: 'sha256:close-b'
  }
]);

assert.equal(queuedFallback.sharedComposeBatch, false);
assert.equal(queuedFallback.zeroWaitSafeComposeEligible, false);
assert.equal(queuedFallback.missingCloseCount, 1);
assert.equal(queuedFallback.observations[0].waitedMs, 73);

const viewModel = buildReplayDashboardViewModel({
  cwd: process.cwd(),
  surfaces: ['docs/governance/atm-3-replay-evidence.md'],
  actorId: 'actor-a',
  taskId: 'ATM-GOV-0238'
});

assert.equal(viewModel.lifecycleObservations.schemaId, 'atm.replayDashboardLifecycleObservationSummary.v1');
assert.equal(viewModel.lifecycleObservations.observationCount, 2);
assert.equal(viewModel.lifecycleObservations.sharedComposeBatch, true);
assert.ok(viewModel.lifecycleObservations.digest.startsWith('sha256:'));
assert.equal(viewModel.snapshot.readiness, 'ready');

console.log('plan3-dashboard-lifecycle-observations tests passed');
