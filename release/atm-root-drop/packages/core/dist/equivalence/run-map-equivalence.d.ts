export declare const defaultMapEquivalenceReportMigration: Readonly<{
    strategy: "none";
    fromVersion: null;
    notes: "Initial alpha0 map equivalence report.";
}>;
export declare function resolveMapEquivalencePaths(mapId: string): {
    workbenchPath: string;
    specPath: string;
    testPath: string;
    reportPath: string;
};
export declare function runMapEquivalence(mapId: string, fixturePath: string, options?: any): Promise<{
    ok: boolean;
    mapId: string;
    reportPath: string;
    fixturePath: string;
    legacyUris: string[];
    resolutionMode: string;
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
            artifactPath: any;
            artifactKind: string;
            producedBy: string;
        }[];
        evidence: {
            evidenceKind: string;
            signalScope: string;
            atomMapId: any;
            summary: string;
            artifactPaths: any[];
        }[];
        passed: boolean;
        knownDivergences?: any[] | undefined;
        schemaId: string;
        specVersion: string;
        migration: Readonly<{
            strategy: "none";
            fromVersion: null;
            notes: "Initial alpha0 map equivalence report.";
        }>;
        reportId: string;
        generatedAt: any;
        mapId: any;
        legacyUris: any[];
        fixtures: {
            fixtureId: string;
            path: any;
            description: string;
        }[];
        cases: any[];
    };
}>;
export declare function createMapEquivalenceReport(input: any): {
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
        artifactPath: any;
        artifactKind: string;
        producedBy: string;
    }[];
    evidence: {
        evidenceKind: string;
        signalScope: string;
        atomMapId: any;
        summary: string;
        artifactPaths: any[];
    }[];
    passed: boolean;
    knownDivergences?: any[] | undefined;
    schemaId: string;
    specVersion: string;
    migration: Readonly<{
        strategy: "none";
        fromVersion: null;
        notes: "Initial alpha0 map equivalence report.";
    }>;
    reportId: string;
    generatedAt: any;
    mapId: any;
    legacyUris: any[];
    fixtures: {
        fixtureId: string;
        path: any;
        description: string;
    }[];
    cases: any[];
};
