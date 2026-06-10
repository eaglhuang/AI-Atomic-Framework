import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTasks, runTasksRosterUpdate } from '../../packages/cli/src/commands/tasks.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = path.join(root, 'fixtures/tasks-roster');
const tempDir = path.resolve(root, '.atm-temp-test-roster-update');

function hashFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath, 'utf8')).digest('hex');
}

try {
  mkdirSync(tempDir, { recursive: true });
  const indexPath = path.join(tempDir, 'README.md');
  const taskPath = path.join(tempDir, 'TASK-ROSTER-0001.task.md');
  writeFileSync(indexPath, readFileSync(path.join(fixtureDir, 'README.md'), 'utf8'), 'utf8');
  writeFileSync(taskPath, readFileSync(path.join(fixtureDir, 'TASK-ROSTER-0001.task.md'), 'utf8'), 'utf8');

  const beforeHash = hashFile(indexPath);
  const dryRun = await runTasksRosterUpdate([
    '--cwd', tempDir,
    '--index', 'README.md',
    '--from', 'TASK-ROSTER-0001.task.md',
    '--dry-run'
  ]);

  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.evidence.dryRun, true);
  assert.equal(dryRun.evidence.beforeHash, `sha256:${beforeHash}`);
  assert.equal(dryRun.evidence.afterHash, `sha256:${beforeHash}`);
  assert.equal(hashFile(indexPath), beforeHash);
  const dryDiff = dryRun.evidence.diff as { after: string };
  assert.ok(dryDiff.after.includes('updated roster title'));
  assert.ok(dryDiff.after.includes('TASK-ROSTER-0000'));

  const writeResult = await runTasks([
    'roster',
    'update',
    '--cwd', tempDir,
    '--index', 'README.md',
    '--from', 'TASK-ROSTER-0001.task.md'
  ]);

  assert.equal(writeResult.ok, true);
  const writeDiff = writeResult.evidence.diff as { after: string };
  assert.ok(writeDiff.after.includes('updated roster title'));
  assert.notEqual(hashFile(indexPath), beforeHash);

  writeFileSync(path.join(tempDir, 'TASK-ROSTER-9999.task.md'), readFileSync(taskPath, 'utf8').replace(/TASK-ROSTER-0001/g, 'TASK-ROSTER-9999'), 'utf8');
  const missing = await runTasksRosterUpdate([
    '--cwd', tempDir,
    '--index', 'README.md',
    '--from', 'TASK-ROSTER-9999.task.md'
  ]);
  assert.equal(missing.ok, false);
  assert.ok(existsSync(indexPath));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('[tasks-roster-update:test] ok');
