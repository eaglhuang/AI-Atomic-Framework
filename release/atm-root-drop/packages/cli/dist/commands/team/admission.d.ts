import type { TeamProviderId } from '../../../../core/src/team-runtime/provider-contract.ts';
export type TeamAdmissionDecision = 'open-team' | 'downgrade' | 'single-agent';
export type TeamAdmissionWorkGroup = {
    readonly groupId: string;
    readonly files: readonly string[];
    readonly capability: string;
    readonly mutuallyExclusive: boolean;
};
export type TeamAdmissionModelOption = {
    readonly providerId: TeamProviderId;
    readonly modelId: string;
    readonly plan: string;
    readonly capability: string;
    readonly dataPolicy: 'public-ok' | 'private-ok';
    readonly risk: 'low' | 'medium' | 'high';
    readonly costPerUnit: number;
};
export type TeamAdmissionProjection = {
    readonly schemaId: 'atm.teamAdmissionProjection.v1';
    readonly decision: TeamAdmissionDecision;
    readonly reason: string;
    readonly workerCount: number;
    readonly selectedModels: readonly {
        readonly groupId: string;
        readonly providerId: TeamProviderId;
        readonly modelId: string;
        readonly plan: string;
    }[];
    readonly fanOutCap: number;
    readonly quotaProbe: {
        readonly ok: boolean;
        readonly digest: string | null;
        readonly estimatedQueueWaitSeconds: number;
    };
    readonly spending: {
        readonly perWorkerCeiling: number;
        readonly totalCeiling: number;
        readonly stopLossThreshold: number;
    };
    readonly downgradeRoute: 'single-agent' | 'smaller-team' | 'cheaper-model-mix';
    readonly projected: {
        readonly fullyLoadedCostRatio: number | null;
        readonly timeRatio: number | null;
        readonly tokenRatio: number | null;
        readonly qualityParity: boolean;
        readonly noWorseRepairResidue: boolean;
    };
    readonly promotionEligible: boolean;
    readonly boundedExperiment: boolean;
    readonly optimizationReason: string;
    readonly nextExperimentTarget: string | null;
};
export declare function projectTeamAdmission(input: {
    readonly workloadClass: string | null;
    readonly productionDefault: boolean;
    readonly workGroups: readonly TeamAdmissionWorkGroup[];
    readonly sharedBottleneckFiles: readonly string[];
    readonly modelOptions: readonly TeamAdmissionModelOption[];
    readonly fanOutCap: number | null;
    readonly quotaProbeDigest: string | null;
    readonly quotaOk: boolean;
    readonly estimatedQueueWaitSeconds: number;
    readonly perWorkerSpendingCeiling: number;
    readonly totalSpendingCeiling: number;
    readonly stopLossThreshold: number;
    readonly pricingCatalogFresh: boolean;
    readonly subscriptionAllocationComplete: boolean;
    readonly providerUsageComplete: boolean;
    readonly teamRosterFingerprintDigest: string | null;
    readonly fullyLoadedCostRatio: number | null;
    readonly timeRatio: number | null;
    readonly tokenRatio: number | null;
    readonly qualityParity: boolean;
    readonly noWorseRepairResidue: boolean;
}): TeamAdmissionProjection;
export declare function digestTeamAdmissionProjection(projection: TeamAdmissionProjection): string;
