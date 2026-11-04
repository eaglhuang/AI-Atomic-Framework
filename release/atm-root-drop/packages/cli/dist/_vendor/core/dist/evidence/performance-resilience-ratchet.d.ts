export declare const PERFORMANCE_RESILIENCE_RATCHET_SCHEMA_ID: "atm.performanceResilienceRatchet.v1";
export declare const PERFORMANCE_RESILIENCE_RATCHET_COMPILER_ID: "atm.performance-resilience-ratchet.compiler.v1";
export type PerformanceResilienceStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export type PerformanceMetric = 'latencyMs' | 'memoryBytes' | 'successRate' | 'resilienceRate';
export interface PerformanceResilienceAuthority {
    readonly authorityId: string;
    readonly digest: string;
    readonly sealed: true;
}
export interface PerformanceBenchmark {
    readonly benchmarkId: string;
    readonly latencyMs: number;
    readonly memoryBytes: number;
    readonly successRate: number;
    readonly resilienceRate: number;
    readonly digest: string;
}
export interface PerformanceResilienceLimits {
    readonly maxLatencyRegressionMs: number;
    readonly maxMemoryRegressionBytes: number;
    readonly minSuccessRate: number;
    readonly minResilienceRate: number;
}
export interface PerformanceResilienceInput {
    readonly ratchetId: string;
    readonly generatedAt: string;
    readonly authority: PerformanceResilienceAuthority;
    readonly observedAuthorityDigest: string;
    readonly baselines: readonly PerformanceBenchmark[];
    readonly observations: readonly PerformanceBenchmark[];
    readonly limits: PerformanceResilienceLimits;
    readonly metrics?: readonly string[];
    readonly provenance?: Readonly<Record<string, unknown>>;
}
export interface PerformanceResilienceResult {
    readonly schemaId: typeof PERFORMANCE_RESILIENCE_RATCHET_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly compilerId: typeof PERFORMANCE_RESILIENCE_RATCHET_COMPILER_ID;
    readonly ratchetId: string;
    readonly generatedAt: string;
    readonly authority: PerformanceResilienceAuthority;
    readonly limits: PerformanceResilienceLimits;
    readonly baselines: readonly PerformanceBenchmark[];
    readonly observations: readonly PerformanceBenchmark[];
    readonly projection: {
        readonly benchmarkCount: number;
        readonly regressions: readonly string[];
        readonly passed: readonly string[];
    };
    readonly status: PerformanceResilienceStatus;
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly provenance: Readonly<Record<string, unknown>>;
    readonly resultDigest: string;
}
export declare function compilePerformanceResilienceRatchet(input: PerformanceResilienceInput): PerformanceResilienceResult;
export declare const createPerformanceResilienceRatchet: typeof compilePerformanceResilienceRatchet;
export declare function replayPerformanceResilienceRatchet(result: PerformanceResilienceResult): PerformanceResilienceResult;
export declare function validatePerformanceResilienceRatchet(result: PerformanceResilienceResult): {
    ok: boolean;
    diagnostics: string[];
};
