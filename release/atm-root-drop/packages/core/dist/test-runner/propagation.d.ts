export declare const propagationTriggerBehaviors: readonly string[];
export declare const defaultPropagationReportMigration: Readonly<{
    strategy: "none";
    fromVersion: null;
    notes: "Initial propagation report contract.";
}>;
export declare function shouldPropagateBehavior(behavior: any): boolean;
export declare function discoverMapsForAtom(atomId: any, options: any): string[];
export declare function runPropagationIntegration(atomId: any, options: any): {
    ok: boolean;
    atomId: any;
    behavior: any;
    skipped: boolean;
    discoveredMaps: string[];
    perMapStatus: {
        mapId: any;
        ok: boolean;
        exitCode: number;
        durationMs: number;
        resolutionMode: string;
        reportPath: string;
        stdout: string;
        stderr: string;
        warnings: string[];
    }[];
    failedDownstream: any[];
    propagationDuration: number;
    metrics: {
        latency: number;
        errorRate: number;
        coverage: number | null;
        edgeCaseCount: number;
    };
    summary: {
        total: number;
        passed: number;
        failed: number;
        durationMs: number;
    };
};
export declare function createPropagationReport(propagation: any, options?: any): {
    discoveredMaps: string[];
    perMapStatus: {
        warnings: string[];
        stderr?: any;
        stdout?: any;
        mapId: string;
        ok: boolean;
        exitCode: any;
        durationMs: any;
        resolutionMode: string;
        reportPath: string;
    }[];
    failedDownstream: string[];
    propagationDuration: any;
    metrics: any;
    summary: {
        total: number;
        passed: number;
        failed: number;
        durationMs: number;
    };
    passed: boolean;
    behaviorId?: string | undefined;
    schemaId: string;
    specVersion: string;
    migration: Readonly<{
        strategy: "none";
        fromVersion: null;
        notes: "Initial propagation report contract.";
    }>;
    reportId: any;
    generatedAt: any;
    atomId: string;
};
export declare function validatePropagationReport(report: any, options?: {
    atomId?: string;
    mapId?: string;
}): {
    ok: boolean;
    issues: string[];
};
