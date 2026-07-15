import assert from 'node:assert/strict';

import { buildTeamPlan } from '../../../packages/cli/src/commands/team.ts';
import { mergeTeamProviderSelectionConfig, resolveTeamProviderSelection } from '../../../packages/core/src/team-runtime/provider-selection.ts';

export async function runPerRoleProviderSelectionConfigValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'per-role-provider-selection-config') return false;

  const selectionConfig = mergeTeamProviderSelectionConfig({
    repoConfig: {
      repoDefault: {
        providerId: 'openai',
        sdkId: 'responses',
        modelId: 'gpt-5-mini',
        runtimeMode: 'broker-only'
      },
      roleOverrides: {
        validator: {
          providerId: 'gemini',
          sdkId: 'gemini-cli',
          modelId: 'gemini-2.5-pro',
          runtimeMode: 'editor-subagent'
        }
      }
    },
    cliRoleOverrides: ['validator=claude-code:claude-sonnet:claude-code:editor-subagent']
  });
  const validatorSelection = resolveTeamProviderSelection('validator', selectionConfig);
  assert.equal(validatorSelection.providerId, 'claude-code');
  assert.equal(validatorSelection.modelId, 'claude-sonnet');
  assert.equal(validatorSelection.runtimeMode, 'editor-subagent');
  const readerSelection = resolveTeamProviderSelection('reader', selectionConfig);
  assert.equal(readerSelection.providerId, 'openai');
  assert.equal(readerSelection.modelId, 'gpt-5-mini');

  const task = {
    workItemId: 'TASK-TEAM-0051',
    title: 'Per-role provider config and L5 roster projection',
    scopePaths: ['packages/cli/src/commands/team.ts'],
    deliverables: ['packages/cli/src/commands/team.ts'],
    validators: ['npm run typecheck']
  };
  const recipe = {
    schemaId: 'atm.teamRecipe.v1' as const,
    recipeId: 'atm.default.normal.typescript',
    language: 'typescript',
    agents: [
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
      { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
      { agentId: 'reader', role: 'reader', profile: 'atm.reader.v1', permissions: ['file.read'] },
      { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
      { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] },
      { agentId: 'evidence-collector', role: 'evidenceCollector', profile: 'atm.evidenceCollector.v1', permissions: ['file.read'] }
    ]
  };
  const plan = buildTeamPlan({
    task,
    recipe,
    writePaths: ['packages/cli/src/commands/team.ts'],
    validation: { ok: true, findings: [] },
    brokerLane: safeBrokerLane(),
    requestedTeamSize: 'L5',
    providerSelectionConfig: selectionConfig,
    providerSelectionSource: {
      schemaId: 'atm.teamAgentsConfig.v1',
      path: '.atm/config/team-provider-selection.json',
      loaded: true,
      cliOverrideCount: 1
    }
  }) as any;
  assert.equal(plan.teamLevel, 'L5');
  assert.equal(plan.captainDecision.teamLevel, 'L5');
  assert.equal(plan.captainDecision.teamLevelSource, 'manual');
  assert.equal(plan.captainDecision.teamSize, 'large');
  assert.equal(plan.providerSelectionSource.loaded, true);
  assert.deepEqual(plan.rosterProjection.activeRoles, [
    'coordinator',
    'atomizationPlanner',
    'reader',
    'scopeGuardian',
    'implementer',
    'validator',
    'evidenceCollector',
    'lieutenant',
    'reviewAgent',
    'knowledgeScout'
  ]);
  assert.deepEqual(plan.rosterProjection.syntheticRoles, ['lieutenant', 'reviewAgent', 'knowledgeScout']);
  const validatorManifest = plan.roleSkillPackManifest.roles.find((entry: any) => entry.role === 'validator');
  assert.equal(validatorManifest.selectedProvider.providerId, 'claude-code');
  assert.equal(validatorManifest.selectedProvider.modelId, 'claude-sonnet');
  const l1Plan = buildTeamPlan({
    task,
    recipe,
    writePaths: ['packages/cli/src/commands/team.ts'],
    validation: { ok: true, findings: [] },
    brokerLane: safeBrokerLane(),
    requestedTeamSize: 'L1',
    providerSelectionConfig: selectionConfig
  }) as any;
  assert.equal(l1Plan.teamLevel, 'L1');
  assert.deepEqual(l1Plan.rosterProjection.activeRoles, ['coordinator', 'atomizationPlanner', 'implementer', 'validator']);
  const l4Plan = buildTeamPlan({
    task,
    recipe,
    writePaths: ['packages/cli/src/commands/team.ts'],
    validation: { ok: true, findings: [] },
    brokerLane: safeBrokerLane(),
    requestedTeamSize: 'L4',
    providerSelectionConfig: selectionConfig
  }) as any;
  assert.equal(l4Plan.teamLevel, 'L4');
  assert.deepEqual(l4Plan.rosterProjection.syntheticRoles, ['lieutenant']);
  assert.ok(l4Plan.rosterProjection.activeRoles.includes('lieutenant'));
  assert.ok(!l4Plan.rosterProjection.activeRoles.includes('reviewAgent'));
  assert.ok(!l4Plan.rosterProjection.activeRoles.includes('knowledgeScout'));
  assert.ok(plan.rosterProjection.activeRoles.includes('reviewAgent'));
  assert.ok(plan.rosterProjection.activeRoles.includes('knowledgeScout'));

  console.log('[validate-team-agents] ok (per-role-provider-selection-config)');
  return true;
}

function safeBrokerLane(): any {
  return {
    decision: { verdict: 'safe-to-start' },
    chosenLane: 'direct-brokered',
    safeToStart: true,
    blockedReasons: [],
    queueRequired: false,
    queueReason: null,
    taskId: 'TASK-TEAM-0051'
  };
}
