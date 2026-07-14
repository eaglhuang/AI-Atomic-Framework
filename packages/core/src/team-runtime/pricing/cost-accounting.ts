import type { TeamProviderBillableUsage, TeamProviderId } from '../provider-contract.ts';

export type CostMeasurementStatus = 'complete' | 'cost-measurement-incomplete';

export type ModelPriceCatalog = {
  readonly schemaId: 'atm.modelPriceCatalog.v1';
  readonly specVersion: string;
  readonly catalogVersion: string;
  readonly currency: string;
  readonly immutable: true;
  readonly retrievedAt: string;
  readonly prices: readonly ModelPriceRow[];
};

export type ModelPriceRow = {
  readonly provider: TeamProviderId;
  readonly model: string;
  readonly billingProduct: string;
  readonly plan: string;
  readonly region: string;
  readonly serviceTier: string;
  readonly currency: string;
  readonly priceUnit: 'per-1m-tokens' | 'per-request' | 'per-session' | 'per-1k-tool-calls' | 'per-seat-month' | 'credit';
  readonly effectiveAt: string;
  readonly retrievedAt: string;
  readonly officialSourceUrl: string;
  readonly sourceHash: string;
  readonly rates: Partial<Record<RateDimension, number>>;
  readonly notes?: string;
};

export type RateDimension =
  | 'input'
  | 'output'
  | 'cacheRead'
  | 'cacheWrite'
  | 'reasoning'
  | 'toolCall'
  | 'request'
  | 'session'
  | 'seatMonth'
  | 'creditOverage';

export type FxSnapshot = {
  readonly schemaId: 'atm.fxSnapshot.v1';
  readonly snapshotVersion: string;
  readonly baseCurrency: string;
  readonly rates: Record<string, number>;
  readonly retrievedAt: string;
};

export type SeatAllocationPolicy = {
  readonly schemaId: 'atm.seatAllocationPolicy.v1';
  readonly policyVersion: string;
  readonly allocatedSeatMonthlyCost: number;
  readonly expectedMonthlyUsageUnits: number;
  readonly consumedCredits?: number;
  readonly overageCredits?: number;
};

export type TeamCostReceipt = {
  readonly schemaId: 'atm.teamCostReceipt.v1';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none';
    readonly fromVersion: null;
    readonly notes: string;
  };
  readonly catalogVersion: string;
  readonly measurementStatus: CostMeasurementStatus;
  readonly promotionEligible: boolean;
  readonly provider: TeamProviderId;
  readonly model: string;
  readonly currency: string;
  readonly originalCurrency: string;
  readonly incrementalCashCost: number;
  readonly fullyLoadedCashCost: number;
  readonly listPriceEquivalentCost: number;
  readonly lineItems: readonly TeamCostLineItem[];
  readonly incompleteReasons: readonly string[];
  readonly fxSnapshotVersion?: string | null;
  readonly seatAllocationPolicyVersion?: string | null;
};

export type TeamCostLineItem = {
  readonly dimension: RateDimension | 'provider-reported-charge' | 'subscription-allocation';
  readonly quantity: number;
  readonly rate: number;
  readonly cost: number;
  readonly currency: string;
};

