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
export type RateDimension = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning' | 'toolCall' | 'request' | 'session' | 'seatMonth' | 'creditOverage';
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
export declare function calculateTeamCostReceipt(input: {
    readonly catalog: ModelPriceCatalog;
    readonly usage: TeamProviderBillableUsage;
    readonly targetCurrency?: string;
    readonly fxSnapshot?: FxSnapshot;
    readonly seatAllocationPolicy?: SeatAllocationPolicy;
}): TeamCostReceipt;
