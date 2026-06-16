import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTaskflow } from '../../packages/cli/src/commands/taskflow.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = path.resolve(root, '.atm-temp-test-taskflow-open');
const governedProfilePath = path.join(root, 'fixtures/taskflow-profile/governed-invocable.profile.json');

try {
  mkdirSync(tempDir, { recursive: true });

  const dryRun = await runTaskflow([
    'open',
    '--cwd', tempDir,
    '--dry-run',
    '--profile', governedProfilePath,
    '--task-id', 'TASK-GOVERNED-0002',
    '--output', 'tasks/TASK-GOVERNED-0002.task.md'
  ]) as any;

  assert.equal(dryRun.evidence.openerMode, 'delegated-governed');
  assert.equal(dryRun.evidence.delegationContract.generationSurface, 'tasks-new');
  assert.equal(dryRun.evidence.orchestrationPlan.wouldInvokeTasksNew, true);
  assert.equal(dryRun.evidence.orchestrationPlan.wouldInvokeTasksImport, true);
  assert.ok(dryRun.evidence.orchestrationPlan.tasksNewCommand.includes('tasks new'));
  assert.ok(dryRun.evidence.orchestrationPlan.tasksImportCommand.includes('tasks import'));
  assert.ok(dryRun.evidence.orchestrationPlan.tasksNewCommand.includes('--task-id TASK-GOVERNED-0002'));
  assert.equal(dryRun.evidence.writeSupport.requested, false);
  assert.equal(dryRun.evidence.writeSupport.allowed, false);

  mkdirSync(path.join(tempDir, 'docs/tasks'), { recursive: true });
  const writeResult = await runTaskflow([
    'open',
    '--cwd', tempDir,
    '--write',
    '--profile', governedProfilePath,
    '--title', 'Governed Orchestration Write'
  ]) as any;
  const outPath = 'docs/tasks/TASK-GOVERNED-0001.task.md';

  assert.equal(writeResult.ok, true);
  assert.equal(writeResult.mode, 'write');
  assert.equal(writeResult.writeEnabled, true);
  assert.equal(writeResult.evidence.openerMode, 'delegated-governed');
  assert.equal(writeResult.evidence.generation.surface, 'tasks-new');
  assert.equal(writeResult.evidence.generation.taskId, 'TASK-GOVERNED-0001');
  assert.equal(writeResult.evidence.hostPolicyDecision.sources.taskId, 'host-policy');
  assert.equal(writeResult.evidence.runtimeImport.result.ok, true);

  const targetAbsolute = path.join(tempDir, outPath);
  assert.ok(existsSync(targetAbsolute));
  const generatedText = readFileSync(targetAbsolute, 'utf8');
  assert.ok(generatedText.includes('task_id: TASK-GOVERNED-0001'));
  assert.ok(generatedText.includes('title: "Governed Orchestration Write"'));

  const runtimeTaskPath = path.join(tempDir, '.atm/history/tasks/TASK-GOVERNED-0001.json');
  assert.ok(existsSync(runtimeTaskPath));
  const runtimeTask = JSON.parse(readFileSync(runtimeTaskPath, 'utf8'));
  assert.equal(runtimeTask.workItemId, 'TASK-GOVERNED-0001');
  assert.equal(runtimeTask.status, 'planned');

  await assert.rejects(
    () => runTaskflow(['open', '--cwd', tempDir, '--write']),
    (err: any) => err.code === 'ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK'
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('[taskflow-open-orchestration:test] ok');
