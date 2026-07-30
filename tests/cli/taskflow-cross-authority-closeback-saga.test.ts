import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  executeTaskCloseSaga,
  type CrossAuthorityClosebackAuthoritySnapshot,
  type CrossAuthorityClosebackRequest,
  type CrossAuthorityClosebackSideEffect
} from '../../packages/cli/src/commands/taskflow/cross-authority-closeback.ts';

const target: CrossAuthorityClosebackAuthoritySnapshot = {
  name: 'target',
  repoRoot: '/repo/target',
  head: 'target-head-1',
  sourceDigest: 'sha256:target-source',
  writeable: true,
  remoteVisibilityRequired: true,
  canonicalRemote: 'origin',
  canonicalRef: 'refs/heads/main'
};

const planning: CrossAuthorityClosebackAuthoritySnapshot = {
  name: 'planning',
  repoRoot: '/repo/planning',
  head: 'planning-head-1',
  sourceDigest: 'sha256:planning-source',
  writeable: true,
  remoteVisibilityRequired: true,
  canonicalRemote: 'origin',
  canonicalRef: 'refs/heads/master'
};

const request: CrossAuthorityClosebackRequest = {
  taskId: 'ATM-GOV-0253',
  actorId: 'validator',
  sourceIdentity: 'planning-card:ATM-GOV-0253:sha256:card',
  targetFiles: ['.atm/history/tasks/ATM-GOV-0253.json', 'packages/cli/src/commands/taskflow/cross-authority-closeback.ts'],
  planningFiles: ['governance-optimization/tasks/ATM-GOV-0253-cross-authority-two-phase-closeback-saga.task.md'],
  targetBundleDigest: 'sha256:target-bundle',
  planningPatchDigest: 'sha256:planning-patch',
  planStatusTransition: 'planned->done',
  acceptanceEvidenceDigest: 'sha256:evidence'
};

const pending = executeTaskCloseSaga(request, { target, planning });
assert.equal(pending.schemaId, 'atm.crossAuthorityClosebackPlan.v1');
assert.equal(pending.phase, 'prepared');
assert.equal(pending.globalCompletion, 'closeback-pending');
assert.deepEqual(pending.authorityCas, {
  targetHead: 'target-head-1',
  planningHead: 'planning-head-1',
  targetSourceDigest: 'sha256:target-source',
  planningSourceDigest: 'sha256:planning-source'
});
assert(pending.steps.some((step) => step.id === 'target:commit'));
assert(pending.steps.some((step) => step.id === 'planning:commit'));
assert(pending.steps.every((step) => step.recoveryCommand === 'node atm.mjs taskflow diagnose --task ATM-GOV-0253 --json'));
assert.equal(pending.nextLegalRecoveryLane.disposition, 'execute-now');
assert.equal(pending.nextLegalRecoveryLane.owner, 'global');
assert.equal(pending.emergencyLanes.length, 0);

const completedTarget: CrossAuthorityClosebackSideEffect = {
  id: 'target-commit-1',
  authority: 'target',
  kind: 'commit',
  idempotencyKey: pending.steps.find((step) => step.id === 'target:commit')?.idempotencyKey ?? 'missing',
  status: 'completed',
  commitSha: 'target-commit-sha'
};

const planningRetry = executeTaskCloseSaga(request, {
  target: { ...target, remoteReachableCommit: 'target-commit-sha' },
  planning,
  completedSideEffects: [completedTarget]
});
assert.equal(planningRetry.phase, 'target-committed');
assert.equal(planningRetry.globalCompletion, 'closeback-pending');
assert(!planningRetry.steps.some((step) => step.id === 'target:commit'), 'target commit must not replay after the side effect journal says it completed');
assert(planningRetry.steps.some((step) => step.id === 'planning:commit'), 'retry must continue with the missing planning authority commit');

const completedPlanning: CrossAuthorityClosebackSideEffect = {
  id: 'planning-commit-1',
  authority: 'planning',
  kind: 'commit',
  idempotencyKey: planningRetry.steps.find((step) => step.id === 'planning:commit')?.idempotencyKey ?? 'missing',
  status: 'completed',
  commitSha: 'planning-commit-sha'
};

