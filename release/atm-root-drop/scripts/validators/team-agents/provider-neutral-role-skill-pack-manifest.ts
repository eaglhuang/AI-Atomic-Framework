import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildProviderNeutralRoleSkillPackManifest, runTeam } from '../../../packages/cli/src/commands/team.ts';
import { TEAM_PROVIDER_IDS } from '../../../packages/core/src/team-runtime/provider-contract.ts';

export async function runProviderNeutralRoleSkillPackManifestValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'provider-neutral-role-skill-pack-manifest') return false;

  const recipe = {
    schemaId: 'atm.teamRecipe.v1' as const,
    recipeId: 'validator.provider-neutral-manifest',
    agents: [
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
      { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
      { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] },
      { agentId: 'evidence-collector', role: 'evidenceCollector', profile: 'atm.evidenceCollector.v1', permissions: ['file.read'] }
    ]
  };
  const manifest = buildProviderNeutralRoleSkillPackManifest({
    recipe,
    selectionConfig: {
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
    }
  });
  assert.equal(manifest.schemaId, 'atm.teamRoleSkillPackManifest.v1');
  assert.equal(manifest.providerNeutral, true);
  assert.equal(manifest.discoveryMode, 'capability-driven');
  assert.equal(manifest.roleFirstProviderSecond, true);
  assert.deepEqual(manifest.sharedVocabulary.brokerConflict, [
    'decisionClass',
    'decisionReason',
    'violationStatus',
    'broker-conflict-blocked'
  ]);
  assert.equal(manifest.roles.length, recipe.agents.length);
  assert.ok(manifest.roles.every((role) => role.permissionLease.alignment === 'role-first'));
  assert.ok(manifest.roles.every((role) => role.providerCapabilities.length === TEAM_PROVIDER_IDS.length));
  assert.ok(manifest.roles.every((role) => role.providerCapabilities.every((provider) => provider.satisfiesRolePack)));
  const coordinator = manifest.roles.find((role) => role.role === 'coordinator');
  assert.ok(coordinator);
  assert.ok(coordinator?.capabilityTags.includes('lifecycle-authority'));
  assert.deepEqual(coordinator?.permissionLease.forbiddenPermissions, []);
  const implementer = manifest.roles.find((role) => role.role === 'implementer');
  assert.ok(implementer?.permissionLease.allowedPermissions.includes('file.write'));
  assert.ok(implementer?.permissionLease.forbiddenPermissions.includes('git.write'));
  assert.ok(implementer?.permissionLease.forbiddenPermissions.includes('task.lifecycle'));
  const validator = manifest.roles.find((role) => role.role === 'validator');
  assert.equal(validator?.selectedProvider.providerId, 'gemini');
  assert.equal(validator?.selectedProvider.source, 'role-override');
  assert.ok(validator?.providerCapabilities.some((provider) => provider.providerId === 'microsoft-foundry'));

  const planResult = await runTeam(['plan', '--task', 'TASK-SKL-0010', '--cwd', process.cwd(), '--json']);
  const planManifest = (planResult.evidence as any)?.teamPlan?.roleSkillPackManifest;
  assert.equal(planResult.ok, true);
  assert.equal(planManifest?.schemaId, 'atm.teamRoleSkillPackManifest.v1');
  assert.equal(planManifest?.roleFirstProviderSecond, true);
  assert.deepEqual(planManifest?.sharedVocabulary?.brokerConflict, manifest.sharedVocabulary.brokerConflict);

  const roleContractDoc = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'team-agents', 'role-skill-pack-contract.md'), 'utf8');
  assert.ok(roleContractDoc.includes('atm.teamRoleSkillPackManifest.v1'));
  assert.ok(roleContractDoc.includes('roleFirstProviderSecond'));
  const vendorRuntimeDoc = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'team-agents', 'team-vendor-runtime.md'), 'utf8');
  assert.ok(vendorRuntimeDoc.includes('capability-driven'));
  assert.ok(vendorRuntimeDoc.includes('atm.teamRoleSkillPackManifest.v1'));

  const teamSource = readFileSync(path.join(process.cwd(), 'packages', 'cli', 'src', 'commands', 'team.ts'), 'utf8');
  assert.ok(teamSource.includes('buildProviderNeutralRoleSkillPackManifest'));
  const validatorSource = readFileSync(new URL(import.meta.url), 'utf8');
  assert.ok(validatorSource.includes("taskCase !== 'provider-neutral-role-skill-pack-manifest'"));

  console.log('[validate-team-agents] ok (provider-neutral-role-skill-pack-manifest)');
  return true;
}
