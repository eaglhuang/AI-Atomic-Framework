import type { SharedWriteReceipt } from './shared-delivery-commit.ts';
import type { WaveBrokerBatchDecision, WaveBrokerSchedulerDocument } from './wave-broker-scheduler.ts';
export type SharedDeliverySagaPhase = 'prepare-inputs' | 'plan-blockers' | 'compose-and-semantic-checks' | 'prepare-temp-index' | 'verify-expected-head' | 'cas-publish' | 'write-receipt' | 'generated-writes' | 'checkpoint' | 'closeback' | 'push';
export type SharedDeliveryKillpoint = 'before-blocker-plan' | 'after-blocker-plan' | 'after-temp-tree' | 'after-commit-object' | 'after-update-ref' | 'after-receipt-write' | 'after-build' | 'after-projection' | 'after-checkpoint' | 'after-closeback' | 'after-push';
export type SharedDeliverySideEffectKind = 'commit' | 'update-ref' | 'receipt' | 'build' | 'projection' | 'checkpoint' | 'closeback' | 'push';
export type SharedDeliverySideEffectState = 'planned' | 'acknowledged' | 'replayed' | 'compensate' | 'blocked';
export interface SharedDeliverySagaMember {
    readonly taskId: string;
    readonly ticketId: string;
    readonly fileSlice: readonly string[];
    readonly validatorRefs: readonly string[];
    readonly semanticRefs: readonly string[];
}
export interface SharedDeliverySagaSideEffect {
    readonly operationId: string;
    readonly kind: SharedDeliverySideEffectKind;
    readonly state: SharedDeliverySideEffectState;
    readonly attempt: number;
    readonly acknowledged: boolean;
    readonly compensation: string | null;
}
export interface SharedDeliverySagaJournal {
    readonly schemaId: 'atm.sharedDeliverySagaJournal.v1';
    readonly specVersion: '0.1.0';
    readonly sagaId: string;
    readonly waveId: string;
    readonly phases: readonly SharedDeliverySagaPhase[];
    readonly completedPhases: readonly SharedDeliverySagaPhase[];
    readonly killpoint: SharedDeliveryKillpoint | null;
    readonly sideEffects: readonly SharedDeliverySagaSideEffect[];
    readonly expectedHeadSha: string;
    readonly actualHeadSha: string | null;
    readonly terminalState: 'planned' | 'ready-to-publish' | 'published' | 'recovered' | 'blocked';
}
export interface SharedDeliverySagaReceipt {
    readonly schemaId: 'atm.sharedDeliverySagaReceipt.v1';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none';
        readonly fromVersion: null;
        readonly notes: string;
    };
    readonly sagaId: string;
    readonly waveId: string;
    readonly taskIds: readonly string[];
    readonly ticketIds: readonly string[];
    readonly expectedHeadSha: string;
    readonly actualHeadSha: string | null;
    readonly commitSha: string | null;
    readonly sharedWriteReceiptDigest: string | null;
    readonly memberSlices: readonly SharedDeliverySagaMember[];
    readonly sideEffects: readonly SharedDeliverySagaSideEffect[];
    readonly recoveryAction: 'none' | 'replay-receipt' | 'rearbitrate' | 'compensate';
    readonly exactlyOnce: boolean;
}
export interface SharedDeliverySagaPlan {
    readonly schemaId: 'atm.sharedDeliverySagaPlan.v1';
    readonly ok: boolean;
    readonly sagaId: string;
    readonly blockers: readonly string[];
    readonly journal: SharedDeliverySagaJournal;
    readonly receipt: SharedDeliverySagaReceipt | null;
}
export declare function planSharedDeliverySaga(input: {
    readonly decision: WaveBrokerBatchDecision;
    readonly scheduler: WaveBrokerSchedulerDocument;
    readonly expectedHeadSha: string;
    readonly actualHeadSha?: string | null;
    readonly sharedWriteReceipt?: SharedWriteReceipt | null;
    readonly fileSlices: Readonly<Record<string, readonly string[]>>;
    readonly validatorRefs: Readonly<Record<string, readonly string[]>>;
    readonly semanticRefs?: Readonly<Record<string, readonly string[]>>;
    readonly killpoint?: SharedDeliveryKillpoint | null;
    readonly attemptedSideEffects?: readonly SharedDeliverySagaSideEffect[];
}): SharedDeliverySagaPlan;
