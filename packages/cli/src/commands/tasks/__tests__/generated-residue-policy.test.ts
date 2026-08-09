import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isReleasedGeneratedBundleSafeToClean,
  readGeneratedResidueTaskDisposition,
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

const activeRepo = makeRepo('TASK-GENERIC-2', {
  taskId: 'TASK-GENERIC-2', status: 'running', claim: { state: 'active', owner: 'agent' },
}, { action: 'release', createdAt: '2026-08-09T13:07:48.728Z' });
assert.equal(isReleasedGeneratedBundleSafeToClean(readGeneratedResidueTaskDisposition(activeRepo, 'TASK-GENERIC-2')), false);

const ambiguousRepo = makeRepo('TASK-GENERIC-3', {
  taskId: 'TASK-GENERIC-3', status: 'open', claim: { state: 'released' },
});
assert.equal(isReleasedGeneratedBundleSafeToClean(readGeneratedResidueTaskDisposition(ambiguousRepo, 'TASK-GENERIC-3')), false);

console.log('generated-residue-policy: ok');
