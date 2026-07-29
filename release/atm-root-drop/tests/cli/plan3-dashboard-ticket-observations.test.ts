import assert from 'node:assert/strict';
import { buildReplayDashboardViewModel } from '../../packages/cli/src/commands/broker/replay/dashboard-view-model.ts';
import { summarizeTicketObservations } from '../../packages/cli/src/commands/broker/replay/dashboard-ticket-observations.ts';

const safeCompose = summarizeTicketObservations([
  {
    participantId: 'a',
    taskId: 'task-a',
    actorId: 'actor-a',
    ticketId: 'ticket-a',
    ticketGeneration: 1,
    queuePosition: 0,
    waitedMs: 0,
    state: 'execute-now',
    releaseCondition: 'safe-compose-selected',
    eventDigests: ['sha256:a']
  },
  {
    participantId: 'b',
    taskId: 'task-b',
    actorId: 'actor-b',
    ticketId: 'ticket-b',
    ticketGeneration: 1,
    queuePosition: 0,
    waitedMs: 0,
    state: 'execute-now',
    releaseCondition: 'safe-compose-selected',
    eventDigests: ['sha256:b']
  }
]);

assert.equal(safeCompose.observationCount, 2);
assert.equal(safeCompose.participantCount, 2);
assert.equal(safeCompose.zeroWaitSafeComposeEligible, true);
assert.equal(safeCompose.missingReleaseConditionCount, 0);

const queuedFallback = summarizeTicketObservations([
  {
    participantId: 'a',
    taskId: 'task-a',
    actorId: 'actor-a',
    ticketId: 'ticket-a',
    ticketGeneration: 2,
    queuePosition: 1,
    waitedMs: 42,
    state: 'queued',
    releaseCondition: 'predecessor-close'
  }
]);

assert.equal(queuedFallback.zeroWaitSafeComposeEligible, false);
assert.equal(queuedFallback.observations[0].waitedMs, 42);
assert.equal(queuedFallback.observations[0].releaseCondition, 'predecessor-close');

const viewModel = buildReplayDashboardViewModel({
  cwd: process.cwd(),
  surfaces: ['docs/governance/atm-3-replay-evidence.md'],
  actorId: 'actor-a',
  taskId: 'ATM-GOV-0237'
});

assert.equal(viewModel.ticketObservations.schemaId, 'atm.replayDashboardTicketObservationSummary.v1');
assert.equal(viewModel.ticketObservations.observationCount, 2);
assert.ok(viewModel.ticketObservations.digest.startsWith('sha256:'));
assert.equal(viewModel.snapshot.readiness, 'ready');

console.log('plan3-dashboard-ticket-observations tests passed');
