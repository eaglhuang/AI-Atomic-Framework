import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runLock } from '../lock.js';
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-lock-spec-'));
const taskId = 'TASK-SCOPE-0001';
const lockPath = path.join(repo, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
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
const releasedCheck = await runLock(['check', '--cwd', repo, '--task', taskId, '--owner', 'coordinator', '--json']);
assert.equal(releasedCheck.ok, false, 'released outer locks must not be reported as active even when embedded direction lock is active');
assert.equal(releasedCheck.messages[0]?.code, 'ATM_LOCK_MISSING');
assert.equal(releasedCheck.evidence.lock, null);
const acquired = await runLock(['acquire', '--cwd', repo, '--task', taskId, '--owner', 'coordinator', '--files', 'src/app.ts', '--json']);
assert.equal(acquired.ok, true, 'released lock marker should be reusable by the next acquire');
assert.equal(acquired.evidence.lock.status, undefined, 'fresh active lock should not preserve released status marker');
const activeCheck = await runLock(['check', '--cwd', repo, '--task', taskId, '--owner', 'coordinator', '--json']);
assert.equal(activeCheck.ok, true, 'freshly acquired lock should be reported as active');
assert.equal(activeCheck.messages[0]?.code, 'ATM_LOCK_FOUND');
console.log('[lock.spec] ok');
