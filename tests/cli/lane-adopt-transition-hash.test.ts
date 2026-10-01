import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rebindLifecycleAfterLaneAdopt } from '../../packages/cli/src/commands/lane-session/adopt-rebind.ts';
import { writeTaskDocumentWithTransition } from '../../packages/cli/src/commands/tasks/close-helpers/task-transition-writer.ts';
import type { LaneSessionDocument } from '../../packages/cli/src/commands/lane-session/store.ts';

const TASK = 'TASK-ADOPT-0001';
const LANE = 'lane-adopt-hash';
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-lane-adopt-hash-'));

try {
  const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${TASK}.json`);
  mkdirSync(path.dirname(taskPath), { recursive: true });
  const claimedAt = new Date().toISOString();
  // A normal active task: its last transition was written by the governed writer.
  writeTaskDocumentWithTransition({
    cwd: repo,
    taskPath,
    taskId: TASK,
    taskDocument: {
      workItemId: TASK,
      status: 'in-progress',
      owner: 'agent-a',
      claim: {
        actorId: 'agent-a', leaseId: 'lease-adopt-1', claimedAt, heartbeatAt: claimedAt, ttlSeconds: 1800,
        state: 'active', files: ['src/a.ts'], intent: 'edit src/a.ts',
        laneSession: { laneSessionId: LANE, status: 'active', source: 'option', exportHint: `export ATM_LANE_SESSION_ID="${LANE}"` }
      }
    },
    action: 'claim',
    actorId: 'agent-a',
    previousStatus: 'open',
    command: `node atm.mjs tasks claim --task ${TASK} --actor agent-a --json`
  });

  const result = rebindLifecycleAfterLaneAdopt({
    cwd: repo,
    laneId: LANE,
    actorId: 'agent-b',
    session: { laneId: LANE, actorId: 'agent-b', taskId: TASK, status: 'active' } as unknown as LaneSessionDocument
  });
  assert.deepEqual(result.reboundTaskIds, [TASK]);

  const taskBytes = readFileSync(taskPath);
  const task = JSON.parse(taskBytes.toString('utf8'));
  assert.equal(task.claim.actorId, 'agent-b');
  assert.equal(task.claim.leaseId, 'lease-adopt-1', 'adopt preserves the lease');
  assert.deepEqual(task.claim.files, ['src/a.ts'], 'adopt preserves the scope');
  assert.equal(task.claim.intent, 'edit src/a.ts', 'adopt preserves the intent');
  assert.equal(task.owner, 'agent-b', 'the ledger owner follows the adopted claim');

  // The same checks the pre-commit task-ledger gate applies.
  const eventPath = path.join(repo, '.atm', 'history', 'task-events', TASK, `${task.lastTransitionId}.json`);
  assert.ok(existsSync(eventPath), 'the task points at a persisted transition event');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  assert.equal(event.schemaId, 'atm.taskTransition.v1');
  assert.equal(event.action, 'adopt');
  assert.equal(event.taskPath, `.atm/history/tasks/${TASK}.json`);
  assert.ok(String(event.command).startsWith('node atm.mjs '));
  assert.equal(event.taskSha256, `sha256:${createHash('sha256').update(taskBytes).digest('hex')}`,
    'the transition hash matches the rebound task document');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('ok: lane adopt writes the claim rebind and its transition together');
