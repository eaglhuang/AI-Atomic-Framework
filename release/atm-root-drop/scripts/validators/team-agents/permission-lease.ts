import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runTeam, validateTeamPermissionModel } from '../../../packages/cli/src/commands/team.ts';
import { createTempWorkspace } from '../../temp-root.ts';

type FixtureAgent = {
  agentId: string;
  role: string;
  profile?: string;
  language?: string;
  permissions: string[];
};

export async function runPermissionLeaseValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'permission-lease') return false;

  const healthyRecipe = {
    schemaId: 'atm.teamRecipe.v1' as const,
    recipeId: 'validator.healthy',
    agents: [
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
      { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
      { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
    ] satisfies FixtureAgent[]
  };
  const writePaths = ['packages/cli/src/commands/team.ts'];

  const healthy = validateTeamPermissionModel(healthyRecipe, writePaths);
  assert.equal(healthy.ok, true);
  assert.equal(healthy.findings.length, 0);

  const duplicateOwnersRecipe = {
    ...healthyRecipe,
    agents: [
      ...healthyRecipe.agents,
      { agentId: 'extra-coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['git.write'] }
    ]
  } as any;
  const duplicateOwners = validateTeamPermissionModel(duplicateOwnersRecipe, writePaths);
  assert.equal(duplicateOwners.ok, false);
  const duplicateFinding = duplicateOwners.findings.find((finding) => finding.code === 'ATM_TEAM_PERMISSION_CONFLICT' && finding.permission === 'git.write');
  assert.ok(duplicateFinding);
  assert.ok(duplicateFinding?.summary);
  assert.ok(duplicateFinding?.suggestedFix);
  assert.equal(duplicateFinding?.permission, 'git.write');

  const scopedLeaseMissing = validateTeamPermissionModel(healthyRecipe, []);
  assert.equal(scopedLeaseMissing.ok, false);
  const scopeFinding = scopedLeaseMissing.findings.find((finding) => finding.code === 'ATM_TEAM_PERMISSION_SCOPE_REQUIRED' && finding.permission === 'file.write');
  assert.ok(scopeFinding);
  assert.ok(scopeFinding?.summary);
  assert.ok(scopeFinding?.role);
  assert.ok(scopeFinding?.suggestedFix);

  const evidenceWriteDriftRecipe = {
    ...healthyRecipe,
    agents: healthyRecipe.agents.map((agent) => agent.role === 'coordinator'
      ? { ...agent, permissions: ['task.lifecycle', 'git.write'] }
      : agent.role === 'implementer'
        ? { ...agent, permissions: ['file.write', 'evidence.write'] }
        : agent)
  };
  const evidenceWriteDrift = validateTeamPermissionModel(evidenceWriteDriftRecipe, writePaths);
  assert.equal(evidenceWriteDrift.ok, false);
  const evidenceFinding = evidenceWriteDrift.findings.find((finding) => finding.code === 'ATM_TEAM_UNIQUE_OWNER_REQUIRED' && finding.permission === 'evidence.write');
  assert.ok(evidenceFinding);
  assert.ok(evidenceFinding?.summary);
  assert.ok(evidenceFinding?.suggestedFix);

  const readOnlyWriteRecipe = {
    ...healthyRecipe,
    agents: healthyRecipe.agents.map((agent) => agent.role === 'scopeGuardian'
      ? { ...agent, permissions: ['file.read', 'file.write'] }
      : agent)
  };
  const readOnlyWrite = validateTeamPermissionModel(readOnlyWriteRecipe, writePaths);
  assert.equal(readOnlyWrite.ok, false);
  const readOnlyFinding = readOnlyWrite.findings.find((finding) => finding.code === 'ATM_TEAM_READONLY_ROLE_WRITE_FORBIDDEN');
  assert.ok(readOnlyFinding);
  assert.equal(readOnlyFinding?.role, 'scopeGuardian');
  assert.ok(readOnlyFinding?.summary);
  assert.ok(readOnlyFinding?.suggestedFix);

  const validateResult = await runTeam(['validate', '--task', 'TASK-TEAM-0012', '--cwd', process.cwd(), '--json']);
  const evidence = validateResult.evidence as any;
  assert.equal(validateResult.ok, true);
  assert.equal(evidence?.action, 'validate');
  assert.equal(evidence?.validation?.ok, true);
  assert.ok(Array.isArray(evidence?.validation?.findings));
  assert.ok(Array.isArray(evidence?.suggestedPermissionLeases));
  assert.deepEqual(
    evidence?.suggestedPermissionLeases?.map((lease: any) => lease.permission).sort(),
    ['evidence.write', 'file.write', 'git.write', 'handoff.materialize', 'handoff.read', 'task.lifecycle']
  );

  const crossRepoRoot = createTempWorkspace('team-cross-repo-planning-');
  const targetRepo = path.join(crossRepoRoot, 'target');
  const planningRepo = path.join(crossRepoRoot, 'planning');
  const planningCardPath = path.join(planningRepo, 'docs', 'ai_atomic_framework', 'rft-hardening', 'tasks', 'TASK-AAO-0118.task.md');
  mkdirSync(path.join(targetRepo, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.dirname(planningCardPath), { recursive: true });
  writeFileSync(planningCardPath, '# Planning-only Phase 0 card\n', 'utf8');
  writeFileSync(path.join(targetRepo, '.atm', 'history', 'tasks', 'TASK-CROSS-PLANNING.json'), `${JSON.stringify({
    schemaId: 'atm.task.v1',
    workItemId: 'TASK-CROSS-PLANNING',
    title: 'Cross repo planning-only team validation',
    status: 'ready',
    planningRepo,
    targetRepo,
    scopePaths: [planningCardPath],
    deliverables: [],
    validators: ['node --version']
  }, null, 2)}\n`, 'utf8');
  try {
    const planningOnly = await runTeam(['validate', '--task', 'TASK-CROSS-PLANNING', '--cwd', targetRepo, '--json']);
    const planningOnlyEvidence = planningOnly.evidence as any;
    assert.equal(planningOnly.ok, true, 'planning-repo absolute scope paths must not block Team validate as write traversal');
    assert.equal(planningOnlyEvidence?.validation?.ok, true);
    assert.deepEqual(planningOnlyEvidence?.suggestedPermissionLeases?.filter((lease: any) => lease.permission === 'file.write') ?? [], []);
    assert.equal(
      planningOnlyEvidence?.validation?.findings?.some((finding: any) => finding.code === 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL'),
      false,
      'planning-repo absolute paths must be classified away from file.write traversal findings'
    );
  } finally {
    rmSync(crossRepoRoot, { recursive: true, force: true });
  }

  console.log('[validate-team-agents] ok (permission-lease)');
  return true;
}
