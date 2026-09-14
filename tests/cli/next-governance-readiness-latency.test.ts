import assert from 'node:assert/strict';
import { buildGovernanceReadinessHintContract } from '../../packages/cli/src/commands/next/governance-readiness.ts';

function makeInput(overrides: Partial<Parameters<typeof buildGovernanceReadinessHintContract>[0]> = {}) {
  let fullStatusCalls = 0;
  const input: Parameters<typeof buildGovernanceReadinessHintContract>[0] = {
    cwd: 'C:/fixture',
    channel: 'normal',
    prompt: 'ATM framework task',
    taskId: 'TASK-PRF-0109',
    actorId: 'test-actor',
    uniqueSorted: (values) => [...new Set(values)].sort(),
    readTaskWorkFiles: () => [],
    buildActiveWorkSummary: () => ({ schemaId: 'atm.activeWorkSummary.v1', status: 'fixture' }),
    createFrameworkModeStatus: () => {
      fullStatusCalls += 1;
      return { repoIdentity: { isFrameworkRepo: true } };
    },
    isFrameworkRepository: () => true,
    isFrameworkMaintenancePrompt: () => true,
    isProtectedFrameworkBranchTarget: () => false,
    ...overrides
  };
  return { input, getFullStatusCalls: () => fullStatusCalls };
}

{
  const fixture = makeInput();
  const result = buildGovernanceReadinessHintContract(fixture.input);
  assert.equal(fixture.getFullStatusCalls(), 0, 'normal guidance must not rebuild full framework status');
  assert.ok(result.earlyPreparation.some((entry) => entry.includes('framework-mode claim')));
}

{
  const fixture = makeInput({ frameworkClaimRequired: true });
  buildGovernanceReadinessHintContract(fixture.input);
  assert.equal(fixture.getFullStatusCalls(), 1, 'claim boundary must retain full framework status');
}

{
  const fixture = makeInput({
    isFrameworkRepository: () => false,
    isFrameworkMaintenancePrompt: () => true
  });
  const result = buildGovernanceReadinessHintContract(fixture.input);
  assert.equal(fixture.getFullStatusCalls(), 0, 'adopter guidance must stay on the lightweight path');
  assert.equal(result.earlyPreparation.some((entry) => entry.includes('framework-mode claim')), false);
}

console.log('[next-governance-readiness-latency.test] ok');
