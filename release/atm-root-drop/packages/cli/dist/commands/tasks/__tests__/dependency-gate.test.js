import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { areTaskDependenciesSatisfied, findTaskClaimDependencyBlockers } from '../dependency-gate.js';
function fail(message) {
    console.error(`[dependency-gate.test] ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}
function assert(condition, message) {
    if (!condition)
        fail(message);
}
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function writeTask(repo, taskId, document) {
    writeJson(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: taskId,
        ...document
    });
}
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-dependency-gate-'));
writeTask(repo, 'TASK-DEP-PLANNED', { status: 'planned' });
let blockers = findTaskClaimDependencyBlockers(repo, 'TASK-CONSUMER', {
    status: 'ready',
    dependencies: ['TASK-DEP-PLANNED']
});
assert(blockers.length === 1, 'planned dependency must block claim');
assert(blockers[0]?.status === 'planned', 'planned dependency blocker must preserve normalized status');
writeTask(repo, 'TASK-DEP-MANUAL-DONE', { status: 'done' });
blockers = findTaskClaimDependencyBlockers(repo, 'TASK-CONSUMER', {
    status: 'ready',
    dependencies: ['TASK-DEP-MANUAL-DONE']
});
assert(blockers.length === 1, 'source-done dependency without closeout provenance must block claim');
assert(blockers[0]?.status === 'source-done-governance-incomplete', 'manual done blocker must use governed closeout bucket');
assert(String(blockers[0]?.requiredCommand).includes('tasks repair-closure'), 'manual done blocker must point to repair-closure recovery');
writeJson(path.join(repo, '.atm', 'history', 'evidence', 'TASK-DEP-CLOSED.closure-packet.json'), {
    schemaId: 'atm.closurePacket.v1',
    taskId: 'TASK-DEP-CLOSED'
});
writeTask(repo, 'TASK-DEP-CLOSED', {
    status: 'done',
    closurePacket: '.atm/history/evidence/TASK-DEP-CLOSED.closure-packet.json'
});
blockers = findTaskClaimDependencyBlockers(repo, 'TASK-CONSUMER', {
    status: 'ready',
    dependencies: ['TASK-DEP-CLOSED']
});
assert(blockers.length === 0, 'dependency with governed closeout provenance must not block claim');
const statusById = new Map([
    ['TASK-DEP-MANUAL-DONE', 'done'],
    ['TASK-DEP-CLOSED', 'done']
]);
assert(!areTaskDependenciesSatisfied({ workItemId: 'TASK-CONSUMER', dependencies: ['TASK-DEP-MANUAL-DONE'] }, statusById, repo), 'next dependency eligibility must reject source-done without governed closeout provenance');
assert(areTaskDependenciesSatisfied({ workItemId: 'TASK-CONSUMER', dependencies: ['TASK-DEP-CLOSED'] }, statusById, repo), 'next dependency eligibility must accept governed closeout provenance');
writeTask(repo, 'TASK-DEP-PLANNING-AUTHORITY', {
    status: 'done',
    closureAuthority: 'planning_repo'
});
assert(areTaskDependenciesSatisfied({ workItemId: 'TASK-CONSUMER', dependencies: ['TASK-DEP-PLANNING-AUTHORITY'] }, new Map([['TASK-DEP-PLANNING-AUTHORITY', 'done']]), repo), 'planning_repo authority dependencies must remain exempt from target closure packet enforcement');
console.log('[dependency-gate.test] ok');
