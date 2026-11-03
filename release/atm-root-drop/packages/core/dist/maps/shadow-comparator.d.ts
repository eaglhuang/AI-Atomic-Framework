export interface ShadowSample {
    fixtureId: string;
    legacyOutput: unknown;
    atomOutput: unknown;
    legacyMs: number;
    atomMs: number;
    legacyMemoryMB?: number;
    atomMemoryMB?: number;
}
export interface ShadowDivergence {
    fixtureId: string;
    legacyHash: string;
    atomHash: string;
    diffSummary: string;
    critical: boolean;
}
export type PromotionRecommendation = 'recommend-canary' | 'hold' | 'rollback-alert';
export interface ShadowComparisonReport {
    schemaId: 'atm.shadowComparisonReport';
    runId: string;
    mapId: string;
    generatedAt: string;
    shadowPeriodDays: number;
    sampleSize: number;
    outputConsistencyRate: number;
    avgLegacyMs: number;
    avgAtomMs: number;
    peakMemoryDeltaMB: number;
    divergences: ShadowDivergence[];
    promotionRecommendation: PromotionRecommendation;
    promotionReasons: string[];
}
export declare function runShadowComparison(mapId: string, samples: ShadowSample[], options?: {
    shadowPeriodDays?: number;
    criticalFixtureIds?: Set<string>;
}): ShadowComparisonReport;
export declare function writeShadowComparisonReport(repositoryRoot: string, report: ShadowComparisonReport): string;
export declare function readShadowComparisonReport(repositoryRoot: string, mapId: string): ShadowComparisonReport | null;
