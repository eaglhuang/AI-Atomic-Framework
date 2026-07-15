export function calculateTeamCostReceipt(input) {
    assertCatalog(input.catalog);
    const row = findPriceRow(input.catalog, input.usage);
    const missing = [...(input.usage.measurementIncompleteReasons ?? [])];
    if (!row)
        missing.push('missing-price-row');
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
    const status = missing.length ? 'cost-measurement-incomplete' : 'complete';
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
function assertCatalog(catalog) {
    if (!catalog.immutable)
        throw new Error('Model price catalog versions must be immutable.');
    if (!catalog.catalogVersion)
        throw new Error('Model price catalog requires catalogVersion.');
}
function findPriceRow(catalog, usage) {
    return catalog.prices.find((row) => row.provider === usage.providerId &&
        row.model === usage.modelId &&
        row.billingProduct === usage.billingProduct &&
        row.region === (usage.region ?? row.region) &&
        row.serviceTier === (usage.serviceTier ?? row.serviceTier)) ?? null;
}
function priceUsage(usage, row) {
    return [
        tokenItem('input', usage.inputTokens, row),
        tokenItem('output', usage.outputTokens, row),
        tokenItem('cacheRead', usage.cacheReadTokens, row),
        tokenItem('cacheWrite', usage.cacheWriteTokens, row),
        tokenItem('reasoning', usage.reasoningTokens, row),
        unitItem('toolCall', usage.toolCallCount, row, 1000),
        unitItem('request', usage.requestCount, row, 1),
        unitItem('session', usage.sessionCount, row, 1)
    ].filter((item) => Boolean(item));
}
function tokenItem(dimension, quantity, row) {
    return unitItem(dimension, quantity, row, 1_000_000);
}
function unitItem(dimension, quantity, row, denominator) {
    const rate = row.rates[dimension];
    if (!quantity || rate == null)
        return null;
    return { dimension, quantity, rate, cost: (quantity / denominator) * rate, currency: row.currency };
}
function addSubscriptionLine(items, cost, currency) {
    if (!cost)
        return items;
    return [...items, { dimension: 'subscription-allocation', quantity: 1, rate: cost, cost, currency }];
}
function convert(amount, from, to, fx) {
    if (from === to)
        return roundMoney(amount);
    const rate = fx?.rates[from];
    return roundMoney(rate ? amount / rate : amount);
}
function sum(values) {
    return values.reduce((total, value) => total + value, 0);
}
function roundMoney(value) {
    return Number(value.toFixed(8));
}
