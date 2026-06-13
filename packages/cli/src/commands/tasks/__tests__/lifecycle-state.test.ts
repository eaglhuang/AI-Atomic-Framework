import {
  evaluateTaskClaimAdmission,
  evaluateTaskDoneCloseAdmission,
  evaluateTaskPromotionAdmission,
  evaluateTaskResetAdmission
} from '../lifecycle-state.ts';

function fail(message: string): never {
  console.error(`[lifecycle-state.test] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

let result = evaluateTaskPromotionAdmission({ taskId: 'TASK-LIFE', status: 'reserved' });
assert(result.ok, 'reserved task must promote to ready');

result = evaluateTaskClaimAdmission({
  taskId: 'TASK-LIFE',
  actorId: 'captain',
  status: 'ready',
  claimIntent: 'write'
});
assert(result.ok, 'ready task must allow write claim');

result = evaluateTaskClaimAdmission({
  taskId: 'TASK-LIFE',
  actorId: 'captain',
  status: 'review',
  claimIntent: 'write'
});
if (result.ok) fail('review task must reject ordinary write claim');
assert(result.code === 'ATM_TASK_CLAIM_REVIEW_CLOSEOUT_ONLY_REQUIRED', 'review write claim must require closeout-only');
assert(String(result.details.requiredCommand).includes('--claim-intent closeout-only'), 'review recovery command must be actionable');

result = evaluateTaskClaimAdmission({
  taskId: 'TASK-LIFE',
  actorId: 'captain',
  status: 'review',
  claimIntent: 'closeout-only'
});
assert(result.ok, 'review task must allow closeout-only reclaim');

result = evaluateTaskDoneCloseAdmission({
  taskId: 'TASK-LIFE',
  actorId: 'captain',
  status: 'planned',
  claimState: null,
  claimActorId: null,
  hasActiveSession: false
});
if (result.ok) fail('planned task must fail closed before trusted done close');
assert(result.code === 'ATM_TASK_CLOSE_INVALID_LIFECYCLE', 'planned done close must use lifecycle error code');

result = evaluateTaskDoneCloseAdmission({
  taskId: 'TASK-LIFE',
  actorId: 'captain',
  status: 'running',
  claimState: null,
  claimActorId: null,
  hasActiveSession: true
});
if (result.ok) fail('done close without active claim must fail closed');
assert(result.code === 'ATM_TASK_CLOSE_ACTIVE_CLAIM_REQUIRED', 'missing claim close must return recovery-required code');
assert(String(result.details.requiredCommand).includes('next --claim'), 'missing claim close must include claim recovery command');

result = evaluateTaskDoneCloseAdmission({
  taskId: 'TASK-LIFE',
  actorId: 'captain',
  status: 'running',
  claimState: 'active',
  claimActorId: 'captain',
  hasActiveSession: true
});
assert(result.ok, 'running task with active owner claim and session must allow done close');

result = evaluateTaskResetAdmission({ taskId: 'TASK-LIFE', fromStatus: 'done', toStatus: 'open' });
if (result.ok) fail('done task reset must require reopen flow');
assert(result.code === 'ATM_TASK_RESET_DONE_REQUIRES_REOPEN', 'done reset must expose stable reopen-required code');

console.log('[lifecycle-state.test] ok');
