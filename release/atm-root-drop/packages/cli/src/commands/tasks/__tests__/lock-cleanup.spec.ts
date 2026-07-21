import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-lock-cleanup-spec-'));
const taskId = 'TASK-SCOPE-CLEANUP-0001';
const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);
const lockPath = path.join(repo, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);

writeJson(taskPath, {
  workItemId: taskId,
  title: taskId,
  status: 'done',
  claim: {
    state: 'released',
    actorId: 'coordinator'
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
  lockedBy: 'coordinator',
  taskDirectionLock: {
    schemaId: 'atm.taskDirectionLock.v1',
    taskId,
    status: 'active',
    allowedFiles: ['src/app.ts']
  }
});

const cleanup = await runTasks(['lock', 'cleanup', '--cwd', repo, '--task', taskId, '--actor', 'coordinator', '--json']) as any;
assert.equal(cleanup.ok, true, 'released lock cleanup should succeed');
assert.ok(cleanup.evidence.staleReasons.includes('released-lock'), 'released lock must be recognized as stale');
assert.ok(cleanup.evidence.cleanupActions.includes('released-embedded-direction-lock'), 'cleanup must report embedded direction lock release');
assert.ok(cleanup.evidence.cleanupActions.includes('released-canonical-direction-lock'), 'cleanup must report canonical direction lock release');

const lockAfter = readJson(lockPath);
const taskAfter = readJson(taskPath);
assert.equal(lockAfter.status, 'released', 'outer lock remains a release marker');
assert.equal(lockAfter.taskDirectionLock.status, 'released', 'embedded direction lock must no longer remain active');
assert.equal(lockAfter.taskDirectionLock.released, true, 'embedded direction lock release must be explicit');
assert.equal(taskAfter.taskDirectionLock.status, 'released', 'canonical direction lock must no longer remain active');
assert.equal(taskAfter.taskDirectionLock.released, true, 'canonical direction lock release must be explicit');
assert.ok(taskAfter.lastTransitionId, 'direction-lock cleanup must write a governed transition');
assert.ok(
  existsSync(path.join(repo, '.atm/history/task-events', taskId, `${taskAfter.lastTransitionId}.json`)),
  'direction-lock cleanup must create a matching task-event file'
);

const activeLockRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-lock-cleanup-active-spec-'));
const activeTaskId = 'TASK-SCOPE-CLEANUP-0002';
const activeTaskPath = path.join(activeLockRepo, '.atm', 'history', 'tasks', `${activeTaskId}.json`);
const activeLockPath = path.join(activeLockRepo, '.atm', 'runtime', 'locks', `${activeTaskId}.lock.json`);
const activeSidecarPath = path.join(activeLockRepo, '.atm', 'runtime', 'task-direction-locks', `${activeTaskId}.json`);

writeJson(activeTaskPath, {
  workItemId: activeTaskId,
  title: activeTaskId,
  status: 'done',
  claim: {
    state: 'released',
    actorId: 'coordinator'
  },
  taskDirectionLock: {
    schemaId: 'atm.taskDirectionLock.v1',
    taskId: activeTaskId,
    status: 'active',
    allowedFiles: ['src/app.ts']
  }
});
writeJson(activeLockPath, {
  schemaId: 'atm.governanceScopeLock',
  workItemId: activeTaskId,
  status: 'active',
  lockedBy: 'coordinator',
  taskDirectionLock: {
    schemaId: 'atm.taskDirectionLock.v1',
    taskId: activeTaskId,
    status: 'active',
    allowedFiles: ['src/app.ts']
  }
});
writeJson(activeSidecarPath, {
  schemaId: 'atm.taskDirectionLock.v1',
  taskId: activeTaskId,
  status: 'active',
  allowedFiles: ['src/app.ts']
});

const activeCleanup = await runTasks(['lock', 'cleanup', '--cwd', activeLockRepo, '--task', activeTaskId, '--actor', 'coordinator', '--json']) as any;
assert.equal(activeCleanup.ok, true, 'active lock cleanup on terminal task should succeed');
assert.ok(activeCleanup.evidence.cleanupActions.includes('released-governance-lock'), 'active lock cleanup must release governance lock');
assert.ok(activeCleanup.evidence.cleanupActions.includes('released-embedded-direction-lock'), 'active lock cleanup must release embedded direction lock');
assert.ok(activeCleanup.evidence.cleanupActions.includes('released-canonical-direction-lock'), 'active lock cleanup must release canonical direction lock');
assert.ok(activeCleanup.evidence.cleanupActions.includes('removed-direction-sidecar'), 'active lock cleanup must remove direction sidecar');

const activeLockAfter = readJson(activeLockPath);
const activeTaskAfter = readJson(activeTaskPath);
assert.equal(activeLockAfter.status, 'released', 'active lock cleanup must leave a released governance marker');
assert.equal(activeLockAfter.taskDirectionLock.status, 'released', 'embedded direction lock must sync after governance release');
assert.equal(activeTaskAfter.taskDirectionLock.status, 'released', 'canonical direction lock must sync after governance release');
assert.ok(activeTaskAfter.lastTransitionId, 'active lock cleanup must write a governed transition');
assert.ok(
  existsSync(path.join(activeLockRepo, '.atm/history/task-events', activeTaskId, `${activeTaskAfter.lastTransitionId}.json`)),
  'active lock cleanup must create a matching task-event file'
);
assert.equal(existsSync(activeSidecarPath), false, 'direction sidecar must be removed');

const brokerCleanupRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-lock-cleanup-broker-spec-'));
const brokerTaskId = 'TASK-SCOPE-CLEANUP-0003';
const brokerActorId = 'coordinator';
writeJson(path.join(brokerCleanupRepo, '.atm/history/tasks', `${brokerTaskId}.json`), {
  workItemId: brokerTaskId,
  title: brokerTaskId,
  status: 'done',
  claim: { state: 'active', actorId: brokerActorId, heartbeatAt: new Date().toISOString() }
});
writeJson(path.join(brokerCleanupRepo, '.atm/runtime/locks', `${brokerTaskId}.lock.json`), {
  schemaId: 'atm.governanceScopeLock',
  workItemId: brokerTaskId,
  status: 'active',
  lockedBy: brokerActorId
});
writeJson(path.join(brokerCleanupRepo, '.atm/runtime/write-broker.registry.json'), {
  schemaId: 'atm.writeBrokerRegistry.v1',
  specVersion: '0.1.0',
  repoId: 'fixture',
  workspaceId: 'main',
  currentEpoch: 1,
  activeIntents: [{
    intentId: 'intent-terminal',
    taskId: brokerTaskId,
    actorId: brokerActorId,
    baseCommit: 'base',
    resourceKeys: { files: ['release/atm-onefile/atm.mjs'], atomIds: [], atomCids: [], generators: [], projections: [], registries: [], validators: [], artifacts: [] },
    leaseEpoch: 1,
    leaseSeconds: 1800,
    leaseMaxSeconds: 1800,
    heartbeatAt: '2026-07-21T00:00:00.000Z',
    lane: 'direct-brokered',
    expiresAt: '2099-01-01T00:00:00.000Z'
  }]
});
writeJson(path.join(brokerCleanupRepo, '.atm/runtime/runner-sync-steward-queue.json'), {
  schemaId: 'atm.runnerSyncStewardQueue.v1',
  specVersion: '0.1.0',
  stewardKey: 'atm.runner-sync.coalescing-steward',
  updatedAt: '2026-07-21T00:00:00.000Z',
  groups: [{
    stewardWorkId: 'runner-sync-terminal',
    sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
    waveId: null,
    surfaceFamily: 'runner-sync',
    queuePosition: 1,
    status: 'queue-head',
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    requestedSurfaces: ['release/atm-onefile/atm.mjs'],
    waitingTasks: [brokerTaskId],
    suggestedNextAction: 'run runner sync',
    requests: [{
      taskId: brokerTaskId,
      actorId: brokerActorId,
      sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
      requestedSurfaces: ['release/atm-onefile/atm.mjs'],
      waveId: null,
      surfaceFamily: 'runner-sync',
      validators: [],
      createdAt: '2026-07-21T00:00:00.000Z',
      heartbeatAt: '2026-07-21T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      ttlSeconds: 1800,
      queuePosition: 1,
      suggestedNextAction: 'run runner sync'
    }]
  }]
});

const brokerCleanup = await runTasks(['lock', 'cleanup', '--cwd', brokerCleanupRepo, '--task', brokerTaskId, '--actor', brokerActorId, '--json']) as any;
assert.equal(brokerCleanup.ok, true, 'terminal lock cleanup should succeed with broker residue');
assert.ok(brokerCleanup.evidence.cleanupActions.includes('released-terminal-broker-intents'), 'terminal cleanup must release broker write intents');
const brokerRegistryAfter = readJson(path.join(brokerCleanupRepo, '.atm/runtime/write-broker.registry.json'));
assert.equal(brokerRegistryAfter.activeIntents.length, 0, 'terminal cleanup must remove broker active intent for the task');
const runnerSyncQueueAfter = readJson(path.join(brokerCleanupRepo, '.atm/runtime/runner-sync-steward-queue.json'));
assert.equal(runnerSyncQueueAfter.groups.length, 0, 'terminal cleanup must remove runner-sync steward requests for the task');

console.log('[lock-cleanup.spec] ok');
