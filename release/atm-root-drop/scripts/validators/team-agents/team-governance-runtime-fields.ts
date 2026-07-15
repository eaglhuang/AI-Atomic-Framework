import assert from 'node:assert/strict';

import { buildTeamPlan } from '../../../packages/cli/src/commands/team.ts';

export async function runTeamGovernanceRuntimeFieldsValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'team-governance-runtime-fields') return false;

  const recipe = {
    schemaId: 'atm.teamRecipe.v1' as const,
    recipeId: 'validator.governance-fields',
    agents: [
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
      { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
      { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
    ]
  };
  const allowedPlan = buildTeamPlan({
    task: { workItemId: 'TASK-TEAM-0056', title: 'Governance runtime fields' },
    recipe,
    writePaths: ['packages/cli/src/commands/team.ts'],
    validation: { ok: true, findings: [] },
    brokerLane: safeBrokerLane(),
    requestedTeamSize: 'L1'
  }) as any;
  assert.equal(allowedPlan.decisionClass, 'auto-execution');
  assert.equal(allowedPlan.violationStatus, 'none');
  assert.equal(allowedPlan.requiresHumanSignoff, false);
  assert.equal(allowedPlan.requiresAdr, false);
  const adrPlan = buildTeamPlan({
    task: { workItemId: 'TASK-TEAM-0056', title: 'Governance runtime fields' },
    recipe,
    writePaths: ['packages/cli/src/commands/team.ts'],
    validation: { ok: true, findings: [] },
    brokerLane: {
      ...safeBrokerLane(),
      decision: { verdict: 'needs-steward', reason: 'ADR required for steward lane.' },
      blockedReasons: ['ADR required for steward lane.']
    },
    requestedTeamSize: 'L1'
  }) as any;
  assert.equal(adrPlan.decisionClass, 'adr-required');
  assert.equal(adrPlan.violationStatus, 'adr-required');
  assert.equal(adrPlan.requiresHumanSignoff, true);
  assert.equal(adrPlan.requiresAdr, true);
  const blockedPlan = buildTeamPlan({
    task: { workItemId: 'TASK-TEAM-0056', title: 'Governance runtime fields' },
    recipe,
    writePaths: ['packages/cli/src/commands/team.ts'],
    validation: {
      ok: false,
      findings: [{
        level: 'error',
        code: 'ATM_TEAM_WRITE_SCOPE_EXCEEDED',
        summary: 'Write scope exceeded.',
        detail: 'file.write lease outside task scope.',
        suggestedFix: 'Narrow the lease.'
      }]
    },
    brokerLane: safeBrokerLane(),
    requestedTeamSize: 'L1'
  }) as any;
  assert.equal(blockedPlan.decisionClass, 'blocked');
  assert.equal(blockedPlan.violationStatus, 'blocked');
  assert.equal(blockedPlan.governanceRuntime.schemaId, 'atm.teamGovernanceRuntimeFields.v1');

  console.log('[validate-team-agents] ok (team-governance-runtime-fields)');
  return true;
}

function safeBrokerLane(): any {
  return {
    decision: { verdict: 'safe-to-start' },
    chosenLane: 'direct-brokered',
    safeToStart: true,
    blockedReasons: [],
    stewardId: null,
    composerPath: null
  };
}
