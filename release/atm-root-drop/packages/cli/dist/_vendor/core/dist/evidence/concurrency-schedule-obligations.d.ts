export declare const CONCURRENCY_SCHEDULE_SCHEMA_ID: "atm.concurrencyScheduleObligationsResult.v1";
export type ScheduleStatus = 'reduced' | 'blocked' | 'unsupported' | 'stale';
export interface ScheduleAuthority {
    readonly authorityId: string;
    readonly sealed: boolean;
    readonly digest: string;
    readonly version?: string | null;
}
export interface ScheduleOperation {
    readonly operationId: string;
    readonly reads?: readonly string[];
    readonly writes?: readonly string[];
    readonly dependsOn?: readonly string[];
    readonly sourceRef?: string | null;
}
export interface ScheduleInput {
    readonly scheduleId: string;
    readonly authority: ScheduleAuthority;
    readonly operations: readonly ScheduleOperation[];
    readonly requestedAt?: string | null;
}
export interface ScheduleDiagnostic {
    readonly code: string;
    readonly severity: 'error' | 'warning';
    readonly message: string;
    readonly ref: string | null;
    readonly repairCommand: string | null;
}
export interface ScheduleObligation {
    readonly obligationId: string;
    readonly operationIds: readonly string[];
    readonly kind: 'order' | 'conflict' | 'dependency';
    readonly status: 'satisfied' | 'blocked';
}
export interface ScheduleResult {
    readonly schemaId: typeof CONCURRENCY_SCHEDULE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly scheduleId: string;
    readonly resultId: string;
    readonly authority: ScheduleAuthority;
    readonly status: ScheduleStatus;
    readonly reducedSchedule: readonly string[];
    readonly independenceClasses: readonly {
        readonly classId: string;
        readonly operationIds: readonly string[];
    }[];
    readonly obligations: readonly ScheduleObligation[];
    readonly diagnostics: readonly ScheduleDiagnostic[];
    readonly provenance: {
        readonly inputDigest: string;
        readonly operationCount: number;
        readonly reductionCount: number;
    };
}
/** One deep seam: normalize, reduce and derive obligations from one sealed schedule authority. */
export declare function reduceConcurrencySchedule(input: ScheduleInput): ScheduleResult;
export declare const createConcurrencyScheduleObligations: typeof reduceConcurrencySchedule;
export declare const reducePartialOrder: typeof reduceConcurrencySchedule;
export declare function replayConcurrencySchedule(input: ScheduleInput, expected: ScheduleResult): {
    readonly deterministic: boolean;
    readonly result: ScheduleResult;
};
export declare function validateConcurrencyScheduleResult(result: ScheduleResult): {
    readonly ok: boolean;
    readonly diagnostics: readonly ScheduleDiagnostic[];
};
