import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isReleasedGeneratedBundleSafeToClean,
  planReleasedResidueTransaction,
  readGeneratedResidueTaskDisposition,
  reconcileReleasedResidueReport,
} from '../generated-residue-policy.ts';

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeRepo(taskId: string, task: Record<string, unknown>, event?: Record<string, unknown>): string {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-generated-residue-'));
  writeJson(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), task);
  if (event) writeJson(path.join(cwd, '.atm', 'history', 'task-events', taskId, 'lifecycle.json'), event);
  return cwd;
}

const releasedRepo = makeRepo('TASK-GENERIC-1', {
  taskId: 'TASK-GENERIC-1', status: 'open', claim: { state: 'released' },
}, { action: 'release', createdAt: '2026-08-09T13:07:48.728Z' });
const releasedDisposition = readGeneratedResidueTaskDisposition(releasedRepo, 'TASK-GENERIC-1');
assert.equal(isReleasedGeneratedBundleSafeToClean(releasedDisposition), true);

const terminalOwnerRepo = makeRepo('TASK-GENERIC-TERMINAL', {
  taskId: 'TASK-GENERIC-TERMINAL', status: 'done', claim: { state: 'released', owner: 'prior-agent' },
}, { action: 'release', createdAt: '2026-08-09T13:07:48.728Z' });
assert.equal(
  isReleasedGeneratedBundleSafeToClean(readGeneratedResidueTaskDisposition(terminalOwnerRepo, 'TASK-GENERIC-TERMINAL')),
  true,
  'terminal owner attribution must not be mistaken for an active lease',
);

const activeRepo = makeRepo('TASK-GENERIC-2', {
  taskId: 'TASK-GENERIC-2', status: 'running', claim: { state: 'active', owner: 'agent' },
}, { action: 'release', createdAt: '2026-08-09T13:07:48.728Z' });
assert.equal(isReleasedGeneratedBundleSafeToClean(readGeneratedResidueTaskDisposition(activeRepo, 'TASK-GENERIC-2')), false);

const ambiguousRepo = makeRepo('TASK-GENERIC-3', {
  taskId: 'TASK-GENERIC-3', status: 'open', claim: { state: 'released' },
});
assert.equal(isReleasedGeneratedBundleSafeToClean(readGeneratedResidueTaskDisposition(ambiguousRepo, 'TASK-GENERIC-3')), false);

const nullIdentityPlan = planReleasedResidueTransaction({
  cwd: ambiguousRepo,
  candidateTaskId: null as unknown as string,
  ownerTaskIds: [null as unknown as string],
});
assert.equal(nullIdentityPlan.disposition, 'not-eligible');

const terminalForeignReport = reconcileReleasedResidueReport(releasedRepo, null as unknown as string, {
  autoCleanSafe: [],
  blockAndExplain: [{ path: '.atm/history/evidence/TASK-GENERIC-1.closure-packet.json', ownerTaskId: 'TASK-GENERIC-1' }],
  manualReview: [{ path: '.atm/history/task-events/TASK-GENERIC-1/close.json', ownerTaskId: 'TASK-GENERIC-1' }],
});
assert.deepEqual(terminalForeignReport.blockAndExplain, []);
assert.deepEqual(terminalForeignReport.manualReview, []);

writeJson(path.join(releasedRepo, '.atm', 'history', 'tasks', 'TASK-GENERIC-ACTIVE.json'), {
  taskId: 'TASK-GENERIC-ACTIVE', status: 'running', claim: { state: 'active', owner: 'agent' },
});
const mixedForeignReport = reconcileReleasedResidueReport(releasedRepo, 'TASK-CANDIDATE', {
  autoCleanSafe: [],
  blockAndExplain: [
    { path: '.atm/history/evidence/TASK-GENERIC-1.closure-packet.json', ownerTaskId: 'TASK-GENERIC-1' },
    { path: '.atm/history/evidence/TASK-GENERIC-ACTIVE.closure-packet.json', ownerTaskId: 'TASK-GENERIC-ACTIVE' },
  ],
  manualReview: [],
});
assert.deepEqual(mixedForeignReport.blockAndExplain.map((entry) => entry.ownerTaskId), ['TASK-GENERIC-ACTIVE']);

console.log('generated-residue-policy: ok');
