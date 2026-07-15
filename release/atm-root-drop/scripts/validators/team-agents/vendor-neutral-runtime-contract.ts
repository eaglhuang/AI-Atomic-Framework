import assert from 'node:assert/strict';
import { TEAM_PROVIDER_IDS, createTeamProviderMetadata, supportsVendorNeutralProviders } from '../../../packages/core/src/team-runtime/provider-contract.ts';
import { TeamProviderRegistry } from '../../../packages/core/src/team-runtime/provider-registry.ts';
import { runProviderOrchestration } from '../../../packages/core/src/team-runtime/execution-orchestrator.ts';

export async function runVendorNeutralRuntimeContractValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'vendor-neutral-runtime-contract') return false;

  const metadata = TEAM_PROVIDER_IDS.map((providerId) => createTeamProviderMetadata(providerId));
  assert.equal(supportsVendorNeutralProviders(metadata), true);
  const registry = new TeamProviderRegistry();
  registry.registerDefaults(TEAM_PROVIDER_IDS);
  assert.equal(registry.list().length, TEAM_PROVIDER_IDS.length);
  const provider = registry.get('claude-code');
  assert.ok(provider);
  const orchestration = await runProviderOrchestration(provider, {
    taskId: 'TASK-TEAM-0037',
    role: 'implementer',
    runtimeMode: 'broker-only',
    providerId: 'claude-code',
    sdkId: 'claude-code',
    modelId: 'claude-opus',
    retries: 2
  });
  assert.equal(orchestration.ok, true);
  assert.equal(orchestration.coordinatorOwnedAuthority, true);
  console.log('[validate-team-agents] ok (vendor-neutral-runtime-contract)');
  return true;
}
