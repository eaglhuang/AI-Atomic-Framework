import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTasks } from '../legacy-impl.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath: string): any {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-claim-release-transition-'));
const taskId = 'TASK-CLAIM-RELEASE-0001';
const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);
const lockPath = path.join(repo, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
const eventDir = path.join(repo, '.atm', 'history', 'task-events', taskId);

writeJson(taskPath, {
  workItemId: taskId,
  title: taskId,
  status: 'done',
  lastTransitionId: '2026-07-14T00-00-00-000Z-close-old',
  claim: {
    actorId: 'cursor-grok-4.5',
    leaseId: 'lease-claim-release',
    claimedAt: '2026-07-14T00:00:00.000Z',
    heartbeatAt: '2026-07-14T00:00:00.000Z',
    files: ['src/app.ts'],
    state: 'active'
  },
  taskDirectionLock: {
    schemaId: 'atm.taskDirectionLock.v1',
    taskId,
    status: 'active',
    allowedFiles: ['src/app.ts']
  }
});
writeJson(lockPath, {
  schemaId: 'atm.governanceScopeLock',
  workItemId: taskId,
  status: 'released',
  released: true,
  lockedBy: 'cursor-grok-4.5',
  taskDirectionLock: {
    schemaId: 'atm.taskDirectionLock.v1',
    taskId,
    status: 'active',
    allowedFiles: ['src/app.ts']
  }
});

const cleanup = await runTasks([
  'lock',
  'cleanup',
  '--cwd', repo,
  '--task', taskId,
  '--actor', 'cursor-grok-4.5',
  '--json'
]) as any;

assert.equal(cleanup.ok, true, 'lock cleanup should succeed for terminal task with stale active claim');
assert.ok(
  cleanup.evidence.cleanupActions.includes('released-terminal-active-claim'),
  'cleanup must release terminal active claim'
);
assert.ok(cleanup.evidence.transitionPath, 'cleanup must record a transition path');

const taskAfter = readJson(taskPath);
assert.equal(taskAfter.claim.state, 'released', 'claim must be released on the ledger');
assert.notEqual(taskAfter.lastTransitionId, '2026-07-14T00-00-00-000Z-close-old', 'ledger must advance lastTransitionId');

const transitionPath = path.join(repo, cleanup.evidence.transitionPath.replace(/\\/g, '/'));
assert.ok(existsSync(transitionPath), 'matching task-event transition must exist on disk');
const transition = readJson(transitionPath);
assert.equal(transition.schemaId, 'atm.taskTransition.v1');
assert.equal(transition.action, 'lock-cleanup');
assert.equal(transition.taskId, taskId);
assert.match(transition.command, /tasks lock cleanup/);

const eventFiles = readdirSync(eventDir).filter((entry) => entry.endsWith('.json'));
assert.ok(eventFiles.includes(path.basename(transitionPath)), 'event directory must contain the new transition');

console.log('[claim-release-transition.spec] ok');
