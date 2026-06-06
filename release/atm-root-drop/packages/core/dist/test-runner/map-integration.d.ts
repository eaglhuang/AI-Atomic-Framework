export declare const defaultMapIntegrationReportMigration: Readonly<{
    strategy: "none";
    fromVersion: null;
    notes: "Initial alpha0 map integration report.";
}>;
export declare function resolveCanonicalMapPaths(mapId: any): {
    workbenchPath: string;
    specPath: string;
    testPath: string;
    reportPath: string;
};
export declare function resolveMapIntegrationTarget(mapId: any, options: any): {
    mapId: any;
    repositoryRoot: string;
    resolutionMode: string;
    workbenchPath: string;
    specPath: string;
    testPath: string;
    reportPath: string;
    warnings: string[];
};
export declare function runMapIntegrationTest(mapId: any, options: any): {
    ok: boolean;
    mapId: any;
    resolutionMode: string;
    warnings: string[];
    reportPath: string;
    mapStatus: {
        mapId: any;
        ok: boolean;
        exitCode: number;
        durationMs: number;
        resolutionMode: string;
        reportPath: string;
        stdout: string;
        stderr: string;
        warnings: string[];
    };
    report: {
        schemaId: string;
        specVersion: string;
        migration: Readonly<{
            strategy: "none";
            fromVersion: null;
            notes: "Initial alpha0 map integration report.";
        }>;
        mapId: any;
        ok: boolean;
        exitCode: any;
        generatedAt: any;
        repositoryRoot: string;
        specPath: any;
        testPath: any;
        reportPath: any;
        resolutionMode: any;
        warnings: any[];
        perMapStatus: any[];
        failedDownstream: any[];
        propagationDuration: any;
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
            summary: string;
            artifactPaths: any[];
        }[];
    };
};
export declare function createMapIntegrationReport(input: any): {
    schemaId: string;
    specVersion: string;
    migration: Readonly<{
        strategy: "none";
        fromVersion: null;
        notes: "Initial alpha0 map integration report.";
    }>;
    mapId: any;
    ok: boolean;
    exitCode: any;
    generatedAt: any;
    repositoryRoot: string;
    specPath: any;
    testPath: any;
    reportPath: any;
    resolutionMode: any;
    warnings: any[];
    perMapStatus: any[];
    failedDownstream: any[];
    propagationDuration: any;
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
        summary: string;
        artifactPaths: any[];
    }[];
};
