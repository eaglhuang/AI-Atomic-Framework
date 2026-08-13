import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runTaskflow } from '../../packages/cli/src/commands/taskflow.ts';
import { makeDualRepoCloseFixture, writeJson } from '../../packages/cli/src/commands/taskflow/__tests__/dryrun/fixtures.ts';

const fixture = await makeDualRepoCloseFixture('governance-dirty-fail-fast');

try {
  const taskEventPath = path.join(
    fixture.targetRepo,
    '.atm/history/task-events',
    fixture.taskId,
    'prior-close-residue.json'
  );
  writeJson(taskEventPath, {
    schemaId: 'atm.taskTransition.v1',
    taskId: fixture.taskId,
    action: 'close',
    createdAt: '2026-08-14T00:00:00.000Z'
  });
  execFileSync('git', ['add', '--', path.relative(fixture.targetRepo, taskEventPath)], { cwd: fixture.targetRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'seed prior close residue'], { cwd: fixture.targetRepo, stdio: 'ignore' });
  rmSync(taskEventPath);

  const taskPath = path.join(fixture.targetRepo, '.atm/history/tasks', `${fixture.taskId}.json`);
  const taskBeforeWrite = readFileSync(taskPath, 'utf8');
  const dryRun = await runTaskflow([
    'close', '--cwd', fixture.targetRepo, '--task', fixture.taskId,
    '--actor', 'validator', '--historical-delivery', fixture.deliveryCommit, '--json'
  ]) as any;
  const blocker = dryRun.evidence.writeReadinessHint.blockers.find(
    (entry: { code: string }) => entry.code === 'ATM_TASK_CLOSE_DIRTY_WORKTREE'
  );
  assert.ok(blocker, 'dry-run must disclose the exact backend dirty-worktree code');
  assert.deepEqual(
    dryRun.evidence.historicalClosePreflight.dirtyGuard.governanceTrackedDirtyFiles,
    [`.atm/history/task-events/${fixture.taskId}/prior-close-residue.json`]
  );

  await assert.rejects(
    () => runTaskflow([
      'close', '--cwd', fixture.targetRepo, '--task', fixture.taskId,
      '--actor', 'validator', '--historical-delivery', fixture.deliveryCommit,
      '--write', '--json'
    ]),
    (error: any) => error?.code === 'ATM_TASK_CLOSE_DIRTY_WORKTREE'
  );
  assert.equal(
    existsSync(path.join(fixture.targetRepo, '.atm/runtime/locks/close-window-staged-index.lock.json')),
    false,
    'the known blocker must reject before a close-window transaction is acquired'
  );
  assert.equal(readFileSync(taskPath, 'utf8'), taskBeforeWrite, 'fail-fast rejection must not mutate the task ledger');
} finally {
  rmSync(path.dirname(fixture.targetRepo), { recursive: true, force: true });
}

const foreignProvenanceFixture = await makeDualRepoCloseFixture('foreign-git-head-is-advisory');
try {
  const gitHeadPath = path.join(foreignProvenanceFixture.targetRepo, '.atm/history/evidence/git-head.jsonl');
  const receipt = (taskId: string) => JSON.stringify({
    schemaVersion: 'atm.gitHeadEvidence.v0.1',
    evidence: [{ details: { taskId } }]
  });
  writeFileSync(gitHeadPath, `${receipt('FOREIGN-PRODUCER-001')}\n`, 'utf8');
  execFileSync('git', ['add', '--', path.relative(foreignProvenanceFixture.targetRepo, gitHeadPath)], { cwd: foreignProvenanceFixture.targetRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'seed governed git-head provenance'], { cwd: foreignProvenanceFixture.targetRepo, stdio: 'ignore' });
  writeFileSync(gitHeadPath, `${receipt('FOREIGN-PRODUCER-002')}\n`, 'utf8');

  const dryRun = await runTaskflow([
    'close', '--cwd', foreignProvenanceFixture.targetRepo, '--task', foreignProvenanceFixture.taskId,
    '--actor', 'validator', '--historical-delivery', foreignProvenanceFixture.deliveryCommit, '--json'
  ]) as any;
  assert.deepEqual(dryRun.evidence.historicalClosePreflight.dirtyGuard.governanceTrackedDirtyFiles, []);
  assert.ok(
    dryRun.evidence.historicalClosePreflight.dirtyGuard.advisoryTrackedDirtyFiles.includes('.atm/history/evidence/git-head.jsonl'),
    'a parseable foreign git-head receipt is preserved as advisory provenance rather than misattributed to the closing task'
  );
} finally {
  rmSync(path.dirname(foreignProvenanceFixture.targetRepo), { recursive: true, force: true });
}

console.log('taskflow-close-defer-governance-dirty.test passed');
