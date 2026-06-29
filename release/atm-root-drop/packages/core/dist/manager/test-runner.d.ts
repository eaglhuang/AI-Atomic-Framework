import { defaultTestReportFileName, resolveAtomicTestReportPath } from './atom-space.ts';
import type { AtomicTestRunnerConfig } from '../../../plugin-sdk/src/test-runner.ts';
export declare const defaultTestReportSchemaPath: string;
export declare const defaultTestReportMetricsSchemaPath: string;
export declare const defaultTestReportMigration: Readonly<{
    strategy: "none";
    fromVersion: null;
    notes: "Initial alpha0 test runner report.";
}>;
export { defaultTestReportFileName, resolveAtomicTestReportPath };
export declare function resolveAtomicTestRunnerConfigPath(specPath: string | null): string | null;
export declare function loadAtomicTestRunnerConfig(configPath: string | null): AtomicTestRunnerConfig | null;
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
        pluginRuns: any[];
        gateResults: any[];
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
export declare function runAtomicTestRunnerExtended(normalizedModel: any, options?: any): Promise<{
    ok: boolean;
    atomId: any;
    exitCode: any;
    reportPath: any;
    runnerContract: {
        executionMode: string;
        evidenceRequired: boolean;
        commands: any[];
        plugins: Record<string, unknown>[];
        gates: Record<string, unknown>[];
    };
    commandResults: any[];
    pluginRuns: Record<string, unknown>[];
    gateResults: Record<string, unknown>[];
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
        pluginRuns: any[];
        gateResults: any[];
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
    runnerConfigPath: any;
}>;
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
    pluginRuns: any[];
    gateResults: any[];
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
