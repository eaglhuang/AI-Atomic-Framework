import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTasks } from '../../packages/cli/src/commands/tasks.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = path.resolve(root, '.atm-temp-test-residue-classification');

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
    'title: "Residue CLI fixture"',
    `status: ${status}`,
    '---',
    `# ${taskId}`,
    ''
  ].join('\n'), 'utf8');
  return relativePath.replace(/\\/g, '/');
}

try {
  mkdirSync(path.join(tempDir, '.atm/history/tasks'), { recursive: true });

  const completeTaskId = 'TASK-RESIDUE-CLI-0001';
  const completePlan = writePlanningCard('docs/fixtures/residue-complete.task.md', completeTaskId, 'done');
  writeJson(path.join(tempDir, '.atm/history/tasks', `${completeTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: completeTaskId,
    title: 'Complete but unfinalized CLI fixture',
    status: 'running',
    planningRepo: '3KLife',
    targetRepo: 'AI-Atomic-Framework',
    closureAuthority: 'target_repo',
    closedAt: '2026-06-10T00:00:00.000Z',
    closurePacket: `.atm/history/evidence/${completeTaskId}.closure-packet.json`,
    claim: {
      actorId: 'fixture-agent',
      leaseId: 'lease-1',
      claimedAt: '2026-06-10T00:00:00.000Z',
      state: 'active',
      files: [`.atm/history/tasks/${completeTaskId}.json`]
    },
    lastTransitionId: 'transition-1',
    source: { planPath: completePlan, sectionTitle: completeTaskId, headingLine: 1, hash: 'fixture' }
  });

  const completeDiagnose = await runTasks(['finalize', 'diagnose', '--cwd', tempDir, '--task', completeTaskId]) as any;
  assert.equal(completeDiagnose.command, 'tasks finalize diagnose');
  assert.equal(completeDiagnose.evidence.schemaId, 'atm.taskResidueDiagnosis.v1');
  assert.equal(completeDiagnose.evidence.bucket, 'complete-but-unfinalized');
  assert.equal(completeDiagnose.evidence.autoMutationAllowed, false);
  assert.ok(completeDiagnose.evidence.nextCommand.includes(completeTaskId));
  assert.ok(completeDiagnose.evidence.nextCommand.includes('tasks reconcile'));

  const interruptedTaskId = 'TASK-RESIDUE-CLI-0002';
  const interruptedPlan = writePlanningCard('docs/fixtures/residue-interrupted.task.md', interruptedTaskId, 'done');
  writeJson(path.join(tempDir, '.atm/history/tasks', `${interruptedTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: interruptedTaskId,
    title: 'Interrupted close CLI fixture',
    status: 'done',
    planningRepo: '3KLife',
    targetRepo: 'AI-Atomic-Framework',
    closureAuthority: 'target_repo',
    closedAt: '2026-06-10T00:00:00.000Z',
    claim: {
      actorId: 'fixture-agent',
      leaseId: 'lease-2',
      claimedAt: '2026-06-10T00:00:00.000Z',
      state: 'active',
      files: [`.atm/history/tasks/${interruptedTaskId}.json`]
    },
    source: { planPath: interruptedPlan, sectionTitle: interruptedTaskId, headingLine: 1, hash: 'fixture' }
  });
  const interruptedStatus = await runTasks(['status', '--cwd', tempDir, '--task', interruptedTaskId, '--residue']) as any;
  assert.equal(interruptedStatus.evidence.bucket, 'interrupted-close');
  assert.ok(interruptedStatus.evidence.nextCommand.includes(interruptedTaskId));
  assert.ok(interruptedStatus.evidence.nextCommand.includes('repair-closure'));

  const ambiguousTaskId = 'TASK-RESIDUE-CLI-0003';
  writePlanningCard('docs/fixtures/residue-ambiguous.task.md', ambiguousTaskId, 'open');
  writeJson(path.join(tempDir, '.atm/history/tasks', `${ambiguousTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: ambiguousTaskId,
    title: 'Ambiguous CLI fixture',
    status: 'blocked',
    source: {
      planPath: 'docs/fixtures/residue-ambiguous.task.md',
      sectionTitle: ambiguousTaskId,
      headingLine: 1,
      hash: 'fixture'
    }
  });
  const ambiguousDiagnose = await runTasks(['finalize', 'diagnose', '--cwd', tempDir, '--task', ambiguousTaskId]) as any;
  assert.equal(ambiguousDiagnose.evidence.bucket, 'ambiguous-manual-review');
  assert.equal(ambiguousDiagnose.evidence.autoMutationAllowed, false);
  assert.ok(ambiguousDiagnose.evidence.nextCommand.includes(ambiguousTaskId));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('[tasks-residue-classification:test] ok');
