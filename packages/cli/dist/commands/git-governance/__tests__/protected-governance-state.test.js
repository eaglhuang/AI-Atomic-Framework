import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectProtectedGovernanceStateDestructiveChanges } from '../protected-governance-state.js';
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-protected-gov-state-'));
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo, stdio: 'ignore' });
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
const OWNER = 'TASK-OWN-0001';
const SUCCESSOR = 'TASK-NEXT-0002';
const residue = `.atm/history/evidence/${OWNER}.bundle-manifest.json`;
writeJson(path.join(repo, residue), { schemaId: 'atm.bundleManifest.v1' });
execFileSync('git', ['add', '--', residue], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'seed'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['rm', '--', residue], { cwd: repo, stdio: 'ignore' });
writeJson(path.join(repo, '.atm', 'history', 'tasks', `${OWNER}.json`), {
    workItemId: OWNER,
    status: 'done',
    claim: { actorId: 'owner', state: 'released' }
});
writeJson(path.join(repo, '.atm', 'history', 'tasks', `${SUCCESSOR}.json`), {
    workItemId: SUCCESSOR,
    status: 'running',
    claim: { actorId: 'successor', state: 'active' }
});
writeJson(path.join(repo, '.atm', 'runtime', 'locks', `${SUCCESSOR}.lock.json`), {
    workItemId: SUCCESSOR,
    actorId: 'successor',
    heartbeatAt: new Date().toISOString(),
    ttlSeconds: 1800,
    released: false,
    status: 'active',
    files: [`.atm/history/tasks/${SUCCESSOR}.json`]
});
writeJson(path.join(repo, '.atm', 'runtime', 'locks', `ATM-FRAMEWORK-TEMP-successor-lane-lane-test.lock.json`), {
    workItemId: 'ATM-FRAMEWORK-TEMP-successor-lane-lane-test',
    actorId: 'successor',
    heartbeatAt: new Date().toISOString(),
    ttlSeconds: 1800,
    released: false,
    status: 'active',
    linkedTaskId: SUCCESSOR,
    files: [residue]
});
{
    const blocked = inspectProtectedGovernanceStateDestructiveChanges({
        cwd: repo,
        taskId: 'TASK-OTHER-0003',
        commitFiles: [residue]
    });
    assert.equal(blocked.ok, false, 'an unentitled writer must not delete another task evidence record');
}
{
    const allowed = inspectProtectedGovernanceStateDestructiveChanges({
        cwd: repo,
        taskId: SUCCESSOR,
        commitFiles: [residue]
    });
    assert.equal(allowed.ok, true, 'a live successor with a linked temporary writer admitted for the generated bundle-manifest may converge the deletion');
}
{
    const ledger = `.atm/history/tasks/${OWNER}.json`;
    writeJson(path.join(repo, ledger), { workItemId: OWNER, status: 'done' });
    execFileSync('git', ['add', '--', ledger], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'seed-ledger'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['rm', '--', ledger], { cwd: repo, stdio: 'ignore' });
    const blocked = inspectProtectedGovernanceStateDestructiveChanges({
        cwd: repo,
        taskId: SUCCESSOR,
        commitFiles: [ledger]
    });
    assert.equal(blocked.ok, false, 'a live successor still cannot delete another task ledger');
}
console.log('[protected-governance-state] ok');
