import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type DogfoodRun = {
  label: string;
  sampleKind: 'fixture-simulation' | 'live-paired-run';
  measurementStatus: 'measurement-incomplete' | 'complete';
  providerBillableUsage: boolean;
  pairedRunId: string | null;
  pricingEvidenceKind: 'fixture' | 'provider-bill';
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

type RealPairedSampleArtifact = {
  schemaId: 'atm.teamDogfoodPairedSample.v1';
  sampleId: string;
  sampleKind: 'live-paired-run' | 'live-paired-run-blocked';
  measurementStatus: 'measurement-incomplete' | 'complete';
  promotionEligible: boolean;
  providerBillableUsage: boolean;
  pairedRunId: string | null;
  pricingEvidenceKind: 'provider-bill' | 'catalog-estimate' | 'missing';
  pricingCatalogVersion: string | null;
  modelIdentities: readonly string[];
  wallClock: {
    baselineMs: number | null;
    teamMs: number | null;
  };
  qualityOutcome: {
    baselinePassed: boolean | null;
    teamPassed: boolean | null;
  };
  missingEvidence: readonly string[];
  usage?: {
    baseline?: {
      inputTokens?: number;
      outputTokens?: number;
      requestCount?: number;
    };
    team?: {
      inputTokens?: number;
      outputTokens?: number;
      requestCount?: number;
    };
  };
};

const singleAgentBaseline: DogfoodRun = {
  label: 'single-agent-baseline',
  sampleKind: 'fixture-simulation',
  measurementStatus: 'measurement-incomplete',
  providerBillableUsage: false,
  pairedRunId: null,
  pricingEvidenceKind: 'fixture',
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
  sampleKind: 'fixture-simulation',
  measurementStatus: 'measurement-incomplete',
  providerBillableUsage: false,
  pairedRunId: null,
  pricingEvidenceKind: 'fixture',
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
  if (
    baseline.sampleKind !== 'live-paired-run' ||
    team.sampleKind !== 'live-paired-run' ||
    baseline.measurementStatus !== 'complete' ||
    team.measurementStatus !== 'complete' ||
    !baseline.providerBillableUsage ||
    !team.providerBillableUsage ||
    baseline.pricingEvidenceKind !== 'provider-bill' ||
    team.pricingEvidenceKind !== 'provider-bill' ||
    !baseline.pairedRunId ||
    baseline.pairedRunId !== team.pairedRunId
  ) {
    reasons.push('measurement-incomplete');
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
assert.equal(decision.promote, false, 'simulation-only Team dogfood must not promote to default');
assert.ok(decision.wallClockImprovementRatio > 0.2, 'fixture may demonstrate a hypothetical speedup only');
assert.ok(decision.fullyLoadedCostIncreaseRatio > 0.1, 'fully-loaded cost must govern promotion');
assert.ok(decision.listPriceCostIncreaseRatio > 0.1, 'list-price-equivalent cost must govern promotion');
assert.ok(decision.reasons.includes('measurement-incomplete'));
assert.ok(decision.reasons.includes('fully-loaded-cost-above-10-percent-cap'));
assert.ok(decision.reasons.includes('list-price-equivalent-cost-above-10-percent-cap'));

assert.equal(controlledTeamDogfood.sampleKind, 'fixture-simulation');
assert.equal(controlledTeamDogfood.measurementStatus, 'measurement-incomplete');
assert.equal(controlledTeamDogfood.providerBillableUsage, false);
assert.equal(controlledTeamDogfood.pricingEvidenceKind, 'fixture');
assert.ok(controlledTeamDogfood.incrementalUsd > 0, 'fixture cost remains diagnostic, not promotional evidence');
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

const simulatedCheapTeam: DogfoodRun = {
  ...controlledTeamDogfood,
  label: 'simulated-cheap-team',
  fullyLoadedUsd: 0.52,
  listPriceEquivalentUsd: 0.48
};
const simulatedCheapDecision = evaluatePromotion(singleAgentBaseline, simulatedCheapTeam);
assert.equal(simulatedCheapDecision.promote, false, 'simulation-only samples must stay blocked even when cost caps pass');
assert.ok(simulatedCheapDecision.reasons.includes('measurement-incomplete'));

const completeLiveBaseline: DogfoodRun = {
  ...singleAgentBaseline,
  label: 'live-single-agent-baseline',
  sampleKind: 'live-paired-run',
  measurementStatus: 'complete',
  providerBillableUsage: true,
  pairedRunId: 'paired-run-contract-2026-07-16',
  pricingEvidenceKind: 'provider-bill',
  wallClockMs: 120_000
};
const completeLiveTeam: DogfoodRun = {
  ...controlledTeamDogfood,
  label: 'live-team-run',
  sampleKind: 'live-paired-run',
  measurementStatus: 'complete',
  providerBillableUsage: true,
  pairedRunId: 'paired-run-contract-2026-07-16',
  pricingEvidenceKind: 'provider-bill',
  wallClockMs: 84_000,
  fullyLoadedUsd: 0.52,
  listPriceEquivalentUsd: 0.49
};
const completeLiveDecision = evaluatePromotion(completeLiveBaseline, completeLiveTeam);
assert.equal(completeLiveDecision.promote, true, 'complete provider-billed paired samples may promote when speed and cost gates pass');
assert.deepEqual(completeLiveDecision.reasons, []);
assert.ok(completeLiveDecision.wallClockImprovementRatio >= 0.3);
assert.ok(completeLiveDecision.fullyLoadedCostIncreaseRatio <= 0.1);
assert.ok(completeLiveDecision.listPriceCostIncreaseRatio <= 0.1);

const realPairedSample = JSON.parse(
  readFileSync('artifacts/generated/team-dogfood/real-paired-sample.json', 'utf8')
) as RealPairedSampleArtifact;
assert.equal(realPairedSample.schemaId, 'atm.teamDogfoodPairedSample.v1');
assert.equal(realPairedSample.sampleKind, 'live-paired-run');
assert.equal(realPairedSample.measurementStatus, 'complete');
assert.equal(realPairedSample.promotionEligible, false, 'measurement completion alone must not auto-promote Team as default');
assert.equal(realPairedSample.providerBillableUsage, true);
assert.ok(realPairedSample.pairedRunId);
assert.equal(realPairedSample.pricingEvidenceKind, 'provider-bill');
assert.ok(realPairedSample.pricingCatalogVersion);
assert.ok((realPairedSample.wallClock.baselineMs ?? 0) > 0);
assert.ok((realPairedSample.wallClock.teamMs ?? 0) > 0);
assert.equal(realPairedSample.qualityOutcome.baselinePassed, true);
assert.equal(realPairedSample.qualityOutcome.teamPassed, true);
assert.deepEqual(realPairedSample.missingEvidence, []);
assert.ok((realPairedSample.usage?.baseline?.requestCount ?? 0) > 0);
assert.ok((realPairedSample.usage?.baseline?.inputTokens ?? 0) > 0);
assert.ok((realPairedSample.usage?.baseline?.outputTokens ?? 0) > 0);
assert.ok((realPairedSample.usage?.team?.requestCount ?? 0) > 0);
assert.ok((realPairedSample.usage?.team?.inputTokens ?? 0) > 0);
assert.ok((realPairedSample.usage?.team?.outputTokens ?? 0) > 0);

const liveBlocker = readFileSync('docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-16-004.json', 'utf8');
assert.match(liveBlocker, /ATM-GOV-0153/);
assert.match(liveBlocker, /provider billable usage/);
assert.match(liveBlocker, /promotionEligible/);

console.log(
  `[team-agents-dogfood] ok (promote=${decision.promote}, completeLivePromote=${completeLiveDecision.promote}, wallClockImprovement=${decision.wallClockImprovementRatio.toFixed(2)}, fullyLoadedCostIncrease=${decision.fullyLoadedCostIncreaseRatio.toFixed(2)})`
);