const remotePending = executeTaskCloseSaga(request, {
  target: { ...target, remoteReachableCommit: 'target-commit-sha' },
  planning,
  completedSideEffects: [completedTarget, completedPlanning]
});
assert.equal(remotePending.phase, 'closeback-pending');
assert.equal(remotePending.globalCompletion, 'closeback-pending');
assert(remotePending.blockers.some((blocker) => blocker.summary.includes('Planning authority commit is local-durable but not remote-visible')));
assert(remotePending.blockers.every((blocker) => blocker.recoveryLane), 'every blocker must map to an explicit legal recovery lane');
assert(remotePending.blockers.every((blocker) => blocker.forbiddenActions.length > 0), 'blockers must expose forbidden actions');
assert.equal(remotePending.blockers[0]?.owner, 'planning');
assert.equal(remotePending.blockers[0]?.recoveryLane.disposition, 'wait');
assert.equal(remotePending.nextLegalRecoveryLane.disposition, 'wait');

const notWriteable = executeTaskCloseSaga(request, {
  target: { ...target, writeable: false },
  planning
});
assert.equal(notWriteable.blockers[0]?.owner, 'target');
assert.equal(notWriteable.blockers[0]?.recoveryLane.disposition, 'human-required');
assert.equal(notWriteable.blockers[0]?.recoveryLane.command, null);
assert.equal(notWriteable.blockers[0]?.recoveryCommand, '');
assert(notWriteable.forbiddenActions.some((action) => action.includes('raw git')));

const recoveryCycle = executeTaskCloseSaga(request, {
  target,
  planning,
  recoveryObservations: [
    { owner: 'runner-sync', blockedBy: ['pre-push'] },
    { owner: 'pre-push', blockedBy: ['evidence'] },
    { owner: 'evidence', blockedBy: ['close'] },
    { owner: 'close', blockedBy: ['runner-sync'] }
  ]
});
assert.equal(recoveryCycle.blockers[0]?.code, 'ATM_TASKFLOW_CLOSE_RECOVERY_CYCLE');
assert.deepEqual(recoveryCycle.recoveryCycles[0]?.nodes, ['runner-sync', 'pre-push', 'evidence', 'close']);
assert.equal(recoveryCycle.nextLegalRecoveryLane.owner, 'runner-sync');
assert.equal(recoveryCycle.nextLegalRecoveryLane.disposition, 'recover');
assert(recoveryCycle.nextLegalRecoveryLane.forbiddenActions.some((action) => action.includes('--force')));

const complete = executeTaskCloseSaga(request, {
  target: { ...target, remoteReachableCommit: 'target-commit-sha' },
  planning: { ...planning, remoteReachableCommit: 'planning-commit-sha' },
  completedSideEffects: [completedTarget, completedPlanning]
});
assert.equal(complete.phase, 'both-committed');
assert.equal(complete.globalCompletion, 'complete');
assert.equal(complete.blockers.length, 0);
assert.equal(executeTaskCloseSaga(request, {
  target: { ...target, remoteReachableCommit: 'target-commit-sha' },
  planning: { ...planning, remoteReachableCommit: 'planning-commit-sha' },
  completedSideEffects: [completedTarget, completedPlanning]
}).receipt.receiptDigest, complete.receipt.receiptDigest, 'same sealed inputs must produce the same receipt digest');

const ajv = new Ajv2020({ allErrors: true, strict: false });
const schema = JSON.parse(readFileSync('schemas/governance/cross-authority-closeback.schema.json', 'utf8'));
const validate = ajv.compile(schema);
assert.equal(validate(complete), true, JSON.stringify(validate.errors, null, 2));
assert.equal(validate(complete.receipt), true, JSON.stringify(validate.errors, null, 2));
assert.equal(validate(remotePending), true, JSON.stringify(validate.errors, null, 2));
assert.equal(validate(notWriteable), true, JSON.stringify(validate.errors, null, 2));
assert.equal(validate(recoveryCycle), true, JSON.stringify(validate.errors, null, 2));

console.log(JSON.stringify({
  marker: '[taskflow-cross-authority-closeback-saga.test] ok',
  schemaId: complete.schemaId,
  phase: complete.phase,
  globalCompletion: complete.globalCompletion,
  receiptDigest: complete.receipt.receiptDigest
}));
