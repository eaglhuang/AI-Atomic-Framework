export type TeamProviderFailureClass =
  | 'auth'
  | 'model'
  | 'schema'
  | 'quota'
  | 'billing'
  | 'stale-price'
  | 'currency'
  | 'plan';

export type TeamPaidProviderProbeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failureClass: Extract<TeamProviderFailureClass, 'auth' | 'model' | 'schema' | 'quota' | 'billing'> };

export type TeamPaidProviderPreflightInput = {
  readonly enabled: boolean;
  readonly authorized: boolean;
  readonly continuationAuthorized?: boolean;
  readonly providerIds: readonly string[];
  readonly probe: (providerId: string) => Promise<TeamPaidProviderProbeResult>;
};

export type TeamPaidProviderPreflightReport = {
  readonly schemaId: 'atm.teamPaidProviderPreflight.v1';
  readonly ok: boolean;
  readonly stoppedRoster: boolean;
  readonly requiresExplicitContinuation: boolean;
  readonly requestCountByProvider: Readonly<Record<string, number>>;
  readonly totalRequestCount: number;
  readonly failures: readonly { readonly providerId: string; readonly failureClass: TeamProviderFailureClass }[];
};

export type TeamProviderPlan = {
  readonly providerId: string;
  readonly modelId: string;
  readonly planId: string;
  readonly catalogVersion: string;
  readonly projectedSpendCeilingUsd: number;
  readonly estimatedSpendUsd: number;
  readonly currency: string;
  readonly catalogFresh: boolean;
  readonly capabilities: readonly string[];
  readonly maxRisk: 'low' | 'medium' | 'high';
  readonly dataPolicies: readonly string[];
};

export type TeamProviderPreflightInput = {
  readonly requestedProviderId: string;
  readonly requestedModelId?: string | null;
  readonly requestedPlanId: string;
  readonly requiredCapabilities: readonly string[];
  readonly risk: 'low' | 'medium' | 'high';
  readonly dataPolicy: string;
  readonly candidates: readonly TeamProviderPlan[];
  readonly checks: {
    readonly authOk: boolean;
    readonly schemaOk: boolean;
    readonly quotaOk: boolean;
    readonly billingOk: boolean;
  };
};

export type TeamProviderPreflightReport = {
  readonly schemaId: 'atm.teamProviderPreflight.v1';
  readonly ok: boolean;
  readonly providerId: string;
  readonly modelId: string | null;
  readonly planId: string;
  readonly catalogVersion: string | null;
  readonly projectedSpendCeilingUsd: number | null;
  readonly selected: TeamProviderPlan | null;
  readonly failureClasses: readonly TeamProviderFailureClass[];
  readonly cheapestEligibleModelId: string | null;
};

const riskRank = {
  low: 0,
  medium: 1,
  high: 2
} as const;

export function buildTeamProviderPreflight(input: TeamProviderPreflightInput): TeamProviderPreflightReport {
  const matchingProviderPlans = input.candidates.filter((candidate) => candidate.providerId === input.requestedProviderId);
  const requestedPlan = matchingProviderPlans.find((candidate) =>
    candidate.planId === input.requestedPlanId
    && (!input.requestedModelId || candidate.modelId === input.requestedModelId)
  ) ?? null;
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
export async function runTeamPaidProviderPreflight(input: TeamPaidProviderPreflightInput): Promise<TeamPaidProviderPreflightReport> {
  const requestCountByProvider: Record<string, number> = {};
  const failures: { providerId: string; failureClass: TeamProviderFailureClass }[] = [];
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

export function selectCheapestEligibleProviderPlan(input: {
  readonly candidates: readonly TeamProviderPlan[];
  readonly requiredCapabilities: readonly string[];
  readonly risk: TeamProviderPreflightInput['risk'];
  readonly dataPolicy: string;
}): TeamProviderPlan | null {
  const eligible = input.candidates
    .filter((candidate) => planSatisfiesRequirements(candidate, input.requiredCapabilities, input.risk, input.dataPolicy))
    .filter((candidate) => candidate.catalogFresh && candidate.currency === 'USD')
    .sort((left, right) =>
      left.estimatedSpendUsd - right.estimatedSpendUsd
      || left.projectedSpendCeilingUsd - right.projectedSpendCeilingUsd
      || left.modelId.localeCompare(right.modelId)
    );
  return eligible[0] ?? null;
}

function planSatisfiesRequirements(
  plan: TeamProviderPlan,
  requiredCapabilities: readonly string[],
  risk: TeamProviderPreflightInput['risk'],
  dataPolicy: string
) {
  return requiredCapabilities.every((capability) => plan.capabilities.includes(capability))
    && riskRank[plan.maxRisk] >= riskRank[risk]
    && plan.dataPolicies.includes(dataPolicy);
}

function uniqueFailureClasses(values: readonly (TeamProviderFailureClass | null)[]) {
  return [...new Set(values.filter((value): value is TeamProviderFailureClass => value !== null))];
}
