import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type DogfoodRun = {
  label: string;
  wallClockMs: number;
  incrementalUsd: number;
  fullyLoadedUsd: number;
  listPriceEquivalentUsd: number;
  promptTokens: number;
  completionTokens: number;
  qualityGatePassed: boolean;
  governanceGatePassed: boolean;
  canonicalPricingEvidence: boolean;
  cheapWorkerModels: boolean;
  roleCollapse: boolean;
  promptCaching: boolean;
  mixedModelRouting: boolean;
  stopLossEnabled: boolean;
};

type PromotionDecision = {
  promote: boolean;
  reasons: string[];
  wallClockImprovementRatio: number;
  fullyLoadedCostIncreaseRatio: number;
  listPriceCostIncreaseRatio: number;
};

const singleAgentBaseline: DogfoodRun = {
  label: 'single-agent-baseline',
  wallClockMs: 120_000,
  incrementalUsd: 0.42,
  fullyLoadedUsd: 0.5,
  listPriceEquivalentUsd: 0.46,
  promptTokens: 68_000,
  completionTokens: 7_200,
  qualityGatePassed: true,
  governanceGatePassed: true,
  canonicalPricingEvidence: true,
  cheapWorkerModels: false,
  roleCollapse: false,
  promptCaching: false,
  mixedModelRouting: false,
  stopLossEnabled: false
};

const controlledTeamDogfood: DogfoodRun = {
  label: 'controlled-team-dogfood',
  wallClockMs: 90_000,
  incrementalUsd: 0.18,
  fullyLoadedUsd: 0.7,
  listPriceEquivalentUsd: 0.64,
  promptTokens: 96_000,
  completionTokens: 10_400,
  qualityGatePassed: true,
  governanceGatePassed: true,
  canonicalPricingEvidence: true,
  cheapWorkerModels: true,
  roleCollapse: true,
  promptCaching: true,
  mixedModelRouting: true,
  stopLossEnabled: true
};

function evaluatePromotion(baseline: DogfoodRun, team: DogfoodRun): PromotionDecision {
  const reasons: string[] = [];
  const wallClockImprovementRatio = (baseline.wallClockMs - team.wallClockMs) / baseline.wallClockMs;
  const fullyLoadedCostIncreaseRatio = (team.fullyLoadedUsd - baseline.fullyLoadedUsd) / baseline.fullyLoadedUsd;
  const listPriceCostIncreaseRatio = (team.listPriceEquivalentUsd - baseline.listPriceEquivalentUsd) / baseline.listPriceEquivalentUsd;

  if (!team.qualityGatePassed || !team.governanceGatePassed) {
    reasons.push('quality-or-governance-gate-failed');
  }
  if (!team.canonicalPricingEvidence) {
    reasons.push('missing-canonical-pricing-evidence');
  }
  if (!team.cheapWorkerModels || !team.roleCollapse || !team.promptCaching || !team.mixedModelRouting || !team.stopLossEnabled) {
    reasons.push('efficiency-controls-incomplete');
  }
  if (wallClockImprovementRatio <= 0) {
    reasons.push('no-wall-clock-speedup');
  }
  if (fullyLoadedCostIncreaseRatio > 0.1) {
    reasons.push('fully-loaded-cost-above-10-percent-cap');
  }
  if (listPriceCostIncreaseRatio > 0.1) {
    reasons.push('list-price-equivalent-cost-above-10-percent-cap');
  }

  return {
    promote: reasons.length === 0,
    reasons,
    wallClockImprovementRatio,
    fullyLoadedCostIncreaseRatio,
    listPriceCostIncreaseRatio
  };
}

const decision = evaluatePromotion(singleAgentBaseline, controlledTeamDogfood);
assert.equal(decision.promote, false, 'Team dogfood should not promote to default when cost caps fail');
assert.ok(decision.wallClockImprovementRatio > 0.2, 'fixture should prove the Team lane can be faster');
assert.ok(decision.fullyLoadedCostIncreaseRatio > 0.1, 'fully-loaded cost must govern promotion');
assert.ok(decision.listPriceCostIncreaseRatio > 0.1, 'list-price-equivalent cost must govern promotion');
assert.ok(decision.reasons.includes('fully-loaded-cost-above-10-percent-cap'));
assert.ok(decision.reasons.includes('list-price-equivalent-cost-above-10-percent-cap'));

assert.ok(controlledTeamDogfood.incrementalUsd > 0, 'incremental Team cost must be measured');
assert.ok(controlledTeamDogfood.fullyLoadedUsd >= controlledTeamDogfood.listPriceEquivalentUsd);
assert.ok(controlledTeamDogfood.promptTokens > singleAgentBaseline.promptTokens, 'token counts remain diagnostic, not decisive');
assert.ok(controlledTeamDogfood.cheapWorkerModels);
assert.ok(controlledTeamDogfood.roleCollapse);
assert.ok(controlledTeamDogfood.promptCaching);
assert.ok(controlledTeamDogfood.mixedModelRouting);
assert.ok(controlledTeamDogfood.stopLossEnabled);

const backlogItem = readFileSync('docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-15-190.json', 'utf8');
assert.match(backlogItem, /Team Agents dogfood/);
assert.match(backlogItem, /EMG-TASK-RFT-0026-a24301fd74/);
assert.match(backlogItem, /pricing evidence/);
assert.match(backlogItem, /stop-loss/);
assert.match(backlogItem, /before promoting Team as default/);

console.log(
  `[team-agents-dogfood] ok (promote=${decision.promote}, wallClockImprovement=${decision.wallClockImprovementRatio.toFixed(2)}, fullyLoadedCostIncrease=${decision.fullyLoadedCostIncreaseRatio.toFixed(2)})`
);
