import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareTaskForClaim } from '../../packages/cli/src/commands/tasks/claim-preparation.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-orphan-in-progress-adoption-'));
const taskId = 'TASK-ORPHAN-ADOPT-0001';

try {
  mkdirSync(path.join(repo, '.atm/history/tasks'), { recursive: true });
  writeFileSync(path.join(repo, '.atm/history/tasks', `${taskId}.json`), `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Orphan in progress fixture',
    status: 'in_progress',
    scopePaths: ['src/example.ts'],
    source: { planPath: 'docs/tasks/TASK-ORPHAN-ADOPT-0001.task.md', hash: 'sha256:test' }
  }, null, 2)}\n`);

  const result = prepareTaskForClaim({
    cwd: repo,
    taskId,
    actorId: 'captain',
    status: 'in_progress',
    parseSingleCard: () => null,
    writeTaskFiles: () => ({ diagnostics: [], writtenPaths: [] }),
    writeImportEvidence: () => null
  });

  assert.equal(result.originalStatus, 'in_progress');
  assert.equal(result.finalStatus, 'ready');
  assert.deepEqual(result.steps.map((step) => step.action), ['reserve', 'promote']);

  const task = JSON.parse(readFileSync(path.join(repo, '.atm/history/tasks', `${taskId}.json`), 'utf8'));
  assert.equal(task.status, 'ready');
  assert.equal(task.owner, 'captain');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('[orphan-in-progress-adoption] ok');
