import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { routeTaskScopedCommitBranch } from './commit-task-scoped-branch.ts';
import { cleanupDeferredForeignStagedSnapshot } from './git-index-transaction.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-wip-governance-'));
try {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'ATM Test'], { cwd: root });
  mkdirSync(path.join(root, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(root, '.atm', 'history', 'task-events', 'TASK-WIP'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });

  const taskPath = path.join(root, '.atm', 'history', 'tasks', 'TASK-WIP.json');
  const eventDir = path.join(root, '.atm', 'history', 'task-events', 'TASK-WIP');
  const task = {
    workItemId: 'TASK-WIP',
    status: 'running',
    lastTransitionId: 'transition-base',
    lastTransitionAt: '2026-09-14T00:00:00.000Z',
    scopePaths: ['src/wip.ts', '.atm/history/tasks/TASK-WIP.json', '.atm/history/task-events/TASK-WIP/**'],
    targetAllowedFiles: ['src/wip.ts', '.atm/history/tasks/TASK-WIP.json', '.atm/history/task-events/TASK-WIP/**'],
    claim: {
      actorId: 'test-actor',
      leaseId: 'lease-wip',
      state: 'active',
      files: ['src/wip.ts', '.atm/history/tasks/TASK-WIP.json', '.atm/history/task-events/TASK-WIP/**'],
    },
  };
  writeFileSync(taskPath, `${JSON.stringify(task, null, 2)}\n`);
  writeFileSync(path.join(root, 'src', 'wip.ts'), 'export const wip = 1;\n');
  writeFileSync(path.join(eventDir, 'transition-base.json'), `${JSON.stringify({
    schemaId: 'atm.taskTransition.v1',
    transitionId: 'transition-base',
    taskId: 'TASK-WIP',
    taskPath: '.atm/history/tasks/TASK-WIP.json',
    taskSha256: `sha256:${createHash('sha256').update(readFileSync(taskPath)).digest('hex')}`,
    command: 'node atm.mjs tasks claim --task TASK-WIP',
  }, null, 2)}\n`);
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'wip fixture base'], { cwd: root });

  task.lastTransitionId = 'transition-wip';
  writeFileSync(taskPath, `${JSON.stringify(task, null, 2)}\n`);
  writeFileSync(path.join(root, 'src', 'wip.ts'), 'export const wip = 2;\n');
  const taskSha = `sha256:${createHash('sha256').update(readFileSync(taskPath)).digest('hex')}`;
  writeFileSync(path.join(eventDir, 'transition-wip.json'), `${JSON.stringify({
    schemaId: 'atm.taskTransition.v1',
    transitionId: 'transition-wip',
    taskId: 'TASK-WIP',
    taskPath: '.atm/history/tasks/TASK-WIP.json',
    taskSha256: taskSha,
    command: 'node atm.mjs tasks renew --task TASK-WIP',
  }, null, 2)}\n`);
  execFileSync('git', ['add', '--', '.atm/history/tasks/TASK-WIP.json', '.atm/history/task-events/TASK-WIP/transition-wip.json'], { cwd: root });

  const branch = routeTaskScopedCommitBranch({
    options: {
      cwd: root,
      taskId: 'TASK-WIP',
      dryRun: false,
      autoStage: true,
      wip: true,
      deferForeignStaged: false,
      stageOverrideLease: null,
      brokerConflictResolutionPath: null,
      deliverySliceManifestPath: null,
      deliverySliceReceiptPath: null,
      message: 'wip fixture',
    },
    actorId: 'test-actor',
    taskDocument: task,
    claim: task.claim,
    claimForTrailers: null,
    session: null,
    laneSessionId: 'lane-test',
  });
  assert.equal(branch.kind, 'resolved');
  const bundle = branch.taskScopedBundleReport;
  assert.equal(bundle.ok, true, `WIP source bundle must resolve: ${bundle.blockedCode} ${bundle.blockedSummary}`);
  assert.ok(bundle.stageFiles.includes('src/wip.ts'));
  assert.ok(!bundle.stageFiles.some((file: string) => file.startsWith('.atm/history/')));
  assert.equal(typeof branch.deferredForeignStagedSnapshotPath, 'string');
  assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' }).trim(), '');

  cleanupDeferredForeignStagedSnapshot(root, branch.deferredForeignStagedSnapshotPath);
  assert.deepEqual(
    execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean).sort(),
    ['.atm/history/task-events/TASK-WIP/transition-wip.json', '.atm/history/tasks/TASK-WIP.json'],
  );
  console.log('wip-governance-staging: protected task state parked and restored');
} finally {
  rmSync(root, { recursive: true, force: true });
}
