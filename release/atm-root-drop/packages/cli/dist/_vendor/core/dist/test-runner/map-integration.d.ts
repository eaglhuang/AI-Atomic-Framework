export declare const defaultMapIntegrationReportMigration: Readonly<{
    strategy: "none";
    fromVersion: null;
    notes: "Initial alpha0 map integration report.";
}>;
interface MapIntegrationOptions {
    repositoryRoot?: string;
    now?: string;
    writeReport?: boolean;
}
interface MapTarget {
    mapId: string;
    repositoryRoot: string;
    resolutionMode: 'canonical' | 'legacy';
    workbenchPath: string;
    specPath: string;
    testPath: string;
    reportPath: string;
    warnings: string[];
}
interface MapStatus {
    mapId: string;
    ok: boolean;
    exitCode: number;
    durationMs: number;
    resolutionMode: 'canonical' | 'legacy';
    reportPath: string;
    stdout: string;
    stderr: string;
    warnings: string[];
}
interface CreateMapIntegrationReportInput {
    mapId: string;
    repositoryRoot?: string;
    generatedAt?: string;
    specPath?: string | null;
    testPath?: string | null;
    reportPath?: string | null;
    resolutionMode?: string;
    warnings?: string[];
    perMapStatus?: MapStatus[];
    failedDownstream?: string[];
    propagationDuration?: number;
}
export declare function resolveCanonicalMapPaths(mapId: string): {
    workbenchPath: string;
    specPath: string;
    testPath: string;
    reportPath: string;
};
export declare function resolveMapIntegrationTarget(mapId: string, options: MapIntegrationOptions | null | undefined): MapTarget;
export declare function runMapIntegrationTest(mapId: string, options: MapIntegrationOptions | null | undefined): {
    ok: boolean;
    mapId: string;
    resolutionMode: "canonical" | "legacy";
    warnings: string[];
    reportPath: string;
    mapStatus: {
        mapId: string;
        ok: boolean;
        exitCode: number;
        durationMs: number;
        resolutionMode: "canonical" | "legacy";
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
        mapId: string;
        ok: boolean;
        exitCode: number;
        generatedAt: string;
        repositoryRoot: string;
        specPath: string | null;
        testPath: string | null;
        reportPath: string | null;
        resolutionMode: string;
        warnings: string[];
        perMapStatus: MapStatus[];
        failedDownstream: string[];
        propagationDuration: number;
        metrics: {
            latency: number;
            errorRate: number;
            coverage: number | null;
            edgeCaseCount: number;
        };
        artifacts: {
            artifactPath: string | null | undefined;
            artifactKind: string;
            producedBy: string;
        }[];
        evidence: {
            evidenceKind: string;
            summary: string;
            artifactPaths: (string | null | undefined)[];
        }[];
    };
};
export declare function createMapIntegrationReport(input: CreateMapIntegrationReportInput): {
    schemaId: string;
    specVersion: string;
    migration: Readonly<{
        strategy: "none";
        fromVersion: null;
        notes: "Initial alpha0 map integration report.";
    }>;
    mapId: string;
    ok: boolean;
    exitCode: number;
    generatedAt: string;
    repositoryRoot: string;
    specPath: string | null;
    testPath: string | null;
    reportPath: string | null;
    resolutionMode: string;
    warnings: string[];
    perMapStatus: MapStatus[];
    failedDownstream: string[];
    propagationDuration: number;
    metrics: {
        latency: number;
        errorRate: number;
        coverage: number | null;
        edgeCaseCount: number;
    };
    artifacts: {
        artifactPath: string | null | undefined;
        artifactKind: string;
        producedBy: string;
    }[];
    evidence: {
        evidenceKind: string;
        summary: string;
        artifactPaths: (string | null | undefined)[];
    }[];
};
export {};
