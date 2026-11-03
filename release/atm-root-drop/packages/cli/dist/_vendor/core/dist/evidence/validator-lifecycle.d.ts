export declare const VALIDATOR_LIFECYCLE_SUMMARY_SCHEMA_ID: "atm.validatorLifecycleSummary.v1";
export type ValidatorLifecycleEventKind = 'eligible' | 'invoked' | 'skipped' | 'cache-hit' | 'cache-miss' | 'cache-bypass' | 'receipt-reuse' | 'fan-out' | 'passed' | 'failed' | 'blocked';
export interface ValidatorLifecycleEvent {
    readonly schemaId: 'atm.validatorLifecycleEvent.v1';
    readonly validatorId: string;
    readonly validatorVersion: string | null;
    readonly tier: 'fast' | 'default' | 'full' | 'archive-candidate';
    readonly event: ValidatorLifecycleEventKind;
    readonly durationMs: number;
    readonly cacheDecision: string;
    readonly fanOutConsumerCount: number;
    readonly blockingCount: number;
    readonly reusedFromReceipt: boolean;
    readonly usedForDecision: boolean;
}
export interface ValidatorLifecycleSummary {
    readonly schemaId: typeof VALIDATOR_LIFECYCLE_SUMMARY_SCHEMA_ID;
    readonly profile: string;
    readonly mode: string;
    readonly optimizationId: 'ATM-GOV-0200';
    readonly sourceTaskId: 'ATM-GOV-0200';
    readonly dataDrivenDecision: 'sufficient-observation' | 'insufficient-observation';
    readonly historyDigest: string;
    readonly configDigest: string;
    readonly observedWindow: {
        readonly eligibleCount: number;
        readonly invokedCount: number;
        readonly skippedCount: number;
        readonly cacheHitCount: number;
        readonly cacheMissCount: number;
        readonly cacheBypassCount: number;
        readonly receiptReuseCount: number;
        readonly fanOutEventCount: number;
        readonly blockedCount: number;
        readonly durationMs: number;
    };
    readonly tierProposal: {
        readonly fast: readonly string[];
        readonly default: readonly string[];
        readonly full: readonly string[];
        readonly archiveCandidate: readonly string[];
        readonly insufficientObservation: readonly string[];
    };
    readonly rollbackReceipt: {
        readonly schemaId: 'atm.validatorTierRollbackReceipt.v1';
        readonly optimizationId: 'ATM-GOV-0200';
        readonly restoresConfigDigest: string;
        readonly restoresOrderingDigest: string;
        readonly invalidatesTreatmentCache: true;
        readonly parityValidator: string;
    };
    readonly consumedReceipt: {
        readonly schemaId: 'atm.validatorLifecycleConsumedReceipt.v1';
        readonly producerTaskId: 'ATM-GOV-0196' | 'ATM-GOV-0200';
        readonly historyDigest: string;
        readonly configDigest: string;
        readonly consumedBy: 'ATM-GOV-0200' | 'ATM-GOV-0202';
    };
    readonly events: readonly ValidatorLifecycleEvent[];
}
export declare function buildValidatorLifecycleSummary(input: {
    readonly profile: string;
    readonly mode: string;
    readonly durationMs: number;
    readonly validators: readonly Record<string, unknown>[];
    readonly usageTelemetry?: Record<string, unknown> | null;
    readonly dag?: Record<string, unknown> | null;
    readonly config?: unknown;
}): ValidatorLifecycleSummary;
