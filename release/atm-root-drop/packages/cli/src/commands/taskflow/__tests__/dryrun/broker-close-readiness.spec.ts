import assert from 'node:assert/strict';
import { runTaskflow } from '../../../taskflow.ts';
import { makeActiveIntent, makeBrokerCloseFixture, writeBrokerRegistry } from './fixtures.ts';

const brokerConfirmedFixture = await makeBrokerCloseFixture('confirmed');
writeBrokerRegistry(brokerConfirmedFixture.targetRepo, [
  makeActiveIntent({
    taskId: brokerConfirmedFixture.taskId,
    actorId: 'validator',
    files: ['src/app.ts'],
    atomIds: ['ATOM-A'],
    atomCids: ['CID-SHARED']
  }),
  makeActiveIntent({
    taskId: 'TASK-OTHER-CONFIRMED',
    actorId: 'other',
    files: ['src/app.ts'],
    atomIds: ['ATOM-B'],
    atomCids: ['CID-SHARED']
  })
]);
const brokerConfirmedPreClose = await runTaskflow([
  'pre-close',
  '--cwd', brokerConfirmedFixture.targetRepo,
  '--task', brokerConfirmedFixture.taskId,
  '--actor', 'validator',
  '--json'
]) as any;
assert.equal(brokerConfirmedPreClose.evidence.writeReadinessHint.brokerConflictGate.verdict, 'confirmedConflict');
const brokerConfirmedDryRun = await runTaskflow([
  'close',
  '--cwd', brokerConfirmedFixture.targetRepo,
  '--task', brokerConfirmedFixture.taskId,
  '--actor', 'validator',
  '--json'
]) as any;
assert.equal(brokerConfirmedDryRun.evidence.writeReadinessHint.brokerConflictGate.verdict, 'confirmedConflict');
assert.ok(
  brokerConfirmedDryRun.evidence.writeReadinessHint.blockers.some((entry: any) => entry.code === 'ATM_TASKFLOW_CLOSE_BROKER_CONFIRMED_CONFLICT'),
  'confirmed broker conflict must block taskflow close --write readiness'
);

const brokerInsufficientFixture = await makeBrokerCloseFixture('insufficient');
writeBrokerRegistry(brokerInsufficientFixture.targetRepo, [
  makeActiveIntent({
    taskId: brokerInsufficientFixture.taskId,
    actorId: 'validator',
    files: ['src/app.ts']
  }),
  makeActiveIntent({
    taskId: 'TASK-OTHER-INSUFFICIENT',
    actorId: 'other',
    files: ['src/app.ts']
  })
]);
const brokerInsufficientDryRun = await runTaskflow([
  'close',
  '--cwd', brokerInsufficientFixture.targetRepo,
  '--task', brokerInsufficientFixture.taskId,
  '--actor', 'validator',
  '--json'
]) as any;
assert.equal(brokerInsufficientDryRun.evidence.writeReadinessHint.brokerConflictGate.verdict, 'insufficientMutationIntent');
assert.ok(
  brokerInsufficientDryRun.evidence.writeReadinessHint.blockers.every((entry: any) => entry.code !== 'ATM_TASKFLOW_CLOSE_BROKER_CONFIRMED_CONFLICT'),
  'insufficient mutation intent must remain advisory'
);

