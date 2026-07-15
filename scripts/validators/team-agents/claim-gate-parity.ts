import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runTeam } from '../../../packages/cli/src/commands/team.ts';

export async function runClaimGateParityValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'claim-gate-parity') return false;

  const cwd = process.cwd();
  const taskId = 'TASK-TEAM-0029-FIXTURE';
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  const runtimeDir = path.join(cwd, '.atm', 'runtime', 'team-runs');
  const beforeRuntimeFiles = new Set(existsSync(runtimeDir) ? Array.from(readdirSync(runtimeDir)) : []);
  mkdirSync(path.dirname(taskPath), { recursive: true });
  writeFileSync(taskPath, `${JSON.stringify({
    schemaId: 'atm.taskLedger.v1',
    workItemId: taskId,
    title: 'Team claim gate parity fixture',
    status: 'ready',
    dependencies: ['TASK-TEAM-0029-MISSING-DEPENDENCY'],
    planningRepo: 'AI-Atomic-Framework',
    targetRepo: 'AI-Atomic-Framework',
    scopePaths: ['packages/cli/src/commands/team.ts'],
    deliverables: ['packages/cli/src/commands/team.ts'],
    validators: ['node --strip-types scripts/validate-team-agents.ts --case claim-gate-parity'],
    acceptance: ['Team start must fail closed when normal task claim dependency gates would reject the task.']
  }, null, 2)}\n`, 'utf8');
  try {
    const plan = await runTeam(['plan', '--task', taskId, '--cwd', cwd, '--json']);
    const planEvidence = plan.evidence as any;
    const planFindings = planEvidence?.teamPlan?.validation?.findings ?? [];
    assert.equal(plan.ok, false);
    assert.ok(planFindings.some((finding: any) => finding.code === 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED'));

    const validate = await runTeam(['validate', '--task', taskId, '--cwd', cwd, '--json']);
    const validateEvidence = validate.evidence as any;
    assert.equal(validate.ok, true);
    assert.equal(validateEvidence?.safeToStart, false);
    assert.ok(validateEvidence?.relatedFindings?.some((finding: any) => finding.code === 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED'));

    const start = await runTeam(['start', '--task', taskId, '--actor', 'claim-gate-validator', '--cwd', cwd, '--json']);
    const startEvidence = start.evidence as any;
    assert.equal(start.ok, false);
    assert.equal(startEvidence?.runtimeWritten, false);
    assert.ok(startEvidence?.validation?.findings?.some((finding: any) => finding.code === 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED'));
    const afterRuntimeFiles = new Set(existsSync(runtimeDir) ? Array.from(readdirSync(runtimeDir)) : []);
    assert.deepEqual(afterRuntimeFiles, beforeRuntimeFiles);
  } finally {
    rmSync(taskPath, { force: true });
  }

  console.log('[validate-team-agents] ok (claim-gate-parity)');
  return true;
}
