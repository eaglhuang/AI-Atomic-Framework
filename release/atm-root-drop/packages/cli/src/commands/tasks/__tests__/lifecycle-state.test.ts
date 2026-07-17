import {
  evaluateTaskClaimAdmission,
  evaluateTaskDoneCloseAdmission,
  evaluateTaskPromotionAdmission,
  evaluateTaskResetAdmission
} from '../lifecycle-state.ts';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeTaskDirectionLock } from '../../task-direction.ts';
import { parseClaimRecord } from '../task-ledger-readers.ts';

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
if (!result.ok) fail('historical closeback without claim should be allowed before checking reason');
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
if (result.ok) fail('historical closeback must not bypass another actor active claim');
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
if (result.ok) fail('done task reset must require reopen flow');
assert(result.code === 'ATM_TASK_RESET_DONE_REQUIRES_REOPEN', 'done reset must expose stable reopen-required code');

const laneSession = {
  laneSessionId: 'lane-fixture',
  status: 'active',
  source: 'minted',
  exportHint: 'export ATM_LANE_SESSION_ID="lane-fixture"'
};
const parsedClaim = parseClaimRecord({
  actorId: 'captain',
  leaseId: 'lease-fixture',
  claimedAt: '2026-07-16T00:00:00.000Z',
  heartbeatAt: '2026-07-16T00:00:00.000Z',
  ttlSeconds: 1800,
  files: ['packages/cli/src/commands/task-direction.ts'],
  state: 'active',
  laneSession
});
assert(parsedClaim?.laneSession?.laneSessionId === laneSession.laneSessionId, 'claim parser must preserve lane session metadata');

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-direction-lane-'));
writeTaskDirectionLock({
  cwd: repo,
  taskId: 'TASK-LIFE',
  actorId: 'captain',
  queue: null,
  allowedFiles: ['packages/cli/src/commands/task-direction.ts'],
  laneSession
});
const sidecar = JSON.parse(readFileSync(path.join(repo, '.atm/runtime/task-direction-locks/TASK-LIFE.json'), 'utf8'));
assert(sidecar.laneSession?.laneSessionId === laneSession.laneSessionId, 'direction lock must stamp lane session metadata');

console.log('[lifecycle-state.test] ok');
