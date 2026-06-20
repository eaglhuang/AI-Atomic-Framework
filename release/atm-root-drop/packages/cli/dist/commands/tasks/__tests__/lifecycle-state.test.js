import { evaluateTaskClaimAdmission, evaluateTaskDoneCloseAdmission, evaluateTaskPromotionAdmission, evaluateTaskResetAdmission } from '../lifecycle-state.js';
function fail(message) {
    console.error(`[lifecycle-state.test] ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}
function assert(condition, message) {
    if (!condition)
        fail(message);
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
if (result.ok)
    fail('review task must reject ordinary write claim');
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
if (result.ok)
    fail('planned task must fail closed before trusted done close');
assert(result.code === 'ATM_TASK_CLOSE_INVALID_LIFECYCLE', 'planned done close must use lifecycle error code');
result = evaluateTaskDoneCloseAdmission({
    taskId: 'TASK-LIFE',
    actorId: 'captain',
    status: 'running',
    claimState: null,
    claimActorId: null,
    hasActiveSession: true
});
if (result.ok)
    fail('done close without active claim must fail closed');
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
result = evaluateTaskDoneCloseAdmission({
    taskId: 'TASK-LIFE',
    actorId: 'captain',
    status: 'planned',
    claimState: null,
    claimActorId: null,
    hasActiveSession: false,
    allowHistoricalCloseback: true
});
assert(result.ok, 'verified historical closeback must allow unclaimed imported planned tasks without a live work session');
if (!result.ok)
    fail('historical closeback without claim should be allowed before checking reason');
assert(result.reason === 'planned-to-done-historical-closeback-unclaimed', 'historical closeback without claim must expose stable unclaimed reason');
result = evaluateTaskDoneCloseAdmission({
    taskId: 'TASK-LIFE',
    actorId: 'captain',
    status: 'planned',
    claimState: 'active',
    claimActorId: 'other-agent',
    hasActiveSession: false,
    allowHistoricalCloseback: true
});
if (result.ok)
    fail('historical closeback must not bypass another actor active claim');
assert(result.code === 'ATM_TASK_CLOSE_ACTIVE_CLAIM_REQUIRED', 'historical closeback with foreign active claim must return active-claim-required code');
result = evaluateTaskDoneCloseAdmission({
    taskId: 'TASK-LIFE',
    actorId: 'captain',
    status: 'planned',
    claimState: 'active',
    claimActorId: 'captain',
    hasActiveSession: false,
    allowHistoricalCloseback: true
});
assert(result.ok, 'historical closeback must allow imported planned tasks after actor claim, even without a live work session');
result = evaluateTaskDoneCloseAdmission({
    taskId: 'TASK-LIFE',
    actorId: 'captain',
    status: 'blocked',
    claimState: 'active',
    claimActorId: 'captain',
    hasActiveSession: false,
    allowHistoricalCloseback: true
});
assert(result.ok, 'historical closeback must allow imported blocked tasks when historical delivery is verified and claimed by actor');
result = evaluateTaskResetAdmission({ taskId: 'TASK-LIFE', fromStatus: 'done', toStatus: 'open' });
if (result.ok)
    fail('done task reset must require reopen flow');
assert(result.code === 'ATM_TASK_RESET_DONE_REQUIRES_REOPEN', 'done reset must expose stable reopen-required code');
console.log('[lifecycle-state.test] ok');
