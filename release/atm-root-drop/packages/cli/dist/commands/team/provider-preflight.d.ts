export type TeamProviderFailureClass = 'auth' | 'model' | 'schema' | 'quota' | 'billing' | 'stale-price' | 'currency' | 'plan';
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
export declare function buildTeamProviderPreflight(input: TeamProviderPreflightInput): TeamProviderPreflightReport;
export declare function selectCheapestEligibleProviderPlan(input: {
    readonly candidates: readonly TeamProviderPlan[];
    readonly requiredCapabilities: readonly string[];
    readonly risk: TeamProviderPreflightInput['risk'];
    readonly dataPolicy: string;
}): TeamProviderPlan | null;
