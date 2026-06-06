import { defaultTestReportFileName, resolveAtomicTestReportPath } from './atom-space.ts';
export declare const defaultTestReportSchemaPath: string;
export declare const defaultTestReportMetricsSchemaPath: string;
export declare const defaultTestReportMigration: Readonly<{
    strategy: "none";
    fromVersion: null;
    notes: "Initial alpha0 test runner report.";
}>;
export { defaultTestReportFileName, resolveAtomicTestReportPath };
export declare function createAtomicTestRunnerContract(normalizedModel: any): {
    executionMode: string;
    evidenceRequired: boolean;
    commands: any;
};
export declare function runAtomicTestRunner(normalizedModel: any, options?: any): {
    ok: boolean;
    atomId: any;
    exitCode: any;
    reportPath: any;
    runnerContract: {
        executionMode: string;
        evidenceRequired: boolean;
        commands: any;
    };
    commandResults: any;
    report: {
        schemaId: string;
        specVersion: string;
        migration: Readonly<{
            strategy: "none";
            fromVersion: null;
            notes: "Initial alpha0 test runner report.";
        }>;
        atomId: any;
        ok: boolean;
        exitCode: any;
        generatedAt: any;
        repositoryRoot: any;
        specPath: any;
        hashLock: {
            algorithm: any;
            digest: any;
            canonicalization: any;
        };
        validation: {
            evidenceRequired: boolean;
            commandCount: any;
        };
        runnerContract: any;
        results: any[];
        summary: {
            total: number;
            passed: number;
            failed: number;
            durationMs: any;
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
            summary: string;
            artifactPaths: any[];
        }[];
    };
    reportValidation: {
        ok: boolean;
        schemaPath: any;
        promptReport: {
            code: any;
            summary: string;
            issues: any;
        };
    };
};
export declare function createAtomicTestReport(normalizedModel: any, options?: any): {
    schemaId: string;
    specVersion: string;
    migration: Readonly<{
        strategy: "none";
        fromVersion: null;
        notes: "Initial alpha0 test runner report.";
    }>;
    atomId: any;
    ok: boolean;
    exitCode: any;
    generatedAt: any;
    repositoryRoot: any;
    specPath: any;
    hashLock: {
        algorithm: any;
        digest: any;
        canonicalization: any;
    };
    validation: {
        evidenceRequired: boolean;
        commandCount: any;
    };
    runnerContract: any;
    results: any[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        durationMs: any;
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
        summary: string;
        artifactPaths: any[];
    }[];
};
export declare function validateAtomicTestReportDocument(reportDocument: any, options?: any): {
    ok: boolean;
    schemaPath: any;
    promptReport: {
        code: any;
        summary: string;
        issues: any;
    };
};
