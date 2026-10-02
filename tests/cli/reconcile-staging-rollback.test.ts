import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeTaskCloseTransaction } from '../../packages/cli/src/commands/framework-development.ts';
import { stageTaskCloseArtifacts } from '../../packages/cli/src/commands/tasks/close-helpers/close-artifact-staging.ts';

for (const scenario of ['index-lock', 'missing-path', 'success']) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-reconcile-staging-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd });
    writeFileSync(path.join(cwd, 'foreign.txt'), 'foreign staged work\n');
    execFileSync('git', ['add', '--', 'foreign.txt'], { cwd });
    const indexPath = path.join(cwd, '.git/index');
    const previousIndex = readFileSync(indexPath);
    const taskPath = path.join(cwd, 'task.json');
    const packetPath = path.join(cwd, 'packet.json');
    const transitionPath = 'transition.json';
    const previousTaskContent = '{"status":"running","claim":{"state":"active"}}\n';
    writeFileSync(taskPath, previousTaskContent);
    if (scenario === 'index-lock') writeFileSync(`${indexPath}.lock`, 'another writer\n');
    let stagingCalls = 0;
    const operation = executeTaskCloseTransaction({
      cwd, taskId: 'TASK-FIXTURE-0001', taskPath, phase: 'reconcile', previousTaskContent,
      createdClosurePacketAbsolute: packetPath,
      runWrites: () => {
        mkdirSync(path.join(cwd, '.atm/runtime'), { recursive: true });
        writeFileSync(taskPath, '{"status":"done","claim":{"state":"released"}}\n');
        writeFileSync(packetPath, '{}\n');
        writeFileSync(path.join(cwd, transitionPath), '{}\n');
        return { transitionPath, closurePacketPath: 'packet.json' };
      },
      stageArtifacts: result => {
        stagingCalls++;
        stageTaskCloseArtifacts(cwd, ['task.json', result.transitionPath, result.closurePacketPath,
          ...(scenario === 'missing-path' ? ['missing.json'] : [])]);
      }
    });
    if (scenario === 'success') {
      await operation;
      assert.equal(JSON.parse(readFileSync(taskPath, 'utf8')).status, 'done');
      const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8' }).trim().split(/\r?\n/).sort();
      assert.deepEqual(staged, ['foreign.txt', 'packet.json', 'task.json', 'transition.json']);
    } else {
      await assert.rejects(operation, error => error instanceof Error && error.message.includes('rolled back'));
      assert.equal(readFileSync(taskPath, 'utf8'), previousTaskContent);
      assert.equal(existsSync(packetPath), false);
      assert.equal(existsSync(path.join(cwd, transitionPath)), false);
      assert.deepEqual(readFileSync(indexPath), previousIndex);
      if (scenario === 'index-lock') assert.equal(readFileSync(`${indexPath}.lock`, 'utf8'), 'another writer\n');
    }
    assert.equal(stagingCalls, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
console.log('reconcile-staging-rollback.test.ts passed (3 cases)');
