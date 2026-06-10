import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTaskflow } from '../../packages/cli/src/commands/taskflow.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = path.resolve(root, '.atm-temp-test-taskflow-host-policy');
const governedProfilePath = path.join(root, 'fixtures/taskflow-profile/governed-invocable.profile.json');

try {
  mkdirSync(path.join(tempDir, 'docs/tasks'), { recursive: true });
  writeFileSync(
    path.join(tempDir, 'docs/tasks/TASK-GOVERNED-0001.task.md'),
    '---\ntask_id: TASK-GOVERNED-0001\ntitle: "existing"\nstatus: open\n---\n',
    'utf8'
  );
  writeFileSync(
    path.join(tempDir, 'docs/tasks/README.md'),
    '| Task ID | Title | Status | Depends | Target surface | Primary validators |\n|---|---|---|---|---|---|\n',
    'utf8'
  );

  const dryRun = await runTaskflow([
    'open',
    '--cwd', tempDir,
    '--dry-run',
    '--profile', governedProfilePath
  ]) as any;

  assert.equal(dryRun.evidence.openerMode, 'delegated-governed');
  assert.equal(dryRun.evidence.hostPolicyDecision.taskId, 'TASK-GOVERNED-0002');
  assert.equal(dryRun.evidence.hostPolicyDecision.outputPath, 'docs/tasks/TASK-GOVERNED-0002.task.md');
  assert.equal(dryRun.evidence.hostPolicyDecision.sources.taskId, 'host-policy');
  assert.equal(dryRun.evidence.hostPolicyDecision.sources.outputPath, 'host-policy');
  assert.ok(dryRun.evidence.orchestrationPlan.rosterFollowUpCommand?.includes('tasks roster update'));

  const writeResult = await runTaskflow([
    'open',
    '--cwd', tempDir,
    '--write',
    '--profile', governedProfilePath,
    '--title', 'Host Policy Opened Task'
  ]) as any;

  assert.equal(writeResult.ok, true);
  assert.equal(writeResult.evidence.generation.taskId, 'TASK-GOVERNED-0002');
  const generatedPath = path.join(tempDir, 'docs/tasks/TASK-GOVERNED-0002.task.md');
  assert.ok(existsSync(generatedPath));
  assert.ok(readFileSync(generatedPath, 'utf8').includes('Host Policy Opened Task'));
  assert.equal(writeResult.evidence.rosterSync.mode, 'follow-up-command');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('[taskflow-host-policy:test] ok');
