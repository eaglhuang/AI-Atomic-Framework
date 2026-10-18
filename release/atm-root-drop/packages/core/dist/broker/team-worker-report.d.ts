export type WorkerExecutionState = 'done' | 'partial' | 'blocked' | 'not-started' | 'needs-review';
export interface WorkerValidatorRun {
    readonly command: string;
    readonly passed: boolean;
    readonly firstFailingDiagnostic?: string | null;
}
export interface TeamWorkerReport {
    readonly schemaId: 'atm.teamWorkerReport.v1';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly reportId: string;
    readonly taskId: string;
    readonly workerActorId: string;
    readonly executionState: WorkerExecutionState;
    readonly changedFiles: readonly string[];
    readonly validatorRuns: readonly WorkerValidatorRun[];
    readonly deviations?: readonly string[];
    readonly metadata: {
        readonly reportedAt: string;
        readonly waveId: string | null;
        readonly notes?: string | null;
    };
}
export declare function createWorkerReport(input: {
    readonly taskId: string;
    readonly workerActorId: string;
    readonly executionState: WorkerExecutionState;
    readonly changedFiles?: readonly string[];
    readonly validatorRuns?: readonly WorkerValidatorRun[];
    readonly deviations?: readonly string[];
    readonly waveId?: string | null;
    readonly reportedAt?: string;
    readonly notes?: string | null;
}): TeamWorkerReport;
export interface WorkerReportValidation {
    readonly ok: boolean;
    readonly reason: string;
}
/**
 * Validate a worker report's internal consistency:
 *  - a `done` report cannot carry a failing validator run,
 *  - a `done` report must declare at least one changed file,
 *  - every failing validator run should surface a first failing diagnostic.
 * The coordinator treats an inconsistent report as `needs-review`.
 */
export declare function validateWorkerReport(report: TeamWorkerReport): WorkerReportValidation;
/**
 * Reconcile a worker report's self-declared state with its validator evidence.
 * A `done` claim with any failing validator is downgraded to `needs-review`.
 */
export declare function effectiveExecutionState(report: TeamWorkerReport): WorkerExecutionState;
