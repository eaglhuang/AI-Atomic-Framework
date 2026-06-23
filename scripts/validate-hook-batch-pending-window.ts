import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectProtectedAtmStateChanges } from '../packages/cli/src/commands/hook.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error(`[hook-batch-pending-window] FAIL ${message}`);
    process.exit(1);
  }
}

function git(cwd: string, args: readonly string[]) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-hook-batch-pending-window-'));

try {
  git(tempRoot, ['init']);
  mkdirSync(path.join(tempRoot, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(tempRoot, '.atm', 'history', 'task-events', 'TASK-X'), { recursive: true });
  mkdirSync(path.join(tempRoot, '.atm', 'history', 'evidence', 'git-boundary-runs'), { recursive: true });
  mkdirSync(path.join(tempRoot, '.atm', 'runtime', 'batch-runs'), { recursive: true });
  mkdirSync(path.join(tempRoot, 'docs'), { recursive: true });

  const taskPayload = {
    workItemId: 'TASK-X',
    status: 'done',
    lastTransitionId: 'close-1',
    scopePaths: [
      '.atm/history/evidence/TASK-OTHER.bundle-manifest.json',
      '.atm/history/evidence/git-boundary-runs/example.json',
      'docs/example.md'
    ]
  };
  const taskText = `${JSON.stringify(taskPayload, null, 2)}\n`;
  writeFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', 'TASK-X.json'), taskText, 'utf8');
  const taskSha256 = `sha256:${createHash('sha256').update(taskText).digest('hex')}`;
  writeFileSync(path.join(tempRoot, '.atm', 'history', 'task-events', 'TASK-X', 'close-1.json'), JSON.stringify({
    schemaId: 'atm.taskTransition.v1',
    transitionId: 'close-1',
    taskId: 'TASK-X',
    taskPath: '.atm/history/tasks/TASK-X.json',
    taskSha256,
    command: 'node atm.mjs tasks close --task TASK-X --from-batch-checkpoint --batch batch-demo --json',
    closure: {
      schemaId: 'atm.taskClosureTransition.v1',
      batchId: 'batch-demo'
    }
  }, null, 2));
  writeFileSync(path.join(tempRoot, '.atm', 'history', 'evidence', 'TASK-X.json'), JSON.stringify({
    taskId: 'TASK-X'
  }, null, 2));
  writeFileSync(path.join(tempRoot, '.atm', 'history', 'evidence', 'TASK-X.closure-packet.json'), JSON.stringify({
    taskId: 'TASK-X'
  }, null, 2));
  writeFileSync(path.join(tempRoot, '.atm', 'history', 'evidence', 'TASK-OTHER.bundle-manifest.json'), JSON.stringify({
    taskId: 'TASK-OTHER'
  }, null, 2));
  writeFileSync(path.join(tempRoot, '.atm', 'history', 'evidence', 'git-boundary-runs', 'example.json'), JSON.stringify({
    scenario: 'pending-batch-window'
  }, null, 2));
  writeFileSync(path.join(tempRoot, '.atm', 'runtime', 'batch-runs', 'batch-demo.json'), JSON.stringify({
    schemaId: 'atm.batchRun.v1',
    batchId: 'batch-demo',
    status: 'active',
    taskIds: ['TASK-X'],
    currentTaskId: 'TASK-NEXT'
  }, null, 2));
  writeFileSync(path.join(tempRoot, 'docs', 'example.md'), 'deliverable\n', 'utf8');

  const staged = [
    '.atm/history/tasks/TASK-X.json',
    '.atm/history/task-events/TASK-X/close-1.json',
    '.atm/history/evidence/TASK-X.json',
    '.atm/history/evidence/TASK-X.closure-packet.json',
    '.atm/history/evidence/TASK-OTHER.bundle-manifest.json',
    '.atm/history/evidence/git-boundary-runs/example.json',
    'docs/example.md'
  ];
  git(tempRoot, ['add', '--', ...staged]);

  const report = inspectProtectedAtmStateChanges(tempRoot, staged);
  assert(
    !report.findings.some((finding) => finding.reason === 'evidence-file-missing-task-context'),
    'pending batch checkpoint window should authorize covered evidence artifacts'
  );

  console.log('[hook-batch-pending-window] ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
