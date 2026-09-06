const riskRank = {
    low: 0,
    medium: 1,
    high: 2
};
export function buildTeamProviderPreflight(input) {
    const matchingProviderPlans = input.candidates.filter((candidate) => candidate.providerId === input.requestedProviderId);
    const requestedPlan = matchingProviderPlans.find((candidate) => candidate.planId === input.requestedPlanId
        && (!input.requestedModelId || candidate.modelId === input.requestedModelId)) ?? null;
    const cheapestEligible = selectCheapestEligibleProviderPlan({
        candidates: matchingProviderPlans,
        requiredCapabilities: input.requiredCapabilities,
        risk: input.risk,
        dataPolicy: input.dataPolicy
    });
    const selected = requestedPlan ?? cheapestEligible;
    const failureClasses = uniqueFailureClasses([
        input.checks.authOk ? null : 'auth',
        input.checks.schemaOk ? null : 'schema',
        input.checks.quotaOk ? null : 'quota',
        input.checks.billingOk ? null : 'billing',
        selected ? null : 'model',
        selected && selected.catalogFresh ? null : 'stale-price',
        selected && selected.currency === 'USD' ? null : 'currency',
        selected && selected.planId === input.requestedPlanId ? null : 'plan',
        selected && planSatisfiesRequirements(selected, input.requiredCapabilities, input.risk, input.dataPolicy) ? null : 'model'
    ]);
    return {
        schemaId: 'atm.teamProviderPreflight.v1',
        ok: failureClasses.length === 0,
        providerId: input.requestedProviderId,
        modelId: selected?.modelId ?? input.requestedModelId ?? null,
        planId: input.requestedPlanId,
        catalogVersion: selected?.catalogVersion ?? null,
        projectedSpendCeilingUsd: selected?.projectedSpendCeilingUsd ?? null,
        selected,
        failureClasses,
        cheapestEligibleModelId: cheapestEligible?.modelId ?? null
    };
}
/**
 * Run at most one explicitly-authorized, provider-neutral paid probe per provider.
 * This function never creates authorization and never retries a provider.
 */
export async function runTeamPaidProviderPreflight(input) {
    const requestCountByProvider = {};
    const failures = [];
    if (!input.enabled) {
        return { schemaId: 'atm.teamPaidProviderPreflight.v1', ok: true, stoppedRoster: false, requiresExplicitContinuation: false, requestCountByProvider, totalRequestCount: 0, failures };
    }
    if (!input.authorized) {
        return { schemaId: 'atm.teamPaidProviderPreflight.v1', ok: false, stoppedRoster: true, requiresExplicitContinuation: true, requestCountByProvider, totalRequestCount: 0, failures };
    }
    const providers = [...new Set(input.providerIds.filter((providerId) => providerId.length > 0))];
    for (const providerId of providers) {
        requestCountByProvider[providerId] = 1;
        const result = await input.probe(providerId);
        if (!result.ok) {
            failures.push({ providerId, failureClass: result.failureClass });
            if (result.failureClass === 'quota' || result.failureClass === 'billing') {
                return {
                    schemaId: 'atm.teamPaidProviderPreflight.v1',
                    ok: false,
                    stoppedRoster: true,
                    requiresExplicitContinuation: !input.continuationAuthorized,
                    requestCountByProvider,
                    totalRequestCount: Object.values(requestCountByProvider).reduce((sum, count) => sum + count, 0),
                    failures
                };
            }
        }
    }
    return {
        schemaId: 'atm.teamPaidProviderPreflight.v1',
        ok: failures.length === 0,
        stoppedRoster: false,
        requiresExplicitContinuation: false,
        requestCountByProvider,
        totalRequestCount: Object.values(requestCountByProvider).reduce((sum, count) => sum + count, 0),
        failures
    };
}
export function selectCheapestEligibleProviderPlan(input) {
    const eligible = input.candidates
        .filter((candidate) => planSatisfiesRequirements(candidate, input.requiredCapabilities, input.risk, input.dataPolicy))
        .filter((candidate) => candidate.catalogFresh && candidate.currency === 'USD')
        .sort((left, right) => left.estimatedSpendUsd - right.estimatedSpendUsd
        || left.projectedSpendCeilingUsd - right.projectedSpendCeilingUsd
        || left.modelId.localeCompare(right.modelId));
    return eligible[0] ?? null;
}
function planSatisfiesRequirements(plan, requiredCapabilities, risk, dataPolicy) {
    return requiredCapabilities.every((capability) => plan.capabilities.includes(capability))
        && riskRank[plan.maxRisk] >= riskRank[risk]
        && plan.dataPolicies.includes(dataPolicy);
}
function uniqueFailureClasses(values) {
    return [...new Set(values.filter((value) => value !== null))];
}