export function calculateTeamCostReceipt(input: {
  readonly catalog: ModelPriceCatalog;
  readonly usage: TeamProviderBillableUsage;
  readonly targetCurrency?: string;
  readonly fxSnapshot?: FxSnapshot;
  readonly seatAllocationPolicy?: SeatAllocationPolicy;
}): TeamCostReceipt {
  assertCatalog(input.catalog);
  const row = findPriceRow(input.catalog, input.usage);
  const missing = [...(input.usage.measurementIncompleteReasons ?? [])];
  if (!row) missing.push('missing-price-row');
  const sourceCurrency = input.usage.currency || row?.currency || input.catalog.currency;
  const targetCurrency = input.targetCurrency ?? sourceCurrency;
  const lineItems = row ? priceUsage(input.usage, row) : [];
  if (input.usage.providerReportedChargedAmount == null && lineItems.length === 0) {
    missing.push('missing-rate-dimensions');
  }
  if (targetCurrency !== sourceCurrency && !input.fxSnapshot?.rates[sourceCurrency]) {
    missing.push('missing-fx-snapshot-rate');
  }
  const listCost = sum(lineItems.map((item) => item.cost));
  const incremental = input.usage.providerReportedChargedAmount ?? listCost;
  const seatAllocation = input.seatAllocationPolicy
    ? input.seatAllocationPolicy.allocatedSeatMonthlyCost / Math.max(1, input.seatAllocationPolicy.expectedMonthlyUsageUnits)
    : 0;
  const fullyLoaded = incremental + seatAllocation;
  const status: CostMeasurementStatus = missing.length ? 'cost-measurement-incomplete' : 'complete';
  return {
    schemaId: 'atm.teamCostReceipt.v1',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'State-free cost calculation from normalized billable usage.'
    },
    catalogVersion: input.catalog.catalogVersion,
    measurementStatus: status,
    promotionEligible: status === 'complete',
    provider: input.usage.providerId,
    model: input.usage.modelId,
    currency: targetCurrency,
    originalCurrency: sourceCurrency,
    incrementalCashCost: convert(incremental, sourceCurrency, targetCurrency, input.fxSnapshot),
    fullyLoadedCashCost: convert(fullyLoaded, sourceCurrency, targetCurrency, input.fxSnapshot),
    listPriceEquivalentCost: convert(listCost, sourceCurrency, targetCurrency, input.fxSnapshot),
    lineItems: addSubscriptionLine(lineItems, seatAllocation, sourceCurrency),
    incompleteReasons: [...new Set(missing)],
    fxSnapshotVersion: input.fxSnapshot?.snapshotVersion ?? null,
    seatAllocationPolicyVersion: input.seatAllocationPolicy?.policyVersion ?? null
  };
}

function assertCatalog(catalog: ModelPriceCatalog): void {
  if (!catalog.immutable) throw new Error('Model price catalog versions must be immutable.');
  if (!catalog.catalogVersion) throw new Error('Model price catalog requires catalogVersion.');
}

function findPriceRow(catalog: ModelPriceCatalog, usage: TeamProviderBillableUsage): ModelPriceRow | null {
  return catalog.prices.find((row) =>
    row.provider === usage.providerId &&
    row.model === usage.modelId &&
    row.billingProduct === usage.billingProduct &&
    row.region === (usage.region ?? row.region) &&
    row.serviceTier === (usage.serviceTier ?? row.serviceTier)
  ) ?? null;
}

function priceUsage(usage: TeamProviderBillableUsage, row: ModelPriceRow): TeamCostLineItem[] {
  return [
    tokenItem('input', usage.inputTokens, row),
    tokenItem('output', usage.outputTokens, row),
    tokenItem('cacheRead', usage.cacheReadTokens, row),
    tokenItem('cacheWrite', usage.cacheWriteTokens, row),
    tokenItem('reasoning', usage.reasoningTokens, row),
    unitItem('toolCall', usage.toolCallCount, row, 1000),
    unitItem('request', usage.requestCount, row, 1),
    unitItem('session', usage.sessionCount, row, 1)
  ].filter((item): item is TeamCostLineItem => Boolean(item));
}

function tokenItem(dimension: RateDimension, quantity: number | undefined, row: ModelPriceRow): TeamCostLineItem | null {
  return unitItem(dimension, quantity, row, 1_000_000);
}

function unitItem(dimension: RateDimension, quantity: number | undefined, row: ModelPriceRow, denominator: number): TeamCostLineItem | null {
  const rate = row.rates[dimension];
  if (!quantity || rate == null) return null;
  return { dimension, quantity, rate, cost: (quantity / denominator) * rate, currency: row.currency };
}

function addSubscriptionLine(items: TeamCostLineItem[], cost: number, currency: string): TeamCostLineItem[] {
  if (!cost) return items;
  return [...items, { dimension: 'subscription-allocation', quantity: 1, rate: cost, cost, currency }];
}

function convert(amount: number, from: string, to: string, fx?: FxSnapshot): number {
  if (from === to) return roundMoney(amount);
  const rate = fx?.rates[from];
  return roundMoney(rate ? amount / rate : amount);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function roundMoney(value: number): number {
  return Number(value.toFixed(8));
}
