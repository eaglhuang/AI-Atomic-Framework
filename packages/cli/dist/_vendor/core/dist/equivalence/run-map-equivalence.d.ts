export declare const defaultMapEquivalenceReportMigration: Readonly<{
    strategy: "none";
    fromVersion: null;
    notes: "Initial alpha0 map equivalence report.";
}>;
type MetricDirection = 'higher-is-better' | 'lower-is-better' | 'informational';
interface KnownDivergenceRecord {
    readonly caseId: string;
    readonly reason: string;
    readonly justification: string;
    readonly reviewer: string;
    readonly reviewRef: string;
}
interface CaseMetricRecord {
    readonly name: string;
    readonly baseline: number;
    readonly current: number;
    readonly delta: number;
    readonly direction: MetricDirection;
    readonly passed: boolean;
    readonly tolerance?: number;
}
interface ReportCaseRecord {
    readonly caseId: string;
    readonly input: unknown;
    readonly expected: unknown;
    readonly actual: unknown;
    readonly metric: CaseMetricRecord;
    readonly evidenceRefs: string[];
    readonly passed: boolean;
    readonly knownDivergence: boolean;
}
interface MapEquivalenceOptions {
    readonly now?: string;
    readonly writeReport?: boolean;
    readonly repositoryRoot?: string;
}
interface MapEquivalenceReportInput {
    readonly repositoryRoot?: string;
    readonly mapId: string;
    readonly fixtureSetId: string;
    readonly generatedAt?: string;
    readonly legacyUris?: readonly string[];
    readonly fixturePath: string;
    readonly reportPath: string;
    readonly specPath: string;
    readonly knownDivergences?: readonly KnownDivergenceRecord[];
    readonly documentedKnownDivergenceIds?: readonly string[];
    readonly failedCaseIds?: readonly string[];
    readonly cases?: readonly ReportCaseRecord[];
    readonly durationMs?: number;
}
export declare function resolveMapEquivalencePaths(mapId: string): {
    workbenchPath: string;
    specPath: string;
    testPath: string;
    reportPath: string;
};
export declare function runMapEquivalence(mapId: string, fixturePath: string, options?: MapEquivalenceOptions): Promise<{
    ok: boolean;
    mapId: string;
    reportPath: string;
    fixturePath: string;
    legacyUris: string[];
    resolutionMode: "canonical" | "legacy";
    warnings: string[];
    acceptedKnownDivergenceIds: string[];
    failedCaseIds: string[];
    report: {
        summary: {
            totalCases: number;
            passedCases: number;
            failedCases: number;
            knownDivergenceCount: number;
        };
        metrics: {
            latency: number;
            errorRate: number;
            coverage: number | null;
            edgeCaseCount: number;
        };
        artifacts: {
            artifactPath: string;
            artifactKind: string;
            producedBy: string;
        }[];
        evidence: {
            evidenceKind: string;
            signalScope: string;
            atomMapId: string;
            summary: string;
            artifactPaths: string[];
        }[];
        passed: boolean;
        knownDivergences?: KnownDivergenceRecord[] | undefined;
        schemaId: string;
        specVersion: string;
        migration: Readonly<{
            strategy: "none";
            fromVersion: null;
            notes: "Initial alpha0 map equivalence report.";
        }>;
        reportId: string;
        generatedAt: string;
        mapId: string;
        legacyUris: string[];
        fixtures: {
            fixtureId: string;
            path: string;
            description: string;
        }[];
        cases: ReportCaseRecord[];
    };
}>;
export declare function createMapEquivalenceReport(input: MapEquivalenceReportInput): {
    summary: {
        totalCases: number;
        passedCases: number;
        failedCases: number;
        knownDivergenceCount: number;
    };
    metrics: {
        latency: number;
        errorRate: number;
        coverage: number | null;
        edgeCaseCount: number;
    };
    artifacts: {
        artifactPath: string;
        artifactKind: string;
        producedBy: string;
    }[];
    evidence: {
        evidenceKind: string;
        signalScope: string;
        atomMapId: string;
        summary: string;
        artifactPaths: string[];
    }[];
    passed: boolean;
    knownDivergences?: KnownDivergenceRecord[] | undefined;
    schemaId: string;
    specVersion: string;
    migration: Readonly<{
        strategy: "none";
        fromVersion: null;
        notes: "Initial alpha0 map equivalence report.";
    }>;
    reportId: string;
    generatedAt: string;
    mapId: string;
    legacyUris: string[];
    fixtures: {
        fixtureId: string;
        path: string;
        description: string;
    }[];
    cases: ReportCaseRecord[];
};
export {};
