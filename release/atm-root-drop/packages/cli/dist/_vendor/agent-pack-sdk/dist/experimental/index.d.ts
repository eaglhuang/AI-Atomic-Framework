export declare const experimentalApiSchemaVersion: "atm.experimentalApi.v0.1";
export type ExperimentalApiId = 'agent-pack-preview';
export interface ExperimentalApiDescriptor {
    readonly id: ExperimentalApiId;
    readonly stability: 'experimental';
    readonly since: string;
    readonly summary: string;
    readonly graduationCriteria: readonly string[];
}
export interface ExperimentalApiInvocationInput {
    readonly apiId: ExperimentalApiId | string;
    readonly allowExperimental?: boolean;
    readonly caller?: string;
}
export interface ExperimentalApiInvocationResult {
    readonly schemaVersion: typeof experimentalApiSchemaVersion;
    readonly apiId: ExperimentalApiId;
    readonly stability: 'experimental';
    readonly accepted: true;
    readonly caller: string | null;
    readonly warning: string;
}
export declare class ExperimentalApiError extends Error {
    readonly code: 'ATM_EXPERIMENTAL_API_REQUIRES_OPT_IN' | 'ATM_EXPERIMENTAL_API_UNKNOWN';
    readonly details: Record<string, unknown>;
    constructor(code: ExperimentalApiError['code'], message: string, details?: Record<string, unknown>);
}
/** @experimental */
export declare const experimentalApis: readonly ExperimentalApiDescriptor[];
/** @experimental */
export declare function listExperimentalApis(): readonly ExperimentalApiDescriptor[];
/** @experimental */
export declare function invokeExperimentalApi(input: ExperimentalApiInvocationInput): ExperimentalApiInvocationResult;
