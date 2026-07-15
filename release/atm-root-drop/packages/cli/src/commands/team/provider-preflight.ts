export type TeamProviderFailureClass =
  | 'auth'
  | 'model'
  | 'schema'
  | 'quota'
  | 'billing'
  | 'stale-price'
  | 'currency'
  | 'plan';

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
