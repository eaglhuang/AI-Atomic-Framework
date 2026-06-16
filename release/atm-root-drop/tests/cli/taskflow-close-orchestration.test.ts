import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTaskflow } from '../../packages/cli/src/commands/taskflow.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = path.resolve(root, '.atm-temp-test-taskflow-close');
const governedProfilePath = path.join(root, 'fixtures/taskflow-profile/governed-invocable.profile.json');

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writePlanningCard(relativePath: string, taskId: string, status: string) {
  const planPath = path.join(tempDir, relativePath);
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, [
    '---',
    `task_id: ${taskId}`,
    'title: "Close orchestration fixture"',
    `status: ${status}`,
    '---',
    `# ${taskId}`,
    ''
  ].join('\n'), 'utf8');
  return relativePath.replace(/\\/g, '/');
}

try {
  mkdirSync(path.join(tempDir, '.atm/history/tasks'), { recursive: true });

  const normalTaskId = 'TASK-CLOSE-ORCH-0001';
  const normalPlan = writePlanningCard('docs/tasks/TASK-CLOSE-ORCH-0001.task.md', normalTaskId, 'running');
  writeJson(path.join(tempDir, '.atm/history/tasks', `${normalTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: normalTaskId,
    title: 'Normal close orchestration fixture',
    status: 'running',
    related_plan: normalPlan,
    source: { planPath: normalPlan, sectionTitle: normalTaskId, headingLine: 1, hash: 'fixture' }
  });

  const normalDryRun = await runTaskflow([
    'close',
    '--cwd', tempDir,
    '--task', normalTaskId,
    '--profile', governedProfilePath
  ]) as any;

  assert.equal(normalDryRun.schemaId, 'atm.taskflowCloseResult.v1');
  assert.equal(normalDryRun.mode, 'dry-run');
  assert.equal(normalDryRun.evidence.closeMode, 'normal-close');
  assert.equal(normalDryRun.evidence.closebackPlan.backendSurface, 'tasks-close');
  assert.ok(normalDryRun.evidence.closebackPlan.backendCommand.includes('tasks close'));
  assert.equal(normalDryRun.evidence.closebackPlan.writerBoundary.generationSurface, 'tasks-new');
  assert.ok(normalDryRun.evidence.closebackPlan.writerBoundary.rosterClosebackCommand?.includes('tasks roster update'));

  const mirrorTaskId = 'TASK-CLOSE-ORCH-0002';
  const mirrorPlan = writePlanningCard('docs/tasks/TASK-CLOSE-ORCH-0002.task.md', mirrorTaskId, 'open');
  writeJson(path.join(tempDir, '.atm/history/tasks', `${mirrorTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: mirrorTaskId,
    title: 'Planning mirror closeback fixture',
    status: 'done',
    related_plan: mirrorPlan,
    source: { planPath: mirrorPlan, sectionTitle: mirrorTaskId, headingLine: 1, hash: 'fixture' }
  });

  const mirrorDryRun = await runTaskflow([
    'close',
    '--cwd', tempDir,
    '--task', mirrorTaskId,
    '--profile', governedProfilePath
  ]) as any;
  assert.equal(mirrorDryRun.evidence.closeMode, 'planning-mirror-sync-repair');
  assert.equal(mirrorDryRun.evidence.closebackPlan.backendSurface, 'tasks-import');
  assert.ok(mirrorDryRun.evidence.closebackPlan.backendCommand.includes('tasks import'));

  const historicalTaskId = 'TASK-CLOSE-ORCH-0003';
  const historicalPlan = writePlanningCard('docs/tasks/TASK-CLOSE-ORCH-0003.task.md', historicalTaskId, 'done');
  writeJson(path.join(tempDir, '.atm/history/tasks', `${historicalTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: historicalTaskId,
    title: 'Historical delivery closeback fixture',
    status: 'running',
    closedAt: '2026-06-10T00:00:00.000Z',
    closurePacket: `.atm/history/evidence/${historicalTaskId}.closure-packet.json`,
    claim: {
      actorId: 'fixture-agent',
      leaseId: 'lease-1',
      claimedAt: '2026-06-10T00:00:00.000Z',
      state: 'active',
      files: [`.atm/history/tasks/${historicalTaskId}.json`]
    },
    related_plan: historicalPlan,
    source: { planPath: historicalPlan, sectionTitle: historicalTaskId, headingLine: 1, hash: 'fixture' }
  });

  const historicalDryRun = await runTaskflow([
    'close',
    '--cwd', tempDir,
    '--task', historicalTaskId,
    '--historical-delivery', 'abc123def456'
  ]) as any;
  assert.equal(historicalDryRun.evidence.closeMode, 'historical-delivery-close');
  assert.equal(historicalDryRun.evidence.closebackPlan.backendSurface, 'tasks-reconcile');
  assert.ok(historicalDryRun.evidence.closebackPlan.backendCommand.includes('tasks reconcile'));

  const ambiguousTaskId = 'TASK-CLOSE-ORCH-0004';
  writePlanningCard('docs/tasks/TASK-CLOSE-ORCH-0004.task.md', ambiguousTaskId, 'open');
  writeJson(path.join(tempDir, '.atm/history/tasks', `${ambiguousTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: ambiguousTaskId,
    title: 'Ambiguous closeback fixture',
    status: 'blocked',
    source: {
      planPath: 'docs/tasks/TASK-CLOSE-ORCH-0004.task.md',
      sectionTitle: ambiguousTaskId,
      headingLine: 1,
      hash: 'fixture'
    }
  });

  const ambiguousDryRun = await runTaskflow([
    'close',
    '--cwd', tempDir,
    '--task', ambiguousTaskId
  ]) as any;
  assert.equal(ambiguousDryRun.evidence.closeMode, 'ambiguous-manual-review');
  assert.equal(ambiguousDryRun.evidence.closebackPlan.backendSurface, 'tasks-status');

  await assert.rejects(
    () => runTaskflow(['close', '--cwd', tempDir, '--task', ambiguousTaskId, '--actor', 'fixture-agent', '--write']),
    (err: any) => err.code === 'ATM_TASKFLOW_CLOSE_AMBIGUOUS_RESIDUE'
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('[taskflow-close-orchestration:test] ok');
