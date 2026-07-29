import assert from 'node:assert/strict';
import { admitTestCaseContributions } from '../../packages/core/src/broker/test-case-contribution.ts';

const caseA = {
  caseId: 'test_int_runner_sync_actor_continuity_8f3a2c1d',
  semanticKey: 'actor_continuity',
  coversAcceptance: ['ACC-2'],
  coversImpactEdges: ['identity-to-runner-sync']
};
const caseB = {
  caseId: 'test_int_runner_sync_seal_freshness_1b2c3d4e',
  semanticKey: 'seal_freshness',
  coversImpactEdges: ['identity-to-runner-sync']
};

const multiCaseOneIntent = admitTestCaseContributions([{
  actorId: 'feature-worker-a',
  taskId: 'TASK-DEMO-0001',
  contributionResourceKey: 'test-group:runner-sync',
  targetGroupId: 'test_group_runner_sync',
  cases: [caseA, caseB]
}]);
assert.equal(multiCaseOneIntent.disposition, 'compose');
assert.equal(multiCaseOneIntent.composedCases.length, 2);
assert.equal(multiCaseOneIntent.attribution.length, 1);
assert.deepEqual(multiCaseOneIntent.attribution[0]?.caseIds, [
  'test_int_runner_sync_actor_continuity_8f3a2c1d',
  'test_int_runner_sync_seal_freshness_1b2c3d4e'
]);

const disjointCompose = admitTestCaseContributions([
  {
    actorId: 'feature-worker-a',
    taskId: 'TASK-DEMO-0001',
    contributionResourceKey: 'test-group:runner-sync',
    targetGroupId: 'test_group_runner_sync',
    cases: [caseA]
  },
  {
    actorId: 'feature-worker-b',
    taskId: 'TASK-DEMO-0002',
    contributionResourceKey: 'test-group:runner-sync',
    targetGroupId: 'test_group_runner_sync',
    cases: [caseB]
  }
]);
assert.equal(disjointCompose.disposition, 'compose');
assert.equal(disjointCompose.composedCases.length, 2);
assert.equal(disjointCompose.attribution.length, 2);
assert.ok(disjointCompose.attribution.every((entry) => entry.contributionResourceKey === 'test-group:runner-sync'));

const sameCaseConflict = admitTestCaseContributions([
  {
    actorId: 'feature-worker-a',
    taskId: 'TASK-DEMO-0001',
    contributionResourceKey: 'test-group:runner-sync',
    targetGroupId: 'test_group_runner_sync',
    cases: [caseA]
  },
  {
    actorId: 'feature-worker-b',
    taskId: 'TASK-DEMO-0002',
    contributionResourceKey: 'test-group:runner-sync',
    targetGroupId: 'test_group_runner_sync',
    cases: [{
      ...caseA,
      semanticKey: 'different_behavior'
    }]
  }
]);
assert.equal(sameCaseConflict.disposition, 'queue');
assert.deepEqual(sameCaseConflict.conflictCaseIds, [caseA.caseId]);

const sameCaseDrift = admitTestCaseContributions([
  {
    actorId: 'feature-worker-a',
    taskId: 'TASK-DEMO-0001',
    contributionResourceKey: 'test-group:runner-sync',
    targetGroupId: 'test_group_runner_sync',
    cases: [caseA]
  },
  {
    actorId: 'feature-worker-b',
    taskId: 'TASK-DEMO-0002',
    contributionResourceKey: 'test-group:runner-sync',
    targetGroupId: 'test_group_runner_sync',
    cases: [{
      ...caseA,
      coversAcceptance: ['ACC-9']
    }]
  }
]);
assert.equal(sameCaseDrift.disposition, 'revalidate');
assert.deepEqual(sameCaseDrift.conflictCaseIds, [caseA.caseId]);

const idempotentSamePayload = admitTestCaseContributions([
  {
    actorId: 'feature-worker-a',
    taskId: 'TASK-DEMO-0001',
    contributionResourceKey: 'test-group:runner-sync',
    targetGroupId: 'test_group_runner_sync',
    cases: [caseA]
  },
  {
    actorId: 'feature-worker-b',
    taskId: 'TASK-DEMO-0002',
    contributionResourceKey: 'test-group:runner-sync',
    targetGroupId: 'test_group_runner_sync',
    cases: [caseA]
  }
]);
assert.equal(idempotentSamePayload.disposition, 'compose');
assert.equal(idempotentSamePayload.composedCases.length, 1);

console.log('[test-case-contribution-broker:test] ok');
