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
  // Derive the expected charge from the catalog so a price revision cannot
  // leave a hard-coded number behind. The previous literal was twice the rate
  // card, and the test never ran in CI to catch it.
  const terraRates = catalog.prices.find((entry) => entry.model === 'gpt-5.6-terra')!.rates;
  const expectedCashCost = (2_000 * terraRates.input + 8_000 * terraRates.cacheRead + 1_000 * terraRates.cacheWrite + 500 * terraRates.output) / 1_000_000;
  assert.equal(receipt.incrementalCashCost, expectedCashCost);
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
  assert.equal(receipt.listPriceEquivalentCost, millionTokenListPrice('gpt-5.4-mini'));
}

function testCheapAndFrontierModels(): void {
  const cheap = calculateTeamCostReceipt({
    catalog,
    usage: usage({
      providerId: 'gemini-direct',
      modelId: 'gemini-3.1-flash-lite',
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
  assert.equal(cheap.incrementalCashCost, millionTokenListPrice('gemini-3.1-flash-lite'));
  assert.equal(cheap.measurementStatus, 'complete');

  // A model the catalog does not price must report an incomplete measurement
  // rather than a zero charge that looks like a free run.
  const unpriced = calculateTeamCostReceipt({
    catalog,
    usage: usage({ providerId: 'gemini-direct', modelId: 'model-not-in-catalog', billingProduct: 'gemini-api', inputTokens: 1_000_000, outputTokens: 1_000_000 })
  });
  assert.equal(unpriced.incrementalCashCost, 0);
  assert.equal(unpriced.measurementStatus, 'cost-measurement-incomplete');
  assert.equal(unpriced.promotionEligible, false);
  assert.equal(frontier.incrementalCashCost, millionTokenListPrice('gpt-5.6-terra'));
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
  assert.equal(receipt.incrementalCashCost, millionTokenListPrice('gpt-5.4-mini') / 0.03125);
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

/** List price for one million input plus one million output tokens. */
function millionTokenListPrice(model: string): number {
  const rates = catalog.prices.find((entry) => entry.model === model)!.rates;
  return (1_000_000 * rates.input + 1_000_000 * rates.output) / 1_000_000;
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
