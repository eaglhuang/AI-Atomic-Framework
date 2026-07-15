import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ModelPriceCatalog } from '../../packages/core/src/team-runtime/pricing/cost-accounting.ts';
import type { TeamProviderBillableUsage } from '../../packages/core/src/team-runtime/provider-contract.ts';
import {
  runGovernanceCostBench,
  type GovernanceCostSampleInput,
  type TeamRosterFingerprint
} from '../../scripts/lib/governance-cost-bench/paired-runner.ts';

const catalog = JSON.parse(readFileSync('specs/pricing/model-standard-token-prices.json', 'utf8')) as ModelPriceCatalog;

testPairedCostAndTimeReport();
testIncompleteUsageIsPromotionIneligible();
testIncidentSchema();

console.log('[governance-cost-bench] ok');

function testPairedCostAndTimeReport(): void {
  const report = runGovernanceCostBench({
    catalog,
    generatedAt: '2026-07-14T00:00:00.000Z',
    samples: [sample('sample-a', roster('alpha')), sample('sample-b', roster('beta'))]
  });
  assert.equal(report.shadowOnly, true);
  assert.equal(report.measurementStatus, 'complete');
  assert.equal(report.promotionEligible, true);
  assert.deepEqual(report.ineligibleReasons, []);
  assert.equal(report.samples.length, 2);
  assert.equal(report.cohorts.length, 2);
  assert.equal(report.cohorts[0].measurementStatus, 'complete');
  assert.equal(report.cohorts[0].promotionEligible, true);
  assert.equal(report.workloadRollups[0].cohorts.length, 2);
  assert.equal(report.workloadRollups[0].measurementStatus, 'complete');
  assert.equal(report.workloadRollups[0].promotionEligible, true);
  const first = report.samples[0];
  assert.equal(first.baseCost.measurementStatus, 'complete');
  assert.equal(first.outcomeCost.measurementStatus, 'complete');
  assert.equal(first.outcomeCost.fullyLoadedCashCost, Number((first.outcomeCost.incrementalCashCost + 0.05).toFixed(8)));
  assert.equal(
    first.ratios.incrementalCashCostRatio,
    Number((first.outcomeCost.incrementalCashCost / first.baseCost.incrementalCashCost).toFixed(6))
  );
  assert.equal(first.metrics.singleTaskLatencyMs.base, 1000);
  assert.equal(first.metrics.batchMakespanMs.outcome, 1300);
  assert.equal(first.metrics.throughputPerMinute.outcome, 4);
  assert.equal(first.ratios.throughputRatio, 0.75);
  assert.equal(first.queue.outcome, 25);
  assert.equal(first.retries.outcome, 1);
  assert.equal(first.repairs.outcome, 1);
  assert.equal(first.discardedWork.outcome, 2);
  assert.equal(first.tokenDiagnostics.outcomeCacheReadTokens, 5000);
  assert.equal(first.promotionEligible, true);
}

function testIncompleteUsageIsPromotionIneligible(): void {
  const report = runGovernanceCostBench({
    catalog,
    samples: [{
      ...sample('sample-incomplete', roster('alpha')),
      outcome: {
        ...sample('sample-incomplete', roster('alpha')).outcome,
        usage: usage({ modelId: 'unknown-model', inputTokens: 1000 })
      }
    }]
  });
  assert.equal(report.samples[0].promotionEligible, false);
  assert.equal(report.samples[0].ineligibleReasons.includes('outcome:missing-price-row'), true);
  assert.equal(report.measurementStatus, 'cost-measurement-incomplete');
  assert.equal(report.promotionEligible, false);
  assert.equal(report.ineligibleReasons.includes('sample-incomplete:outcome:missing-price-row'), true);
  assert.equal(report.ineligibleReasons.includes('sample-incomplete:outcome:missing-rate-dimensions'), true);
  assert.equal(report.cohorts[0].measurementStatus, 'cost-measurement-incomplete');
  assert.equal(report.cohorts[0].promotionEligible, false);
  assert.equal(report.cohorts[0].ineligibleReasons.includes('sample-incomplete:outcome:missing-price-row'), true);
  assert.equal(report.cohorts[0].ineligibleReasons.includes('sample-incomplete:outcome:missing-rate-dimensions'), true);
  assert.equal(report.workloadRollups[0].measurementStatus, 'cost-measurement-incomplete');
  assert.equal(report.workloadRollups[0].promotionEligible, false);
  assert.equal(report.workloadRollups[0].ineligibleReasons.includes('sample-incomplete:outcome:missing-price-row'), true);
  assert.equal(report.workloadRollups[0].ineligibleReasons.includes('sample-incomplete:outcome:missing-rate-dimensions'), true);
}

