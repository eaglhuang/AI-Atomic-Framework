export declare const parallelAdmissionPolicySchemaId = "atm.parallelAdmissionPolicy.v1";
export declare const parallelAdmissionPolicySpecVersion = "0.1.0";
export type ParallelAdmissionMode = 'enforce' | 'observe';
export type ParallelAdmissionFallbackMode = 'queue-only' | 'fail-closed';
export type ParallelAdmissionGateClass = 'hard-exception' | 'ticketed-shared-write';
export type ParallelAdmissionGateId = 'R1_SAME_TASK_SECOND_LANE' | 'R2_DEPENDENCY_GATE' | 'R3_SHARED_WRITE_SURFACE' | 'R4_SHARED_SIDE_EFFECT';
export interface ParallelAdmissionGatePolicy {
    readonly gateId: ParallelAdmissionGateId;
    readonly gateClass: ParallelAdmissionGateClass;
    readonly owner: string;
    readonly adapter: string;
    readonly statusCommand: string;
    readonly nextAction: string;
    readonly recoveryCommand: string;
    readonly canPolicyRelax: boolean;
}
export interface ParallelAdmissionPolicy {
    readonly schemaId: typeof parallelAdmissionPolicySchemaId;
    readonly specVersion: typeof parallelAdmissionPolicySpecVersion;
    readonly mode: ParallelAdmissionMode;
    readonly circuitBreakerEnabled: boolean;
    readonly fallbackMode: ParallelAdmissionFallbackMode;
    readonly rolloutScope: readonly string[];
    readonly configDigest: string;
    readonly tripped: boolean;
    readonly trippedAt: string | null;
    readonly trippedBy: string | null;
    readonly tripReason: string | null;
    readonly resetEvidenceDigest: string | null;
    readonly resetAt: string | null;
    readonly gatePolicies: readonly ParallelAdmissionGatePolicy[];
}
export interface ParallelAdmissionPolicyReceipt {
    readonly schemaId: 'atm.parallelAdmissionPolicyReceipt.v1';
    readonly action: 'status' | 'set' | 'trip' | 'reset';
    readonly actorId: string | null;
    readonly createdAt: string;
    readonly policyPath: string;
    readonly policy: ParallelAdmissionPolicy;
    readonly rollbackCommand: string;
}
export interface ParallelAdmissionSafetyMetrics {
    readonly schemaId?: 'atm.parallelAdmissionSafetyMetrics.v1';
    readonly taskId?: string;
    readonly cellCount: number;
    readonly requiredCellCount: number;
    readonly medianMakespanImprovementPct: number;
    readonly activeThroughputImprovementPct: number;
    readonly productionCostRatio: number;
    readonly coveragePct: number;
    readonly sideEffectCounts: {
        readonly silentOverwrite: number;
        readonly escapedConflict: number;
        readonly duplicateSideEffect: number;
        readonly unresolvedStarvation: number;
    };
    readonly taskSummary: {
        readonly window: string;
        readonly watermark: string;
        readonly sealedDigest: string;
    };
}
export interface ParallelAdmissionSafetyDecision {
    readonly schemaId: 'atm.parallelAdmissionSafetyDecision.v1';
    readonly verdict: 'pass' | 'trip';
    readonly fallbackMode: ParallelAdmissionFallbackMode;
    readonly evidenceDigest: string;
    readonly blockers: readonly string[];
    readonly resetEligible: boolean;
}
export declare function defaultParallelAdmissionPolicy(): ParallelAdmissionPolicy;
export declare function defaultGatePolicies(): readonly ParallelAdmissionGatePolicy[];
export declare function parallelAdmissionPolicyPath(cwd: string): string;
export declare function readParallelAdmissionPolicy(cwd: string): ParallelAdmissionPolicy;
export declare function writeParallelAdmissionPolicy(cwd: string, policy: ParallelAdmissionPolicy): ParallelAdmissionPolicy;
export declare function updateParallelAdmissionPolicy(cwd: string, patch: Partial<Pick<ParallelAdmissionPolicy, 'mode' | 'circuitBreakerEnabled' | 'fallbackMode' | 'rolloutScope'>>): ParallelAdmissionPolicy;
export declare function tripParallelAdmissionPolicy(cwd: string, input: {
    readonly actorId: string | null;
    readonly reason: string;
}): ParallelAdmissionPolicy;
export declare function resetParallelAdmissionPolicy(cwd: string, input: {
    readonly actorId: string | null;
    readonly receiptDigest: string;
}): ParallelAdmissionPolicy;
export declare function evaluateParallelAdmissionSafety(metrics: ParallelAdmissionSafetyMetrics): ParallelAdmissionSafetyDecision;
export declare function applyParallelAdmissionSafetyDecision(policy: ParallelAdmissionPolicy, input: {
    readonly actorId: string | null;
    readonly metrics: ParallelAdmissionSafetyMetrics;
    readonly now?: string;
}): ParallelAdmissionPolicy;
export declare function buildParallelAdmissionReceipt(input: {
    readonly cwd: string;
    readonly action: ParallelAdmissionPolicyReceipt['action'];
    readonly actorId: string | null;
    readonly policy: ParallelAdmissionPolicy;
}): ParallelAdmissionPolicyReceipt;
export declare function resolveGatePolicy(gateId: ParallelAdmissionGateId, policy?: ParallelAdmissionPolicy): ParallelAdmissionGatePolicy | null;
