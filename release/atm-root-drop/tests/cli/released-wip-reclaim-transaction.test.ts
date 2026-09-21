import assert from 'node:assert/strict';
import { isConfirmedWipCommitResult } from '../../packages/cli/src/commands/tasks/release-wip-transaction.ts';
import { planWipTransition, retainReleasedWipOwnership } from '../../packages/core/src/lane/wip-ownership-transition.ts';

const taskId = 'TASK-WIP-0012';
const dirtyPath = 'packages/example.ts';
assert.equal(isConfirmedWipCommitResult({ ok: true, evidence: { commitSha: 'abc123', workAdmission: { decision: { ok: true } } } }), true);
assert.equal(isConfirmedWipCommitResult({ ok: true, evidence: { commitSha: '', workAdmission: { decision: { ok: true } } } }), false, 'a receipt without a verified SHA cannot release a claim');
const plan = planWipTransition({ kind: 'release', taskId, requestingLaneId: 'lane-0012', actorId: 'owner', dirtyPaths: [dirtyPath], now: '2026-08-09T00:00:00.000Z' }, { taskId, ownerLaneId: 'lane-0012', recordedDirtyPaths: [dirtyPath], journalHead: 0 });
const retained = retainReleasedWipOwnership({ plan, actorId: 'owner', laneSessionId: 'lane-0012', dirtyPaths: [dirtyPath] });
assert.equal(retained?.taskId, taskId);
assert.deepEqual(retained?.dirtyPaths, [dirtyPath]);
console.log('[released-wip-reclaim-transaction.test] ok');