function testIncidentSchema(): void {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync('schemas/team-agents/team-efficiency-incident.schema.json', 'utf8'));
  const incident = {
    schemaId: 'atm.teamEfficiencyIncident.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'fixture' },
    incidentId: 'incident-0126',
    generatedAt: '2026-07-14T00:00:00.000Z',
    severity: 'advisory',
    reason: 'team run did not beat cost/time baseline',
    sampleId: 'sample-a',
    cohortKey: 'roster:fixture',
    ratios: {
      incrementalCashCostRatio: 1.2,
      fullyLoadedCashCostRatio: 1.1,
      listPriceEquivalentCostRatio: 1.2,
      singleTaskLatencyRatio: 1.4,
      batchMakespanRatio: 1.3,
      throughputRatio: 1.1
    }
  };
  assert.equal(ajv.validate(schema, incident), true, ajv.errorsText());
}

function sample(sampleId: string, rosterFingerprint: TeamRosterFingerprint): GovernanceCostSampleInput {
  return {
    sampleId,
    workloadClass: 'single-validator',
    rosterFingerprint,
    base: {
      label: 'single-agent',
      usage: usage({ inputTokens: 1000, outputTokens: 1000 }),
      durationMs: 1000,
      batchMakespanMs: 1000,
      throughputPerMinute: 3,
      queueMs: 0,
      retries: 0,
      repairs: 0,
      discardedWorkCount: 0,
      validatorCount: 1
    },
    outcome: {
      label: 'team',
      usage: usage({ inputTokens: 1200, cacheReadTokens: 5000, outputTokens: 400 }),
      durationMs: 700,
      batchMakespanMs: 1300,
      throughputPerMinute: 4,
      queueMs: 25,
      retries: 1,
      repairs: 1,
      discardedWorkCount: 2,
      validatorCount: 1,
      allocationPolicy: {
        schemaId: 'atm.seatAllocationPolicy.v1',
        policyVersion: 'seat-policy-test',
        allocatedSeatMonthlyCost: 5,
        expectedMonthlyUsageUnits: 100
      }
    }
  };
}

function roster(id: string): TeamRosterFingerprint {
  return {
    schemaId: 'atm.teamRosterFingerprint.v1',
    roleGraph: [`captain>${id}>reviewer`],
    executorCollapseDecision: id === 'alpha' ? 'team-expanded' : 'team-collapsed',
    providerModelPlan: ['openai:gpt-5.4-mini:standard'],
    pricingCatalogVersion: catalog.catalogVersion,
    contextManifestHash: `sha256:${id.padEnd(64, '0').slice(0, 64)}`,
    promptCachePolicy: 'cache-read-enabled',
    fanOutCap: 2,
    quotaProbeDigest: `sha256:${id.padEnd(64, '1').slice(0, 64)}`
  };
}

function usage(overrides: Partial<TeamProviderBillableUsage>): TeamProviderBillableUsage {
  return {
    schemaId: 'atm.teamProviderBillableUsage.v1',
    providerId: 'openai',
    modelId: 'gpt-5.4-mini',
    billingProduct: 'responses-api',
    serviceTier: 'standard',
    region: 'global',
    currency: 'USD',
    requestCount: 1,
    retryCount: 0,
    billedFailedOrCancelled: false,
    ...overrides
  };
}