const brokerStaleLeaseFixture = await makeBrokerCloseFixture('stale-lease');
writeBrokerRegistry(brokerStaleLeaseFixture.targetRepo, [
  makeActiveIntent({
    taskId: brokerStaleLeaseFixture.taskId,
    actorId: 'validator',
    files: ['src/app.ts'],
    atomIds: ['ATOM-SELF'],
    atomCids: ['CID-SELF']
  }),
  makeActiveIntent({
    taskId: 'TASK-OTHER-STALE-LEASE',
    actorId: 'other',
    files: ['src/app.ts'],
    atomIds: ['ATOM-OTHER'],
    atomCids: ['CID-OTHER'],
    expiresAt: '2000-01-01T00:00:00.000Z'
  })
]);
const brokerStaleLeaseDryRun = await runTaskflow([
  'close',
  '--cwd', brokerStaleLeaseFixture.targetRepo,
  '--task', brokerStaleLeaseFixture.taskId,
  '--actor', 'validator',
  '--json'
]) as any;
assert.equal(
  brokerStaleLeaseDryRun.evidence.writeReadinessHint.brokerConflictGate.verdict,
  'noConflict',
  'expired lease metadata alone must not manufacture a takeover blocker when broker dry-run cannot confirm an active-lease conflict'
);
assert.equal(brokerStaleLeaseDryRun.evidence.writeReadinessHint.brokerConflictGate.brokerVerdict, null);
assert.ok(
  brokerStaleLeaseDryRun.evidence.writeReadinessHint.blockers.every((entry: any) => entry.code !== 'ATM_TASKFLOW_CLOSE_BROKER_TAKEOVER_REQUIRED'),
  'dry-run should not raise a takeover blocker for the stale-lease fixture unless broker conflict arbitration confirms one'
);
assert.equal(
  brokerStaleLeaseDryRun.evidence.writeReadinessHint.brokerConflictGate.requiredCommand,
  null,
  'no confirmed takeover path should mean no claim-repair command is required'
);

const brokerStaleEpochFixture = await makeBrokerCloseFixture('stale-epoch');
writeBrokerRegistry(brokerStaleEpochFixture.targetRepo, [
  makeActiveIntent({
    taskId: brokerStaleEpochFixture.taskId,
    actorId: 'validator',
    files: ['src/app.ts'],
    atomIds: ['ATOM-SELF-EPOCH'],
    atomCids: ['CID-SELF-EPOCH']
  }),
  makeActiveIntent({
    taskId: 'TASK-OTHER-STALE-EPOCH',
    actorId: 'other',
    files: ['src/app.ts'],
    atomIds: ['ATOM-OTHER-EPOCH'],
    atomCids: ['CID-OTHER-EPOCH'],
    expiresAt: '2099-01-01T00:00:00.000Z'
  })
], { currentEpoch: 2 });
const brokerStaleEpochDryRun = await runTaskflow([
  'close',
  '--cwd', brokerStaleEpochFixture.targetRepo,
  '--task', brokerStaleEpochFixture.taskId,
  '--actor', 'validator',
  '--json'
]) as any;
assert.equal(
  brokerStaleEpochDryRun.evidence.writeReadinessHint.brokerConflictGate.verdict,
  'insufficientMutationIntent',
  'stale epoch overlap without a confirmed broker conflict should remain advisory in taskflow dry-run'
);
assert.equal(brokerStaleEpochDryRun.evidence.writeReadinessHint.brokerConflictGate.brokerVerdict, 'needs-physical-split');
assert.ok(
  brokerStaleEpochDryRun.evidence.writeReadinessHint.blockers.every((entry: any) => entry.code !== 'ATM_TASKFLOW_CLOSE_BROKER_TAKEOVER_REQUIRED'),
  'advisory stale epoch overlap must not block taskflow close --write readiness by itself'
);
assert.ok(
  brokerStaleEpochDryRun.evidence.writeReadinessHint.brokerConflictGate.requiredCommand?.includes('team broker resolve'),
  'advisory stale-epoch overlap must point operators to broker resolution'
);

const brokerCleanFixture = await makeBrokerCloseFixture('clean');
writeBrokerRegistry(brokerCleanFixture.targetRepo, [
  makeActiveIntent({
    taskId: brokerCleanFixture.taskId,
    actorId: 'validator',
    files: ['src/app.ts'],
    atomIds: ['ATOM-A'],
    atomCids: ['CID-A']
  }),
  makeActiveIntent({
    taskId: 'TASK-OTHER-CLEAN',
    actorId: 'other',
    files: ['src/other.ts'],
    atomIds: ['ATOM-Z'],
    atomCids: ['CID-Z']
  })
]);
const brokerCleanDryRun = await runTaskflow([
  'close',
  '--cwd', brokerCleanFixture.targetRepo,
  '--task', brokerCleanFixture.taskId,
  '--actor', 'validator',
  '--json'
]) as any;
assert.equal(brokerCleanDryRun.evidence.writeReadinessHint.brokerConflictGate.verdict, 'noConflict');

console.log('[taskflow-dryrun:broker-close-readiness] ok');
