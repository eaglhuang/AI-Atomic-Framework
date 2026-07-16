export type TeamEfficiencyRouting = 'promote-production' | 'prefer-team' | 'bounded-experiment' | 'scale-down' | 'single-agent';
export type TeamEfficiencyScaleDownAction = 'none' | 'collapse-roles' | 'cheaper-qualified-model' | 'shrink-team-size' | 'disable-team-for-workload';
export type TeamEfficiencyRatios = {
    readonly fullyLoadedCostRatio: number | null;
    readonly wallClockRatio: number | null;
    readonly tokenRatio: number | null;
    readonly repairResidueRatio: number | null;
};
export type TeamEfficiencyTelemetry = {
    readonly contextInflation: boolean;
    readonly cacheMiss: boolean;
    readonly retries: number;
    readonly quotaOk: boolean;
    readonly queueWaitInflationRatio: number | null;
    readonly spendingCeilingRisk: boolean;
};
export type TeamEfficiencyControllerDecision = {
    readonly schemaId: 'atm.teamEfficiencyControllerDecision.v1';
    readonly routing: TeamEfficiencyRouting;
    readonly promotionEligible: boolean;
    readonly preferredRouting: boolean;
    readonly breakthroughTarget: boolean;
    readonly boundedExperiment: boolean;
    readonly cohortKey: string;
    readonly scaleDownAction: TeamEfficiencyScaleDownAction;
    readonly reasonCodes: readonly string[];
    readonly bottleneckCause: string | null;
    readonly optimizationBacklogTarget: string | null;
    readonly tokenDiagnosticReasonCodes: readonly string[];
};
export type TeamDogfoodPairedSampleForEfficiency = {
    readonly sampleId: string;
    readonly pricingCatalogVersion?: string | null;
    readonly measurementStatus: 'measurement-incomplete' | 'complete';
    readonly providerBillableUsage: boolean;
    readonly modelIdentities?: readonly string[];
    readonly wallClock: {
        readonly baselineMs: number | null;
        readonly teamMs: number | null;
    };
    readonly qualityOutcome: {
        readonly baselinePassed: boolean | null;
        readonly teamPassed: boolean | null;
    };
    readonly usage?: {
        readonly baseline?: {
            readonly inputTokens?: number;
            readonly outputTokens?: number;
            readonly cacheReadTokens?: number;
            readonly reasoningTokens?: number;
        };
        readonly team?: {
            readonly inputTokens?: number;
            readonly outputTokens?: number;
            readonly cacheReadTokens?: number;
            readonly reasoningTokens?: number;
        };
    };
};
export type TeamEfficiencyPairedSampleEvaluation = {
    readonly schemaId: 'atm.teamEfficiencyPairedSampleEvaluation.v1';
    readonly sampleId: string;
    readonly decision: TeamEfficiencyControllerDecision;
    readonly incident: ReturnType<typeof createTeamEfficiencyIncident>;
};
export declare function evaluateTeamEfficiency(input: {
    readonly workloadClass: string | null;
    readonly rosterFingerprintDigest: string;
    readonly modelMixDigest: string;
    readonly contextManifestDigest: string;
    readonly promptCachePolicy: string;
    readonly fanOutCap: number;
    readonly quotaProbeDigest: string;
    readonly pricingCatalogVersion: string;
    readonly priceEvidenceFresh: boolean;
    readonly usageEvidenceComplete: boolean;
    readonly qualityParity: boolean;
    readonly noWorseRepairResidue: boolean;
    readonly stopLossTriggered: boolean;
    readonly ratios: TeamEfficiencyRatios;
    readonly telemetry: TeamEfficiencyTelemetry;
}): TeamEfficiencyControllerDecision;
export declare function evaluatePairedDogfoodSample(input: {
    readonly sample: TeamDogfoodPairedSampleForEfficiency;
    readonly workloadClass?: string | null;
    readonly generatedAt?: string;
}): TeamEfficiencyPairedSampleEvaluation;
export declare function createTeamEfficiencyIncident(input: {
    readonly sampleId: string;
    readonly decision: TeamEfficiencyControllerDecision;
    readonly ratios: TeamEfficiencyRatios;
    readonly generatedAt?: string;
}): {
    schemaId: "atm.teamEfficiencyIncident.v1";
    specVersion: string;
    migration: {
        strategy: string;
        fromVersion: null;
        notes: string;
    };
    incidentId: string;
    generatedAt: string;
    severity: "advisory" | "blocking";
    reason: string;
    sampleId: string;
    cohortKey: string;
    routing: TeamEfficiencyRouting;
    scaleDownAction: TeamEfficiencyScaleDownAction;
    bottleneckCause: string | null;
    optimizationBacklogTarget: string | null;
    tokenDiagnosticReasonCodes: readonly string[];
    ratios: {
        incrementalCashCostRatio: number;
        fullyLoadedCashCostRatio: number;
        listPriceEquivalentCostRatio: number;
        singleTaskLatencyRatio: number;
        batchMakespanRatio: number;
        throughputRatio: number;
        tokenRatio: number;
        repairResidueRatio: number;
    };
};
