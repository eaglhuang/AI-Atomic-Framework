import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  calculateTeamCostReceipt,
  type ModelPriceCatalog
} from '../../packages/core/src/team-runtime/pricing/cost-accounting.ts';
import type { TeamProviderBillableUsage } from '../../packages/core/src/team-runtime/provider-contract.ts';

const catalog = JSON.parse(readFileSync('specs/pricing/model-standard-token-prices.json', 'utf8')) as ModelPriceCatalog;

testCatalogSchema();
testOpenAICachedTokens();
testProviderReportedChargeWins();
testCheapAndFrontierModels();
testSubscriptionFullyLoadedCost();
testCurrencyConversion();
testMissingRateDimensions();

console.log('[team-cost-accounting] ok');

function testCatalogSchema(): void {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const catalogSchema = JSON.parse(readFileSync('schemas/team-agents/model-price-catalog.schema.json', 'utf8'));
  const receiptSchema = JSON.parse(readFileSync('schemas/team-agents/team-cost-receipt.schema.json', 'utf8'));
  assert.equal(ajv.validate(catalogSchema, catalog), true, ajv.errorsText());
  const receipt = calculateTeamCostReceipt({
    catalog,
    usage: usage({ inputTokens: 1_000, outputTokens: 1_000 })
  });
  assert.equal(ajv.validate(receiptSchema, receipt), true, ajv.errorsText());
}

function testOpenAICachedTokens(): void {
  const receipt = calculateTeamCostReceipt({
    catalog,
    usage: usage({
      inputTokens: 2_000,
      cacheReadTokens: 8_000,
      cacheWriteTokens: 1_000,
      outputTokens: 500,
      modelId: 'gpt-5.6-terra'
    })
  });
  assert.equal(receipt.measurementStatus, 'complete');
  assert.equal(receipt.promotionEligible, true);
  assert.equal(receipt.incrementalCashCost, 0.03525);
  assert.equal(receipt.lineItems.some((item) => item.dimension === 'cacheWrite'), true);
}

function testProviderReportedChargeWins(): void {
  const receipt = calculateTeamCostReceipt({
    catalog,
    usage: usage({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      providerReportedChargedAmount: 0.42
    })
  });
  assert.equal(receipt.incrementalCashCost, 0.42);
  assert.equal(receipt.listPriceEquivalentCost, 10.5);
}

function testCheapAndFrontierModels(): void {
  const cheap = calculateTeamCostReceipt({
    catalog,
    usage: usage({
      providerId: 'gemini-direct',
      modelId: 'gemini-3.5-flash',
      billingProduct: 'gemini-api',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000
    })
  });
  const frontier = calculateTeamCostReceipt({
    catalog,
    usage: usage({
      modelId: 'gpt-5.6-terra',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000
    })
  });
  assert.equal(cheap.incrementalCashCost, 1.75);
  assert.equal(frontier.incrementalCashCost, 35);
}

function testSubscriptionFullyLoadedCost(): void {
  const receipt = calculateTeamCostReceipt({
    catalog,
    usage: usage({
      providerId: 'claude-code',
      modelId: 'copilot-pro',
      billingProduct: 'agent-subscription',
      inputTokens: 0,
      providerReportedCredits: 12
    }),
    seatAllocationPolicy: {
      schemaId: 'atm.seatAllocationPolicy.v1',
      policyVersion: 'seat-policy-2026-07',
      allocatedSeatMonthlyCost: 10,
      expectedMonthlyUsageUnits: 100,
      consumedCredits: 12,
      overageCredits: 0
    }
  });
  assert.equal(receipt.incrementalCashCost, 0);
  assert.equal(receipt.fullyLoadedCashCost, 0.1);
  assert.equal(receipt.seatAllocationPolicyVersion, 'seat-policy-2026-07');
}

function testCurrencyConversion(): void {
  const receipt = calculateTeamCostReceipt({
    catalog,
    usage: usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    targetCurrency: 'TWD',
    fxSnapshot: {
      schemaId: 'atm.fxSnapshot.v1',
      snapshotVersion: 'fx-2026-07-14',
      baseCurrency: 'TWD',
      rates: { USD: 0.03125 },
      retrievedAt: '2026-07-14T00:00:00.000Z'
    }
  });
  assert.equal(receipt.currency, 'TWD');
  assert.equal(receipt.incrementalCashCost, 336);
}

function testMissingRateDimensions(): void {
  const receipt = calculateTeamCostReceipt({
    catalog,
    usage: usage({ modelId: 'unknown-model', inputTokens: 1000 })
  });
  assert.equal(receipt.measurementStatus, 'cost-measurement-incomplete');
  assert.equal(receipt.promotionEligible, false);
  assert.equal(receipt.incompleteReasons.includes('missing-price-row'), true);
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
