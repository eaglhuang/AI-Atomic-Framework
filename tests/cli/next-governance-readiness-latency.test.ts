import assert from 'node:assert/strict';
import { buildGovernanceReadinessHintContract } from '../../packages/cli/src/commands/next/governance-readiness.ts';

function makeInput(overrides: Partial<Parameters<typeof buildGovernanceReadinessHintContract>[0]> = {}) {
  let fullStatusCalls = 0;
  const input: Parameters<typeof buildGovernanceReadinessHintContract>[0] = {
    cwd: process.cwd(),
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
  const fixture = makeInput({ channel: null, deferAheadCount: true });
  const result = buildGovernanceReadinessHintContract(fixture.input);
  assert.equal(result.aheadCount, null, 'unscoped guidance must report deferred ahead count as unknown, not zero');
}

{
  const fixture = makeInput({ channel: 'normal' });
  const result = buildGovernanceReadinessHintContract(fixture.input);
  assert.equal(typeof result.aheadCount, 'number', 'admission-boundary guidance must still measure the ahead count');
  assert.equal((result.activeWorkSummary as { status?: string }).status, 'fixture', 'admission-boundary guidance must still enumerate active work');
}

{
  const fixture = makeInput({ channel: 'fast', deferAheadCount: true, deferActiveWorkSummary: true });
  const result = buildGovernanceReadinessHintContract(fixture.input);
  assert.equal((result.activeWorkSummary as { status?: string }).status, 'deferred', 'pre-claim guidance must defer active-work enumeration');
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
