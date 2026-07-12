import assert from 'node:assert/strict';
import {
  buildTeamLeaseConflictDetails,
  buildTeamLeaseNotFoundDetails,
  buildTeamGrowthContract,
  buildTeamRuntimePilot,
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
const implementationRoute = routingMatrix.routes.find((route) => route.workstream === 'scoped-implementation');
assert.ok(implementationRoute, 'scoped implementation route should exist');
assert.deepEqual(implementationRoute?.roleOrder, ['coordinator', 'implementer']);
assert.deepEqual(implementationRoute?.advisoryOnlyRoles, []);
assert.equal(implementationRoute?.lifecycleOwner, 'coordinator');
assert.equal(implementationRoute?.stopConditions.includes('broker-conflict-blocked'), true);
const brokerConflictRoute = routingMatrix.routes.find((route) => route.workstream === 'broker-conflict-resolution');
assert.ok(brokerConflictRoute, 'broker conflict route should exist');
assert.equal(brokerConflictRoute?.playbookSlice, 'broker-conflict-resolution');
assert.equal(brokerConflictRoute?.stopConditions.includes('missing-atm.brokerConflictResolution.v1'), true);

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

const runtimePilot = buildTeamRuntimePilot({
  roleSkillPacks,
  routingMatrix,
  growthContract,
  validation: {
    ok: false,
    findings: [
      {
        level: 'error',
        code: 'ATM_TEAM_LEASE_CONFLICT',
        summary: 'Takeover required before conflict arbitration',
        detail: 'Blocked by stale lease epoch.',
        suggestedFix: 'Run the governed takeover or cleanup path before retrying.'
      }
    ]
  },
  brokerLane: {
    blockedReasons: ['Takeover required before conflict arbitration'],
    decision: {
      verdict: 'blocked-active-lease',
      reason: 'Takeover required before conflict arbitration',
      conflicts: [
        {
          kind: 'lease',
          detail: 'Active lease epoch stale.'
        }
      ]
    }
  } as any
});
assert.equal(runtimePilot.schemaId, 'atm.teamRuntimePilot.v1');
assert.equal(runtimePilot.providerNeutral, true);
assert.equal(runtimePilot.coordinatorOwnsLifecycle, true);
assert.equal(runtimePilot.pilotMode, 'role-trio');
assert.deepEqual(runtimePilot.selectedRoles, ['coordinator', 'implementer', 'validator']);
assert.equal(runtimePilot.selectedSkillPackIds.includes('atm.role-pack.coordinator'), true);
assert.equal(runtimePilot.roleConfusionReduction.length >= 3, true);
assert.equal(runtimePilot.actionableRefinementFindings.length >= 2, true);
assert.equal(runtimePilot.actionableRefinementFindings.every((entry) => entry.promotionTarget === 'docs/governance/team-agents/role-pack-learning-loop.md'), true);

const activeLeases = [
  { permission: 'file.write', agentId: 'implementer-typescript', paths: ['packages/cli/src/commands/team.ts'] },
  { permission: 'exec.validator', agentId: 'validator', paths: ['tests/cli/team-plan-contract.test.ts'] }
];
const leaseConflictDetails = buildTeamLeaseConflictDetails({
  teamRunId: 'team-test',
  permission: 'file.write',
  requestedOwner: 'implementer',
  conflict: activeLeases[0]!,
  currentLeases: activeLeases
});
assert.equal(leaseConflictDetails.currentOwner, 'implementer-typescript');
assert.deepEqual(leaseConflictDetails.currentOwnerPaths, ['packages/cli/src/commands/team.ts']);
assert.equal(
  leaseConflictDetails.currentOwnerReleaseCommand,
  'node atm.mjs team release --team team-test --actor implementer-typescript --permission file.write --json'
);
assert.equal(leaseConflictDetails.activeLeases.length, 1);
assert.equal(leaseConflictDetails.activeLeases[0]?.agentId, 'implementer-typescript');
assert.equal(leaseConflictDetails.requiredCommand, leaseConflictDetails.currentOwnerReleaseCommand);

const leaseNotFoundDetails = buildTeamLeaseNotFoundDetails({
  teamRunId: 'team-test',
  permission: 'file.write',
  actorId: 'implementer',
  currentLeases: activeLeases
});
assert.equal(leaseNotFoundDetails.actorId, 'implementer');
assert.equal(leaseNotFoundDetails.holderCount, 1);
assert.equal(leaseNotFoundDetails.activeLeases[0]?.agentId, 'implementer-typescript');
assert.equal(
  leaseNotFoundDetails.requiredCommand,
  'node atm.mjs team release --team team-test --actor implementer-typescript --permission file.write --json'
);

console.log('[team-plan-contract:test] ok');
