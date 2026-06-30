import { defaultTestReportFileName, resolveAtomicTestReportPath } from './atom-space.ts';
import type { AtomicTestRunnerConfig, TestRunnerCommand, TestRunnerProfile } from '../../../plugin-sdk/src/test-runner.ts';
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
interface TestRunnerModel {
    identity: {
        atomId: string;
    };
    source: {
        specPath?: string | null;
    };
    execution: {
        validation: {
            commands: string[];
            evidenceRequired?: boolean;
        };
    };
    hashLock: {
        algorithm: string;
        digest: string;
        canonicalization: string;
    };
}
interface ExecuteCommandOutcome {
    exitCode?: number;
    durationMs?: number;
    stdout?: string;
    stderr?: string;
    signal?: string | null;
}
interface BasicRunnerOptions {
    repositoryRoot?: string;
    reportPath?: string;
    workbenchPath?: string;
    workbenchRoot?: string;
    now?: string;
    schemaPath?: string;
    writeReport?: boolean;
    executeCommand?: (command: string, context: Record<string, unknown>) => ExecuteCommandOutcome;
    runnerConfigPath?: string;
    runnerConfig?: AtomicTestRunnerConfig | null;
    profile?: unknown;
    suite?: unknown;
    [key: string]: unknown;
}
interface AtomicTestReportEntry extends Record<string, unknown> {
    ok?: boolean;
    exitCode?: unknown;
    durationMs?: unknown;
    status?: string;
    blocking?: boolean;
    key?: string | null;
    family?: string | null;
    dedupeKeys?: string[] | null;
}
interface CommandResultRecord extends AtomicTestReportEntry {
    commandId: string;
    commandKind: string;
    command: string;
    required?: boolean;
    stdout: string;
    stderr: string;
    signal: string | null;
}
interface AtomicTestReportOptions {
    results?: AtomicTestReportEntry[];
    runnerContract?: {
        evidenceRequired?: boolean;
        commands?: unknown[];
        [key: string]: unknown;
    };
    pluginRuns?: Array<Record<string, unknown>>;
    gateResults?: AtomicTestReportEntry[];
    reportPath?: string;
    generatedAt?: string;
    repositoryRoot?: string;
    [key: string]: unknown;
}
export declare function createAtomicTestRunnerContract(normalizedModel: TestRunnerModel | null): {
    executionMode: string;
    evidenceRequired: boolean;
    commands: {
        commandId: string;
        commandKind: string;
        command: string;
        required: boolean;
    }[];
};
export declare function runAtomicTestRunner(normalizedModel: TestRunnerModel | null, options?: BasicRunnerOptions): {
    ok: boolean;
    atomId: string;
    exitCode: {};
    reportPath: string;
    runnerContract: {
        executionMode: string;
        evidenceRequired: boolean;
        commands: {
            commandId: string;
            commandKind: string;
            command: string;
            required: boolean;
        }[];
    };
    commandResults: CommandResultRecord[];
    report: {
        schemaId: string;
        specVersion: string;
        migration: Readonly<{
            strategy: "none";
            fromVersion: null;
            notes: "Initial alpha0 test runner report.";
        }>;
        atomId: string;
        ok: boolean;
        exitCode: {};
        generatedAt: string;
        repositoryRoot: string;
        specPath: string | null | undefined;
        hashLock: {
            algorithm: string;
            digest: string;
            canonicalization: string;
        };
        validation: {
            evidenceRequired: boolean;
            commandCount: number;
        };
        runnerContract: {
            [key: string]: unknown;
            evidenceRequired?: boolean;
            commands?: unknown[];
        } | {
            executionMode: string;
            evidenceRequired: boolean;
            commands: {
                commandId: string;
                commandKind: string;
                command: string;
                required: boolean;
            }[];
        };
        results: AtomicTestReportEntry[];
        pluginRuns: Record<string, unknown>[];
        gateResults: AtomicTestReportEntry[];
        summary: {
            total: number;
            passed: number;
            failed: number;
            durationMs: number;
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
            summary: string;
            artifactPaths: string[];
        }[];
    };
    reportValidation: {
        ok: boolean;
        schemaPath: string;
        promptReport: {
            code: string;
            summary: string;
            issues: unknown[];
        };
    };
};
export declare function runAtomicTestRunnerExtended(normalizedModel: TestRunnerModel | null, options?: BasicRunnerOptions): Promise<{
    ok: boolean;
    atomId: string;
    exitCode: {};
    reportPath: string;
    runnerContract: {
        executionMode: string;
        evidenceRequired: boolean;
        profile: TestRunnerProfile;
        suite: string | null;
        commands: (TestRunnerCommand | {
            commandId: string;
            commandKind: string;
            command: string;
            required: boolean;
        })[];
        plugins: Record<string, unknown>[];
        gates: Record<string, unknown>[];
    };
    commandResults: CommandResultRecord[];
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
        atomId: string;
        ok: boolean;
        exitCode: {};
        generatedAt: string;
        repositoryRoot: string;
        specPath: string | null | undefined;
        hashLock: {
            algorithm: string;
            digest: string;
            canonicalization: string;
        };
        validation: {
            evidenceRequired: boolean;
            commandCount: number;
        };
        runnerContract: {
            [key: string]: unknown;
            evidenceRequired?: boolean;
            commands?: unknown[];
        } | {
            executionMode: string;
            evidenceRequired: boolean;
            commands: {
                commandId: string;
                commandKind: string;
                command: string;
                required: boolean;
            }[];
        };
        results: AtomicTestReportEntry[];
        pluginRuns: Record<string, unknown>[];
        gateResults: AtomicTestReportEntry[];
        summary: {
            total: number;
            passed: number;
            failed: number;
            durationMs: number;
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
            summary: string;
            artifactPaths: string[];
        }[];
    };
    reportValidation: {
        ok: boolean;
        schemaPath: string;
        promptReport: {
            code: string;
            summary: string;
            issues: unknown[];
        };
    };
    runnerConfigPath: string | null;
}>;
export declare function createAtomicTestReport(normalizedModel: TestRunnerModel, options?: AtomicTestReportOptions): {
    schemaId: string;
    specVersion: string;
    migration: Readonly<{
        strategy: "none";
        fromVersion: null;
        notes: "Initial alpha0 test runner report.";
    }>;
    atomId: string;
    ok: boolean;
    exitCode: {};
    generatedAt: string;
    repositoryRoot: string;
    specPath: string | null | undefined;
    hashLock: {
        algorithm: string;
        digest: string;
        canonicalization: string;
    };
    validation: {
        evidenceRequired: boolean;
        commandCount: number;
    };
    runnerContract: {
        [key: string]: unknown;
        evidenceRequired?: boolean;
        commands?: unknown[];
    } | {
        executionMode: string;
        evidenceRequired: boolean;
        commands: {
            commandId: string;
            commandKind: string;
            command: string;
            required: boolean;
        }[];
    };
    results: AtomicTestReportEntry[];
    pluginRuns: Record<string, unknown>[];
    gateResults: AtomicTestReportEntry[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        durationMs: number;
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
        summary: string;
        artifactPaths: string[];
    }[];
};
export declare function validateAtomicTestReportDocument(reportDocument: Record<string, unknown>, options?: {
    schemaPath?: string;
}): {
    ok: boolean;
    schemaPath: string;
    promptReport: {
        code: string;
        summary: string;
        issues: unknown[];
    };
};
