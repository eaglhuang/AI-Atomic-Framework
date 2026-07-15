import assert from 'node:assert/strict';

import { runTeam, validateTeamPermissionModel } from '../../../packages/cli/src/commands/team.ts';

export async function runFileWriteScopeValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'file-write-scope') return false;

  const recipe = {
    schemaId: 'atm.teamRecipe.v1' as const,
    recipeId: 'validator.file-write-scope',
    agents: [
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
      { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
    ]
  };
  const allowedWritePaths = [
    'packages/cli/src/commands/team.ts',
    'scripts/validate-team-agents.ts'
  ];

  const validLease = validateTeamPermissionModel(recipe, ['packages\\cli\\src\\commands\\team.ts'], { allowedWritePaths });
  assert.equal(validLease.ok, true);
  assert.equal(validLease.findings.length, 0);

  const outOfBounds = validateTeamPermissionModel(recipe, ['packages/cli/src/commands/next.ts'], { allowedWritePaths });
  assert.equal(outOfBounds.ok, false);
  const outOfBoundsFinding = outOfBounds.findings.find((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_OUT_OF_BOUNDS');
  assert.ok(outOfBoundsFinding);
  assert.ok(outOfBoundsFinding?.detail.includes('packages/cli/src/commands/next.ts'));
  assert.deepEqual(outOfBoundsFinding?.paths, ['packages/cli/src/commands/next.ts']);
  assert.ok(outOfBoundsFinding?.suggestedFix.includes('scope amendment'));

  const traversal = validateTeamPermissionModel(recipe, ['packages/cli/src/commands/../next.ts'], { allowedWritePaths });
  assert.equal(traversal.ok, false);
  const traversalFinding = traversal.findings.find((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL');
  assert.ok(traversalFinding);
  assert.ok(traversalFinding?.detail.includes('packages/cli/src/commands/../next.ts'));

  const runtimePath = validateTeamPermissionModel(recipe, ['.atm/runtime/team-runs/example.json'], {
    allowedWritePaths: ['.atm/runtime/team-runs/example.json']
  });
  assert.equal(runtimePath.ok, false);
  const runtimeFinding = runtimePath.findings.find((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN');
  assert.ok(runtimeFinding);
  assert.ok(runtimeFinding?.detail.includes('.atm/runtime/team-runs/example.json'));

  const historyPath = validateTeamPermissionModel(recipe, ['.atm/history/tasks/TASK-TEAM-0013.json'], {
    allowedWritePaths: ['.atm/history/tasks/TASK-TEAM-0013.json']
  });
  assert.equal(historyPath.ok, false);
  const historyFinding = historyPath.findings.find((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN');
  assert.ok(historyFinding);
  assert.ok(historyFinding?.detail.includes('.atm/history/tasks/TASK-TEAM-0013.json'));

  const validateResult = await runTeam(['validate', '--task', 'TASK-TEAM-0013', '--cwd', process.cwd(), '--json']);
  const evidence = validateResult.evidence as any;
  assert.equal(validateResult.ok, true);
  assert.equal(evidence?.action, 'validate');
  assert.equal(evidence?.validation?.ok, true);
  assert.ok(Array.isArray(evidence?.validation?.findings));
  assert.ok(evidence?.suggestedPermissionLeases?.some((lease: any) => lease.permission === 'file.write'));

  console.log('[validate-team-agents] ok (file-write-scope)');
  return true;
}
