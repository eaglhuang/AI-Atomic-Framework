import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTaskWorkAdmissionFiles } from '../../packages/cli/src/commands/tasks/claim-work-admission.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-git-head-owner-'));
const receiptPath = path.join(root, '.atm/history/evidence/git-head.jsonl');
const gitHead = '.atm/history/evidence/git-head.jsonl';
const task = (id: string) => ({ workItemId: id, scopePaths: ['packages/example.ts'] });

try {
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify({ evidence: [{ details: { taskId: 'TASK-OWNER-0001' } }] })}\n`, 'utf8');
  assert.ok(resolveTaskWorkAdmissionFiles(task('TASK-OWNER-0001'), [], root).includes(gitHead));
  assert.ok(!resolveTaskWorkAdmissionFiles(task('TASK-OTHER-0002'), [], root).includes(gitHead));

  writeFileSync(receiptPath, `${JSON.stringify({ evidence: [{ details: {} }] })}\n`, 'utf8');
  assert.ok(!resolveTaskWorkAdmissionFiles(task('TASK-OWNER-0001'), [], root).includes(gitHead));
  console.log(JSON.stringify({ marker: '[git-head-admission-owner-boundary] ok' }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
