import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTasks } from '../legacy-impl.js';
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function readJson(filePath) {
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
const cleanup = await runTasks(['lock', 'cleanup', '--cwd', repo, '--task', taskId, '--actor', 'coordinator', '--json']);
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
const activeCleanup = await runTasks(['lock', 'cleanup', '--cwd', activeLockRepo, '--task', activeTaskId, '--actor', 'coordinator', '--json']);
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
assert.equal(existsSync(activeSidecarPath), false, 'direction sidecar must be removed');
console.log('[lock-cleanup.spec] ok');
