import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createTeamEfficiencyIncident,
  evaluatePairedDogfoodSample,
  evaluateTeamEfficiency
} from '../../packages/cli/src/commands/team/efficiency-controller.ts';

const base = {
  workloadClass: 'governance-code-change',
  rosterFingerprintDigest: `sha256:${'1'.repeat(64)}`,
  modelMixDigest: `sha256:${'2'.repeat(64)}`,
  contextManifestDigest: `sha256:${'3'.repeat(64)}`,
  promptCachePolicy: 'stable-prefix-preferred',
  fanOutCap: 3,
  quotaProbeDigest: `sha256:${'4'.repeat(64)}`,
  pricingCatalogVersion: '2026-07-14.standard',
  priceEvidenceFresh: true,
  usageEvidenceComplete: true,
  qualityParity: true,
  noWorseRepairResidue: true,
  stopLossTriggered: false,
  ratios: {
    fullyLoadedCostRatio: 0.74,
    wallClockRatio: 0.64,
    tokenRatio: 1.8,
    repairResidueRatio: 1
  },
  telemetry: {
    contextInflation: true,
    cacheMiss: false,
    retries: 1,
    quotaOk: true,
    queueWaitInflationRatio: 1.0,
    spendingCeilingRisk: false
  }
};

const preferred = evaluateTeamEfficiency(base);
assert.equal(preferred.routing, 'prefer-team');
assert.equal(preferred.promotionEligible, true);
assert.equal(preferred.preferredRouting, true);
assert.equal(preferred.breakthroughTarget, false);
assert.deepEqual(preferred.tokenDiagnosticReasonCodes, ['context-inflation', 'retries']);
assert.match(preferred.cohortKey, /^cohort-[a-f0-9]{16}$/);

const breakthrough = evaluateTeamEfficiency({
  ...base,
  ratios: { ...base.ratios, fullyLoadedCostRatio: 0.49, wallClockRatio: 0.49 }
});
assert.equal(breakthrough.breakthroughTarget, true);

const bounded = evaluateTeamEfficiency({
  ...base,
  priceEvidenceFresh: false
});
assert.equal(bounded.routing, 'bounded-experiment');
assert.equal(bounded.promotionEligible, false);
assert.equal(bounded.boundedExperiment, true);

const stopLoss = evaluateTeamEfficiency({
  ...base,
  stopLossTriggered: true
});
assert.equal(stopLoss.routing, 'scale-down');
assert.equal(stopLoss.scaleDownAction, 'disable-team-for-workload');
assert.equal(stopLoss.optimizationBacklogTarget?.includes('stop-loss-triggered'), true);

const quota = evaluateTeamEfficiency({
  ...base,
  telemetry: { ...base.telemetry, quotaOk: false }
});
assert.equal(quota.scaleDownAction, 'shrink-team-size');

const expensive = evaluateTeamEfficiency({
  ...base,
  ratios: { ...base.ratios, fullyLoadedCostRatio: 0.92 }
});
assert.equal(expensive.scaleDownAction, 'cheaper-qualified-model');
assert.equal(expensive.promotionEligible, false);

const incident = createTeamEfficiencyIncident({
  sampleId: 'sample-1',
  decision: stopLoss,
  ratios: base.ratios,
  generatedAt: '2026-07-14T00:00:00.000Z'
});
assert.equal(incident.severity, 'blocking');
assert.equal(incident.routing, 'scale-down');
assert.equal(incident.ratios.tokenRatio, 1.8);
assert.equal(incident.tokenDiagnosticReasonCodes.includes('context-inflation'), true);

const livePairedSample = JSON.parse(readFileSync('artifacts/generated/team-dogfood/real-paired-sample.json', 'utf8'));
const liveEvaluation = evaluatePairedDogfoodSample({
  sample: livePairedSample,
  generatedAt: '2026-07-16T00:00:00.000Z'
});
assert.equal(liveEvaluation.decision.promotionEligible, false);
assert.equal(liveEvaluation.decision.routing, 'scale-down');
assert.equal(liveEvaluation.decision.scaleDownAction, 'cheaper-qualified-model');
assert.equal(liveEvaluation.incident.schemaId, 'atm.teamEfficiencyIncident.v1');
assert.equal(liveEvaluation.incident.severity, 'blocking');
assert.equal(liveEvaluation.incident.sampleId, livePairedSample.sampleId);
assert.ok(liveEvaluation.incident.reason.includes('fully-loaded-cost-threshold-miss'));
assert.ok(liveEvaluation.incident.reason.includes('wall-clock-threshold-miss'));
assert.ok((liveEvaluation.incident.ratios.tokenRatio ?? 0) > 1);

console.log('[team-efficiency-controller] ok');
