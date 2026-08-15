import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectCrossTaskMutation, readIncidentFlag, recordIncidentFlag, reconcileStaleIncidents } from '../cross-task-mutation-guard.js';
import { classifyTerminalLifecycleOwnership } from '../historical-work-admission-attestation.js';
assert.deepEqual(classifyTerminalLifecycleOwnership({ status: 'done', claimState: null, lockReleased: true }), { decision: 'terminal', reason: 'Legacy terminal task has no claim record and no active direction lock.' }, 'legacy terminal task records without claims must not remain active scope owners');
assert.equal(classifyTerminalLifecycleOwnership({ status: 'done', claimState: null, lockReleased: false }).decision, 'inconsistent', 'a terminal task with an unreleased lock must remain fail-closed');
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-cross-task-guard-'));
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function writeText(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, value, 'utf8');
}
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo, stdio: 'ignore' });
writeJson(path.join(repo, '.atm/history/tasks/TASK-A.json'), {
    workItemId: 'TASK-A',
    status: 'running',
    claim: {
        actorId: 'actor-a',
        state: 'active',
        files: ['src/a.ts', '.atm/history/evidence/TASK-A.*']
    }
});
writeJson(path.join(repo, '.atm/history/tasks/TASK-B.json'), {
    workItemId: 'TASK-B',
    status: 'running',
    claim: {
        actorId: 'actor-b',
        state: 'active',
        files: ['src/b.ts', '.atm/history/evidence/TASK-B.*']
    }
});
writeJson(path.join(repo, '.atm/history/tasks/TASK-PLANNED.json'), {
    workItemId: 'TASK-PLANNED',
    status: 'planned',
    scopePaths: ['src/planned.ts']
});
writeText(path.join(repo, 'src/a.ts'), 'export const a = 1;\n');
writeText(path.join(repo, 'src/b.ts'), 'export const b = 1;\n');
writeText(path.join(repo, 'src/planned.ts'), 'export const planned = 1;\n');
writeText(path.join(repo, '.atm/history/evidence/TASK-B.json'), '{}\n');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repo, stdio: 'ignore' });
writeText(path.join(repo, 'src/b.ts'), 'export const b = 2;\n');
writeText(path.join(repo, '.atm/history/evidence/TASK-B.json'), '{"changed":true}\n');
writeText(path.join(repo, '.atm/history/evidence/git-head.jsonl'), '{}\n');
execFileSync('git', ['add', 'src/b.ts', '.atm/history/evidence/TASK-B.json'], { cwd: repo, stdio: 'ignore' });
const block = detectCrossTaskMutation(repo, 'TASK-A', 'pre-commit');
assert.ok(block, 'TASK-A must be blocked from mutating TASK-B owned files');
assert.equal(block.conflictTaskId, 'TASK-B');
assert.equal(block.commandFamily, 'pre-commit');
assert.deepEqual(block.conflictFiles, ['.atm/history/evidence/TASK-B.json', 'src/b.ts']);
assert.match(block.recoveryLane, /Stop write-path work/);
assert.deepEqual(block.conflicts.map((entry) => [entry.conflictTaskId, entry.owner, entry.surface, entry.conflictFiles]), [
    ['TASK-B', 'TASK-B', 'task-history', ['.atm/history/evidence/TASK-B.json']],
    ['TASK-B', 'actor-b', 'active-task-scope', ['src/b.ts']]
]);
assert.equal(detectCrossTaskMutation(repo, 'TASK-B', 'pre-commit'), null);
execFileSync('git', ['reset', '--hard', 'HEAD'], { cwd: repo, stdio: 'ignore' });
writeText(path.join(repo, 'src/b.ts'), 'export const b = 3;\n');
assert.equal(detectCrossTaskMutation(repo, 'TASK-A', 'pre-commit'), null);
assert.ok(detectCrossTaskMutation(repo, 'TASK-A', 'restore'), 'destructive command families inspect unstaged mutations');
execFileSync('git', ['reset', '--hard', 'HEAD'], { cwd: repo, stdio: 'ignore' });
writeText(path.join(repo, 'src/planned.ts'), 'export const planned = 2;\n');
execFileSync('git', ['add', 'src/planned.ts'], { cwd: repo, stdio: 'ignore' });
assert.equal(detectCrossTaskMutation(repo, 'TASK-A', 'pre-commit'), null, 'a planned task without a live claim or lock must not become a ghost scope owner');
const incidentRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-cross-task-incident-'));
execFileSync('git', ['init'], { cwd: incidentRepo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'test'], { cwd: incidentRepo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: incidentRepo, stdio: 'ignore' });
writeJson(path.join(incidentRepo, '.atm/history/tasks/TASK-A.json'), {
    workItemId: 'TASK-A',
    status: 'open',
    claim: {
        actorId: 'actor-a',
        state: 'active',
        files: ['src/a.ts']
    }
});
writeJson(path.join(incidentRepo, '.atm/history/tasks/TASK-B.json'), {
    workItemId: 'TASK-B',
    status: 'done',
    claim: {
        actorId: 'actor-b',
        state: 'released',
        files: ['src/b.ts']
    }
});
writeText(path.join(incidentRepo, 'src/a.ts'), 'export const a = 1;\n');
writeText(path.join(incidentRepo, 'src/b.ts'), 'export const b = 1;\n');
execFileSync('git', ['add', '.'], { cwd: incidentRepo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: incidentRepo, stdio: 'ignore' });
const staleBlock = {
    conflictTaskId: 'TASK-B',
    conflictFiles: ['src/b.ts'],
    commandFamily: 'pre-commit',
    recoveryLane: 'Stop write-path work.',
    conflicts: [
        {
            conflictTaskId: 'TASK-B',
            conflictFiles: ['src/b.ts'],
            owner: 'actor-b',
            surface: 'active-task-scope'
        }
    ]
};
recordIncidentFlag(incidentRepo, staleBlock);
assert.equal(readIncidentFlag(incidentRepo), null, 'resolved incidents auto-clear when git, locks, and broker are clean');
assert.equal(reconcileStaleIncidents(incidentRepo), false, 'no remaining active incidents to reconcile');
const archiveDir = path.join(incidentRepo, '.atm/runtime/incidents/archive');
assert.ok(existsSync(archiveDir), 'resolved incidents should be archived');
const archivedFiles = readdirSync(archiveDir).filter((fileName) => fileName.endsWith('.json'));
assert.equal(archivedFiles.length, 1, 'archived incident count');
const archived = JSON.parse(readFileSync(path.join(archiveDir, archivedFiles[0]), 'utf8'));
assert.equal(typeof archived.resolvedAt, 'string', 'archive should record resolution timestamp');
writeText(path.join(incidentRepo, 'src/b.ts'), 'export const b = 2;\n');
writeJson(path.join(incidentRepo, '.atm/history/tasks/TASK-B.json'), {
    workItemId: 'TASK-B',
    status: 'open',
    claim: {
        actorId: 'actor-b',
        state: 'active',
        files: ['src/b.ts']
    }
});
execFileSync('git', ['add', 'src/b.ts'], { cwd: incidentRepo, stdio: 'ignore' });
recordIncidentFlag(incidentRepo, staleBlock);
assert.ok(readIncidentFlag(incidentRepo), 'live dirty conflicts keep the incident active');
writeJson(path.join(incidentRepo, '.atm/runtime/locks/TASK-B.lock.json'), {
    schemaId: 'atm.governanceScopeLock',
    workItemId: 'TASK-B',
    lockedBy: 'actor-b'
});
execFileSync('git', ['reset', '--hard', 'HEAD'], { cwd: incidentRepo, stdio: 'ignore' });
recordIncidentFlag(incidentRepo, staleBlock);
assert.ok(readIncidentFlag(incidentRepo), 'active locks keep stale incidents from auto-clearing');
writeJson(path.join(incidentRepo, '.atm/runtime/locks/TASK-B.lock.json'), {
    schemaId: 'atm.governanceScopeLock',
    workItemId: 'TASK-B',
    status: 'released',
    released: true
});
assert.equal(readIncidentFlag(incidentRepo), null, 'released locks allow incident auto-clear');
writeJson(path.join(incidentRepo, '.atm/history/tasks/TASK-C.json'), {
    workItemId: 'TASK-C',
    status: 'done',
    claim: { actorId: 'actor-c', state: 'released' }
});
const mixedIncident = {
    conflictTaskId: 'TASK-B',
    conflictFiles: ['src/b.ts', '.atm/history/evidence/TASK-C.json'],
    commandFamily: 'pre-commit',
    recoveryLane: 'Stop write-path work.',
    conflicts: [
        {
            conflictTaskId: 'TASK-B',
            conflictFiles: ['src/b.ts'],
            owner: 'actor-b',
            surface: 'active-task-scope'
        },
        {
            conflictTaskId: 'TASK-C',
            conflictFiles: ['.atm/history/evidence/TASK-C.json'],
            owner: 'TASK-C',
            surface: 'task-history'
        }
    ]
};
recordIncidentFlag(incidentRepo, mixedIncident);
const reconciledMixedIncident = readIncidentFlag(incidentRepo);
assert.deepEqual(reconciledMixedIncident?.conflicts.map((entry) => [entry.conflictTaskId, entry.surface, entry.conflictFiles]), [['TASK-C', 'task-history', ['.atm/history/evidence/TASK-C.json']]], 'reconciliation must retain only the still-live subset instead of resurrecting a terminal source owner');
console.log('[cross-task-mutation-guard.test] ok');
