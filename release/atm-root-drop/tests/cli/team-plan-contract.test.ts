import assert from 'node:assert/strict';
import {
  buildTeamGrowthContract,
  buildTeamRoleRoutingMatrix,
  buildTeamRoleSkillPackContract
} from '../../packages/cli/src/commands/team.ts';

const recipe = {
  schemaId: 'atm.teamRecipe.v1',
  recipeId: 'atm.test.contract',
  agents: [
    {
      agentId: 'coordinator',
      role: 'coordinator',
      permissions: ['task.lifecycle', 'git.write', 'evidence.write']
    },
    {
      agentId: 'implementer-main',
      role: 'implementer',
      permissions: ['file.write']
    },
    {
      agentId: 'validator-main',
      role: 'validator',
      permissions: ['exec.validator']
    }
  ]
} as const;

const roleSkillPacks = buildTeamRoleSkillPackContract(recipe as any);
assert.equal(roleSkillPacks.schemaId, 'atm.teamRoleSkillPackContract.v1');
assert.equal(roleSkillPacks.providerNeutral, true);
assert.equal(roleSkillPacks.coordinatorOwnsLifecycle, true);
assert.equal(roleSkillPacks.roles.length, 3);

const coordinator = roleSkillPacks.roles.find((entry) => entry.role === 'coordinator');
assert.ok(coordinator, 'coordinator role contract should exist');
assert.equal(coordinator?.skillPackId, 'atm.role-pack.coordinator');
assert.deepEqual(coordinator?.forbiddenPermissions, []);

const implementer = roleSkillPacks.roles.find((entry) => entry.role === 'implementer');
assert.ok(implementer, 'implementer role contract should exist');
assert.equal(implementer?.skillPackId, 'atm.role-pack.implementer');
assert.equal(implementer?.growthContractAttachment, 'shared-team-growth-contract');
assert.deepEqual(implementer?.forbiddenPermissions, ['task.lifecycle', 'git.write', 'evidence.write']);

const routingMatrix = buildTeamRoleRoutingMatrix(roleSkillPacks);
assert.equal(routingMatrix.schemaId, 'atm.teamRoleRoutingMatrix.v1');
assert.equal(routingMatrix.providerNeutral, true);
assert.equal(routingMatrix.coordinatorOwnsLifecycle, true);
assert.equal(routingMatrix.routes.length >= 3, true);
assert.equal(routingMatrix.routes.some((route) => route.workstream === 'scoped-implementation' && route.primaryRole === 'implementer'), true);
assert.equal(routingMatrix.routes.some((route) => route.workstream === 'validation-and-evidence' && route.primaryRole === 'validator'), true);

const growthContract = buildTeamGrowthContract();
assert.equal(growthContract.schemaId, 'atm.teamGrowthContract.v1');
assert.equal(growthContract.sharedAcrossRolePacks, true);
assert.equal(growthContract.taxonomy.includes('route-confusion'), true);
assert.equal(growthContract.taxonomy.includes('role-specific-friction'), true);
assert.deepEqual(growthContract.captureTemplate, [
  'Trigger',
  'Symptom',
  'Correct route',
  'Durable rule',
  'Promotion target',
  'Reuse scope'
]);
assert.deepEqual(growthContract.promotionPolicy, {
  stableRuleTarget: 'SKILL.md',
  rawCaseTarget: 'docs/governance/team-agents/role-pack-learning-loop.md'
});

console.log('[team-plan-contract:test] ok');
