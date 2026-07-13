import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runResidue } from '../residue.ts';

function initGitRepo(cwd: string): void {
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['config', '--local', 'user.name', 'test-actor'], { cwd });
  execFileSync('git', ['config', '--local', 'user.email', 'test-actor@example.local'], { cwd });
  writeFileSync(path.join(cwd, 'README.md'), 'test\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd, stdio: 'ignore' });
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function testResidueReconcileAppliesOnlySafeOwnerAwareResidue(): Promise<void> {
  const repo = path.join(os.tmpdir(), `atm-residue-reconcile-${Date.now()}`);
  mkdirSync(repo, { recursive: true });
  try {
    initGitRepo(repo);

    const abandonedTaskPath = path.join(repo, '.atm/history/tasks/TASK-OLD-0001.json');
    const abandonedEvidencePath = path.join(repo, '.atm/history/evidence/TASK-OLD-0001.json');
    const abandonedEventPath = path.join(repo, '.atm/history/task-events/TASK-OLD-0001/close.json');
    const activeTaskPath = path.join(repo, '.atm/history/tasks/TASK-ACTIVE-0001.json');
    const activeEvidencePath = path.join(repo, '.atm/history/evidence/TASK-ACTIVE-0001.json');
    const activeLockPath = path.join(repo, '.atm/runtime/locks/TASK-ACTIVE-0001.lock.json');
    const pushAttemptPath = path.join(repo, '.atm/runtime/git-push-attempts/tester__origin__main.json');

    writeJson(abandonedTaskPath, { taskId: 'TASK-OLD-0001', status: 'abandoned' });
    writeJson(abandonedEvidencePath, { taskId: 'TASK-OLD-0001' });
    writeJson(abandonedEventPath, { taskId: 'TASK-OLD-0001', event: 'close' });
    writeJson(activeTaskPath, { taskId: 'TASK-ACTIVE-0001', status: 'in-progress' });
    writeJson(activeEvidencePath, { taskId: 'TASK-ACTIVE-0001' });
    writeJson(activeLockPath, {
      schemaId: 'atm.taskLock.v1',
      status: 'active',
      actorId: 'other-agent'
    });
    writeJson(pushAttemptPath, { actorId: 'tester', remote: 'origin', branch: 'main' });

    execFileSync('git', ['add', '.atm/history/evidence/TASK-ACTIVE-0001.json'], { cwd: repo });

    const dryRun = runResidue(['reconcile', '--cwd', repo]) as any;
    assert.equal(dryRun.ok, true);
    assert.equal(dryRun.evidence.report.dryRun, true);
    assert.ok(
      dryRun.evidence.report.actions.some((action: any) => action.path === '.atm/history/evidence/TASK-OLD-0001.json'),
      'abandoned evidence should be planned for cleanup'
    );
    assert.ok(
      dryRun.evidence.report.actions.some((action: any) => action.path === '.atm/runtime/git-push-attempts/tester__origin__main.json'),
      'runtime push attempt should be planned for cleanup'
    );
    assert.ok(
      dryRun.evidence.report.deferred.some((entry: any) => entry.path === '.atm/history/evidence/TASK-ACTIVE-0001.json'),
      'active owner staged evidence must be deferred'
    );
    assert.equal(existsSync(abandonedEvidencePath), true, 'dry-run must not delete files');

    const applied = runResidue(['reconcile', '--apply', '--cwd', repo]) as any;
    assert.equal(applied.ok, true);
    assert.equal(applied.evidence.report.dryRun, false);
    assert.equal(existsSync(abandonedTaskPath), false, 'abandoned task ledger residue should be removed');
    assert.equal(existsSync(abandonedEvidencePath), false, 'abandoned evidence residue should be removed');
    assert.equal(existsSync(abandonedEventPath), false, 'abandoned task-event residue should be removed');
    assert.equal(existsSync(pushAttemptPath), false, 'runtime push-attempt residue should be removed');
    assert.equal(existsSync(activeEvidencePath), true, 'active owner evidence must be preserved');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

await testResidueReconcileAppliesOnlySafeOwnerAwareResidue();
console.log('[residue.spec] ok');
