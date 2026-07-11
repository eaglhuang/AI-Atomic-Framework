import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
const lockAfter = readJson(lockPath);
assert.equal(lockAfter.status, 'released', 'outer lock remains a release marker');
assert.equal(lockAfter.taskDirectionLock.status, 'released', 'embedded direction lock must no longer remain active');
assert.equal(lockAfter.taskDirectionLock.released, true, 'embedded direction lock release must be explicit');
console.log('[lock-cleanup.spec] ok');
