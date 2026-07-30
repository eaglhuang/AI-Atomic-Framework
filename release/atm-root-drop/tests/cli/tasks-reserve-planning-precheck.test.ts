import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTasksImport } from '../../packages/cli/src/commands/tasks/import-orchestrator.ts';
import { prepareImportedTaskForClaim } from '../../packages/cli/src/commands/next/claim-helpers.ts';

// `tasks reserve` is no longer a CLI action; reserve/promote is reached through
// the claim preparation seam that `next --claim` drives. The precheck contract is
// exercised directly against that seam so this validator tests the live path.

const tempRoot = path.join(os.tmpdir(), `atm-tasks-reserve-precheck-${Date.now()}`);
const workspace = path.join(tempRoot, 'target');
const planning = path.join(tempRoot, 'planning');
const planningTasksDir = path.join(planning, 'docs', 'ai_atomic_framework', 'multi-agent-orchestration', 'tasks');

try {
  mkdirSync(path.join(workspace, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(workspace, '.atm', 'history', 'task-events'), { recursive: true });
  mkdirSync(path.join(workspace, '.atm', 'history', 'evidence'), { recursive: true });
  mkdirSync(planningTasksDir, { recursive: true });

  writeFileSync(path.join(workspace, '.atm', 'config.json'), JSON.stringify({}, null, 2));
  writeFileSync(path.join(workspace, '.atm', 'registry.json'), JSON.stringify({ entries: [] }, null, 2));
  writeFileSync(path.join(workspace, '.atm', 'git-baseline.json'), JSON.stringify({
    schemaId: 'atm.gitBaseline.v1',
    repoRoot: workspace,
    commit: 'HEAD'
  }, null, 2));

  const existingPlan = path.join(planningTasksDir, 'TASK-MAO-0053.task.md');
  writeTaskCard(existingPlan, 'TASK-MAO-0053', 'Existing imported task');
  const existingImport = await runTasksImport([
    '--cwd', workspace,
    '--from', existingPlan,
    '--write',
    '--json'
  ]) as any;
  assert.equal(existingImport.ok, true);

  // A task with no ledger record is auto-imported from the sibling planning repo
  // before it is reserved and promoted.
  const targetPlan = path.join(planningTasksDir, 'TASK-MAO-0054.task.md');
  writeTaskCard(targetPlan, 'TASK-MAO-0054', 'Reserve planning precheck fixture');

  const prepared = await prepareImportedTaskForClaim({
    cwd: workspace,
    task: { workItemId: 'TASK-MAO-0054', status: 'planned', title: 'Reserve planning precheck fixture' } as any,
    actorId: 'captain'
  });
  assert.deepEqual(prepared.steps.map((step: any) => step.action), ['reserve', 'promote']);

  const importedTaskPath = path.join(workspace, '.atm', 'history', 'tasks', 'TASK-MAO-0054.json');
  assert.equal(existsSync(importedTaskPath), true);
  const importedTask = JSON.parse(readFileSync(importedTaskPath, 'utf8'));
  assert.equal(importedTask.status, 'ready');
  assert.equal(importedTask.owner, 'captain');
  assert.equal(
    importedTask.source.planPath.replace(/\\/g, '/'),
    'multi-agent-orchestration/tasks/TASK-MAO-0054.task.md',
    'auto-import must seal the planning-root relative card path'
  );

  // No ledger record and no planning card means the preparation must refuse
  // rather than invent a task.
  await assert.rejects(
    () => prepareImportedTaskForClaim({
      cwd: workspace,
      task: { workItemId: 'TASK-MAO-4040', status: 'planned', title: 'Missing card' } as any,
      actorId: 'captain'
    }),
    (err: any) => {
      assert.equal(err.code, 'ATM_TASK_RESERVE_PLANNING_CARD_REQUIRED');
      return true;
    }
  );

  // ── Claim-time seal atomicity ────────────────────────────────────────────
  // A failed planning-source seal check must be decided before reserve/promote
  // touch the ledger. Otherwise a blocked claim still leaves the task owned,
  // promoted, and carrying lifecycle events nobody asked for.
  const atomicityTaskId = 'TASK-MAO-0056';
  const atomicityPlan = path.join(planningTasksDir, `${atomicityTaskId}.task.md`);
  writeTaskCard(atomicityPlan, atomicityTaskId, 'Claim seal atomicity fixture');
  const atomicityImport = await runTasksImport([
    '--cwd', workspace,
    '--from', atomicityPlan,
    '--write',
    '--json'
  ]) as any;
  assert.equal(atomicityImport.ok, true);

  const atomicityTaskPath = path.join(workspace, '.atm', 'history', 'tasks', `${atomicityTaskId}.json`);
  const atomicityEventsDir = path.join(workspace, '.atm', 'history', 'task-events', atomicityTaskId);
  const beforeLedgerText = readFileSync(atomicityTaskPath, 'utf8');
  const beforeLedger = JSON.parse(beforeLedgerText);
  const beforeEvents = existsSync(atomicityEventsDir) ? readdirSync(atomicityEventsDir).sort() : [];

  writeTaskCard(atomicityPlan, atomicityTaskId, 'Claim seal atomicity fixture', 'Ungoverned content drift after import.');

  await assert.rejects(
    () => prepareImportedTaskForClaim({
      cwd: workspace,
      task: { workItemId: atomicityTaskId, status: 'planned', title: 'Claim seal atomicity fixture' } as any,
      actorId: 'captain'
    }),
    (err: any) => {
      assert.equal(err.code, 'ATM_PLANNING_SOURCE_IDENTITY_DRIFT');
      assert.ok(err.details.driftKinds.includes('content'));
      return true;
    }
  );

  const afterLedger = JSON.parse(readFileSync(atomicityTaskPath, 'utf8'));
  const afterEvents = existsSync(atomicityEventsDir) ? readdirSync(atomicityEventsDir).sort() : [];
  assert.equal(afterLedger.status, beforeLedger.status, 'a blocked seal check must not promote the task');
  assert.equal(afterLedger.owner ?? null, beforeLedger.owner ?? null, 'a blocked seal check must not claim ownership');
  assert.equal(afterLedger.reservedAt ?? null, null, 'a blocked seal check must not record a reservation');
  assert.equal(afterLedger.promotedAt ?? null, null, 'a blocked seal check must not record a promotion');
  assert.deepEqual(afterEvents, beforeEvents, 'a blocked seal check must not append reserve/promote lifecycle events');
  assert.equal(
    readFileSync(atomicityTaskPath, 'utf8'),
    beforeLedgerText,
    'the ledger record must be byte-identical after a blocked claim seal check'
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[cli-tasks-reserve-planning-precheck:test] ok');

function writeTaskCard(targetPath: string, taskId: string, title: string, extraAcceptance?: string) {
  writeFileSync(targetPath, [
    '---',
    `task_id: ${taskId}`,
    `title: "${title}"`,
    'status: planned',
    'planning_repo: 3KLife',
    'target_repo: AI-Atomic-Framework',
    'closure_authority: target_repo',
    'deliverables:',
    '  - "packages/cli/src/commands/tasks.ts"',
    'scopePaths:',
    '  - "packages/cli/src/commands/tasks.ts"',
    'validators:',
    '  - "npm run typecheck"',
    '---',
    '',
    `# ${taskId} - ${title}`,
    '',
    ...(extraAcceptance ? ['## Acceptance', '', `- ${extraAcceptance}`] : [])
  ].join('\n'));
}
