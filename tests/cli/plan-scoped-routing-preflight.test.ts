import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPlanScopedRoutingPreflight } from '../../packages/cli/src/commands/next/plan-scoped-preflight.ts';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'atm-plan-preflight-'));
runGit(['init']);
runGit(['config', 'user.name', 'fixture']);
runGit(['config', 'user.email', 'fixture@example.test']);

const planPath = path.join(tmp, 'docs/tasks/ATM-GOV-0182.task.md');
mkdirSync(path.dirname(planPath), { recursive: true });
writeFileSync(planPath, '# ATM-GOV-0182\n\nfixture plan\n', 'utf8');
mkdirSync(path.join(tmp, 'packages/cli/src/commands/next'), { recursive: true });
writeFileSync(path.join(tmp, 'packages/cli/src/commands/next/owned.ts'), 'export const owned = 1;\n', 'utf8');
runGit(['add', '.']);
runGit(['commit', '-m', 'fixture']);

mkdirSync(path.join(tmp, '.atm/history/evidence'), { recursive: true });
writeFileSync(path.join(tmp, '.atm/history/evidence/ATM-GOV-0168.runner-sync-receipt.json'), '{}\n', 'utf8');
writeFileSync(path.join(tmp, 'notes.tmp'), 'unrelated\n', 'utf8');

const task: any = {
  workItemId: 'ATM-GOV-0182',
  title: 'Plan-scoped routing preflight',
  status: 'planned',
  sourcePlanPath: 'docs/tasks/ATM-GOV-0182.task.md',
  targetAllowedFiles: ['packages/cli/src/commands/next/**'],
  scopePaths: ['packages/cli/src/commands/next/**']
};

const report = buildPlanScopedRoutingPreflight({
  cwd: tmp,
  task,
  selectedTasks: [
    { ...task, workItemId: 'ATM-GOV-0181', status: 'done' },
    task
  ],
  taskIntent: { userPrompt: 'ATM-GOV-0182', explicitTaskIds: ['ATM-GOV-0182'], mentionedTaskIds: ['ATM-GOV-0182'] } as any,
  actorId: 'codex-governance-optimizer',
  laneSessionId: 'lane-fixture',
  command: 'node atm.mjs next --claim --actor codex-governance-optimizer --task ATM-GOV-0182 --auto-intent --json',
  dirtyWipAdmission: {
    schemaId: 'atm.claimDirtyWipAdmission.v1',
    ok: true,
    taskId: 'ATM-GOV-0182',
    currentActorId: 'codex-governance-optimizer',
    currentLaneSessionId: 'lane-fixture',
    candidateFiles: ['packages/cli/src/commands/next/**'],
    intersectingFiles: [],
    blockers: []
  }
});

assert.equal(report.schemaId, 'atm.planScopedRoutingPreflight.v1');
assert.equal(report.plan.state, 'resolved');
assert.match(report.plan.digest ?? '', /^sha256:/);
assert.deepEqual(report.routing.selectedTaskIds, ['ATM-GOV-0181', 'ATM-GOV-0182']);
assert.equal(report.identity.readOnlyLanePresence, true);
assert.equal(report.telemetry.checkId, 'next.route-resolution');
assert.equal(report.telemetry.eventWritten, true);
assert(report.wip.classes.includes('stale-generated-receipt'), 'runner-sync receipts must be classified separately from active blockers');
assert(report.wip.classes.includes('unrelated-dirty'), 'unrelated dirty files must not be collapsed into unowned blockers');

console.log('ok - tests/cli/plan-scoped-routing-preflight.test.ts');

function runGit(args: readonly string[]) {
  const result = spawnSync('git', args as string[], { cwd: tmp, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
}
