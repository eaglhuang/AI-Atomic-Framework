import assert from 'node:assert/strict';
import { buildTeamPlan } from '../../../packages/cli/src/commands/team.ts';

function safeBrokerLane(): any {
  return {
    decision: { verdict: 'safe-to-start' },
    chosenLane: 'direct-brokered',
    safeToStart: true,
    blockedReasons: [],
    queueRequired: false,
    queueReason: null,
    taskId: 'TASK-TEAM-0062'
  };
}

export function runRuntimeTierContractValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'runtime-tier-contract') return false;

  const recipe = {
    schemaId: 'atm.teamRecipe.v1' as const,
    recipeId: 'validator.runtime-tier',
    agents: [
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
      { agentId: 'reader', role: 'reader', profile: 'atm.reader.v1', permissions: ['file.read'] },
      { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', permissions: ['file.write'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
    ]
  };
  const plan = buildTeamPlan({
    task: { workItemId: 'TASK-TEAM-0062', title: 'Runtime tier contract' },
    recipe,
    writePaths: ['packages/cli/src/commands/team.ts'],
    validation: { ok: true, findings: [] },
    brokerLane: safeBrokerLane(),
    requestedTeamSize: 'L5'
  }) as any;
  assert.equal(plan.runtimeTierContract.schemaId, 'atm.teamRuntimeTierContract.v1');
  const roleTiers = Object.fromEntries(plan.runtimeTierContract.roleTiers.map((entry: any) => [entry.role, entry.runtimeTier]));
  assert.equal(roleTiers.reader, 'raw-api');
  assert.equal(roleTiers.validator, 'raw-api');
  assert.equal(roleTiers.reviewAgent, 'raw-api');
  assert.equal(roleTiers.knowledgeScout, 'raw-api');
  assert.equal(roleTiers.implementer, 'agent-sdk');
  assert.equal(roleTiers.coordinator, 'agent-sdk');
  assert.equal(roleTiers.lieutenant, 'editor');
  assert.ok(plan.runtimeTierContract.providerContractCompatibility.includes('RawChatAdapter'));
  console.log('[validate-team-agents] ok (runtime-tier-contract)');
  return true;
}
