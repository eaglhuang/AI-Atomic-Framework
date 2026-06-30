/**
 * ATM-2-0017: Regression Matrix Compare Gate
 *
 * Compare two revisions of atom quality metrics and produce
 * a quality-comparison report with optional map impact scope
 * and advisory dedup sections.
 */
type MetricDirection = 'lower-is-better' | 'higher-is-better' | 'informational';
interface MetricConfigRecord {
    readonly direction?: MetricDirection;
    readonly tolerance?: number;
}
interface PropagationStatusRecord {
    readonly mapId?: string;
    readonly integrationTestPassed?: boolean;
    readonly message?: string | null;
}
interface MapImpactScopeRecord {
    readonly affectedMapIds: string[];
    readonly propagationStatus: PropagationStatusRecord[];
}
interface DedupCandidateRecord {
    readonly atomId?: string;
    readonly similarity?: number;
    readonly semanticFingerprint?: string | null;
    readonly polymorphGroupId?: string;
    readonly reason?: string;
    readonly [key: string]: unknown;
}
interface PolymorphContextRecord {
    readonly groupId?: string;
    readonly instanceAtomIds?: unknown[];
}
interface QualityMetricDeltaRecord {
    readonly name: string;
    readonly baseline: number;
    readonly current: number;
    readonly delta: number;
    readonly direction: MetricDirection;
    readonly tolerance: number;
    readonly passed: boolean;
}
interface QualityCompareOptions {
    readonly atomId?: string;
    readonly fromVersion?: string;
    readonly toVersion?: string;
    readonly baselineMetrics?: Record<string, number>;
    readonly currentMetrics?: Record<string, number>;
    readonly metricConfig?: Record<string, MetricConfigRecord>;
    readonly mapImpactScope?: MapImpactScopeRecord | null;
    readonly dedupCandidates?: DedupCandidateRecord[] | null;
    readonly polymorphContext?: PolymorphContextRecord | null;
}
export interface QualityComparisonReport {
    atomId: string;
    fromVersion: string;
    toVersion: string;
    generatedAt: string;
    passed: boolean;
    regressed: boolean;
    regressedMetrics: string[];
    metrics: QualityMetricDeltaRecord[];
    reportId?: string;
    mapImpactScope?: MapImpactScopeRecord;
    dedupCandidates?: DedupCandidateRecord[];
    dedupIgnoredAsPolymorph?: DedupCandidateRecord[];
}
export declare function compareQualityMetrics(options: QualityCompareOptions | Record<string, unknown>): QualityComparisonReport & Record<string, unknown>;
export declare function renderQualityReportMarkdown(report: QualityComparisonReport | Record<string, unknown>): string;
export {};
