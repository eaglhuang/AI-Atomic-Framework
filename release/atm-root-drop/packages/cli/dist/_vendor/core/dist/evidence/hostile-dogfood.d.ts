import type { ParallelReplayTelemetryProof } from '../telemetry/parallel-replay/index.js';
export declare const HOSTILE_DOGFOOD_SCHEMA_ID: "atm.hostileDogfoodReceipt.v1";
export declare const HOSTILE_DOGFOOD_SATURATION_SCHEMA_ID: "atm.hostileDogfoodSaturation.v1";
export type HostileOutcome = 'recovered' | 'blocked' | 'unknown';
export interface HostileCondition {
    readonly condition: string;
    readonly outcome: HostileOutcome;
    readonly overrideLeaseUsed?: boolean;
    readonly rollbackPreserved?: boolean;
    readonly canonicalWorktreeIntact?: boolean;
}
/** A sealed observation produced by one independently operating lane. */
export interface HostileDogfoodLaneReceipt {
    readonly laneId: string;
    readonly actorId: string;
    readonly receiptDigest: string;
    readonly sealed: boolean;
}
export interface HostileDogfoodInput {
    readonly sealedReceiptDigest: string;
    readonly lanes?: readonly HostileDogfoodLaneReceipt[];
    readonly conditions?: readonly HostileCondition[];
    /**
     * The incident universe is supplied by the caller instead of being hidden in
     * this compiler.  That keeps the receipt reusable for new incident families.
     */
    readonly requiredConditions?: readonly string[];
    readonly minimumIndependentLanes?: number;
}
export interface HostileDogfoodResult {
    readonly schemaId: typeof HOSTILE_DOGFOOD_SCHEMA_ID;
    readonly status: 'proven' | 'blocked';
    readonly conditions: readonly HostileCondition[];
    readonly saturation: {
        readonly recurrenceCount: number;
        readonly conditionCount: number;
        readonly requiredConditionCount: number;
        readonly independentLaneCount: number;
    };
    readonly rollbackPreserved: boolean;
    readonly canonicalWorktreeIntact: boolean;
    readonly diagnostics: readonly string[];
    readonly resultDigest: string;
}
export interface HostileDogfoodSaturationInput {
    readonly taskId: string;
    readonly hostile: HostileDogfoodResult;
    readonly replayProof: ParallelReplayTelemetryProof;
    readonly pairedExperiments: readonly {
        readonly label: 'AA' | 'AB' | 'BA';
        readonly sampleCount: number;
        readonly correctnessPass: boolean;
        readonly queueWaitMs: number;
        readonly rollbackPreserved: boolean;
    }[];
    readonly incidentFamilies: readonly {
        readonly family: string;
        readonly recurrenceCount: number;
        readonly disposition: 'known-covered' | 'new-backlog-required' | 'unknown';
    }[];
    readonly stoppingRule: {
        readonly minimumSamplesPerArm: number;
        readonly maximumUnknownFamilies: number;
    };
}
export interface HostileDogfoodSaturationResult {
    readonly schemaId: typeof HOSTILE_DOGFOOD_SATURATION_SCHEMA_ID;
    readonly taskId: string;
    readonly verdict: 'pass' | 'blocked';
    readonly hostileDigest: string;
    readonly replayProofDigest: string;
    readonly pairedExperimentSummary: {
        readonly aaSamples: number;
        readonly abSamples: number;
        readonly baSamples: number;
        readonly correctnessPass: boolean;
        readonly queueWaitMs: number;
        readonly rollbackPreserved: boolean;
    };
    readonly incidentFamilySummary: {
        readonly familyCount: number;
        readonly recurrenceCount: number;
        readonly newBacklogRequiredCount: number;
        readonly unknownDispositionCount: number;
    };
    readonly diagnostics: readonly string[];
    readonly digest: string;
}
export declare function compileHostileDogfood(input: HostileDogfoodInput): HostileDogfoodResult;
export declare function compileHostileDogfoodSaturation(input: HostileDogfoodSaturationInput): HostileDogfoodSaturationResult;
