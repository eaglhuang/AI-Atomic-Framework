import assert from 'node:assert/strict';
import { digestTeamAdmissionProjection, projectTeamAdmission } from '../../packages/cli/src/commands/team/admission.ts';
import { projectTeamLevelRecommendation } from '../../packages/cli/src/commands/next/active-work-summary.ts';

const baseInput = {
  workloadClass: 'code-change',
  productionDefault: true,
  workGroups: [
    { groupId: 'impl', files: ['packages/cli/src/a.ts'], capability: 'code', mutuallyExclusive: true },
    { groupId: 'test', files: ['tests/cli/a.test.ts'], capability: 'light', mutuallyExclusive: true }
  ],
  sharedBottleneckFiles: [],
  modelOptions: [
    { providerId: 'openai' as const, modelId: 'gpt-5.4', plan: 'standard', capability: 'code', dataPolicy: 'private-ok' as const, risk: 'medium' as const, costPerUnit: 2 },
    { providerId: 'gemini-direct' as const, modelId: 'gemini-3.5-flash', plan: 'paid', capability: 'light', dataPolicy: 'private-ok' as const, risk: 'low' as const, costPerUnit: 0.2 }
  ],
  fanOutCap: 2,
  quotaProbeDigest: `sha256:${'1'.repeat(64)}`,
  quotaOk: true,
  estimatedQueueWaitSeconds: 4,
  perWorkerSpendingCeiling: 0.20,
  totalSpendingCeiling: 0.40,
  stopLossThreshold: 0.50,
  pricingCatalogFresh: true,
  subscriptionAllocationComplete: true,
  providerUsageComplete: true,
  teamRosterFingerprintDigest: `sha256:${'2'.repeat(64)}`,
  fullyLoadedCostRatio: 0.72,
  timeRatio: 0.70,
  tokenRatio: 1.40,
  qualityParity: true,
  noWorseRepairResidue: true
};

const open = projectTeamAdmission(baseInput);
assert.equal(open.decision, 'open-team');
assert.equal(open.workerCount, 2);
assert.equal(open.promotionEligible, true);
assert.equal(open.projected.tokenRatio, 1.40);
assert.match(digestTeamAdmissionProjection(open), /^sha256:[a-f0-9]{64}$/);

const bottleneck = projectTeamAdmission({
  ...baseInput,
  sharedBottleneckFiles: ['packages/cli/src/shared.ts']
});
assert.equal(bottleneck.decision, 'single-agent');
assert.equal(bottleneck.promotionEligible, false);
assert.match(bottleneck.reason, /Shared bottleneck/);

const incompleteCost = projectTeamAdmission({
  ...baseInput,
  providerUsageComplete: false
});
assert.equal(incompleteCost.decision, 'single-agent');
assert.equal(incompleteCost.promotionEligible, false);
assert.match(incompleteCost.reason, /Provider usage/);

const thresholdMiss = projectTeamAdmission({
  ...baseInput,
  fullyLoadedCostRatio: 0.88
});
assert.equal(thresholdMiss.decision, 'downgrade');
assert.equal(thresholdMiss.nextExperimentTarget?.includes('Reduce fan-out'), true);

const unknownWorkload = projectTeamAdmission({
  ...baseInput,
  workloadClass: null
});
assert.equal(unknownWorkload.boundedExperiment, true);
assert.equal(unknownWorkload.promotionEligible, false);

const level = projectTeamLevelRecommendation({
  ownFiles: ['packages/cli/src/commands/next/active-work-summary.ts'],
  foreignFiles: ['packages/cli/src/commands/next/active-work-summary.ts'],
  stagedFiles: [],
  foreignActorIds: ['other-captain']
});
assert.equal(level.level, 'L5');
assert.deepEqual(level.overlappingFiles, ['packages/cli/src/commands/next/active-work-summary.ts']);

const dirtyWipLevel = projectTeamLevelRecommendation({
  ownFiles: ['docs/readme.md'],
  foreignFiles: [],
  foreignDirtyFiles: ['packages/cli/src/commands/broker/dirty-wip.ts'],
  stagedFiles: [],
  foreignActorIds: ['other-captain']
});
assert.equal(dirtyWipLevel.level, 'L3');
assert.match(dirtyWipLevel.reason, /dirty WIP/);

const dirtyWipOverlap = projectTeamLevelRecommendation({
  ownFiles: ['packages/cli/src/commands/broker/dirty-wip.ts'],
  foreignFiles: [],
  foreignDirtyFiles: ['packages/cli/src/commands/broker/dirty-wip.ts'],
  stagedFiles: [],
  foreignActorIds: ['other-captain']
});
assert.equal(dirtyWipOverlap.level, 'L3');
assert.deepEqual(dirtyWipOverlap.overlappingFiles, ['packages/cli/src/commands/broker/dirty-wip.ts']);

console.log('[team-admission-projection] ok');
