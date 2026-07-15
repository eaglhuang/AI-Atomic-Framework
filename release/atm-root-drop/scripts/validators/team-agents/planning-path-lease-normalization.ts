import assert from 'node:assert/strict';
import path from 'node:path';
import { runTeam, validateTeamPermissionModel } from '../../../packages/cli/src/commands/team.ts';

export async function runPlanningPathLeaseNormalizationValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'planning-path-lease-normalization') return false;

  const recipe = {
    schemaId: 'atm.teamRecipe.v1' as const,
    recipeId: 'validator.planning-path-lease-normalization',
    agents: [
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
      { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
    ]
  };
  const repoRoot = process.cwd();
  const targetAbsolute = path.join(repoRoot, 'packages/cli/src/commands/team.ts');
  const targetRelative = 'packages/cli/src/commands/team.ts';
  const planningAbsolute = 'C:/Users/User/3KLife/docs/ai_atomic_framework/team-agents/tasks/TASK-TEAM-0030.task.md';

  const targetRepoLease = validateTeamPermissionModel(recipe, [targetAbsolute], {
    allowedWritePaths: [targetRelative],
    repoRoot
  });
  assert.equal(targetRepoLease.ok, true);
  assert.equal(targetRepoLease.findings.length, 0);

  const planningRepoLease = validateTeamPermissionModel(recipe, [planningAbsolute], {
    allowedWritePaths: [targetRelative],
    repoRoot
  });
  assert.equal(planningRepoLease.ok, false);
  assert.ok(planningRepoLease.findings.some((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL'));

  const validateResult = await runTeam(['validate', '--task', 'TASK-TEAM-0030', '--recipe', 'atm.default.normal.typescript', '--cwd', repoRoot, '--json']);
  const validateEvidence = validateResult.evidence as any;
  const validateFindings = validateEvidence?.validation?.findings ?? [];
  assert.equal(validateResult.ok, true);
  assert.equal(validateEvidence?.validation?.ok, true);
  assert.equal(validateFindings.some((finding: any) => finding.code === 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL'), false);
  assert.equal(validateEvidence?.suggestedPermissionLeases?.some((lease: any) => lease.permission === 'file.write' && lease.paths?.some((entry: string) => entry.includes('3KLife'))), false);
  assert.ok(validateEvidence?.suggestedPermissionLeases?.some((lease: any) => lease.permission === 'file.write' && lease.paths?.includes(targetRelative)));

  console.log('[validate-team-agents] ok (planning-path-lease-normalization)');
  return true;
}
