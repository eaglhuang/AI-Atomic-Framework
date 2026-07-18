import type { WaveBrokerBatchDecision, WaveBrokerSchedulerDocument } from './wave-broker-scheduler.ts';
import type { SharedWriteReceipt } from './shared-delivery-commit.ts';
export type WaveGeneratedSurfaceKind = 'build' | 'projection';
export interface WaveGeneratedWriteInput {
    readonly decision: WaveBrokerBatchDecision;
    readonly scheduler: WaveBrokerSchedulerDocument;
    readonly actorId: string;
    readonly surfaceKind: WaveGeneratedSurfaceKind;
    readonly surfaceFamily: string;
    readonly manifestDigest: string;
    readonly sealedSourceSha: string;
    readonly sourceDigest: string;
    readonly outputDigest: string;
    readonly expectedTaskIds?: readonly string[];
    readonly contentAddressedSkip?: boolean;
    readonly now?: string;
}
export interface WaveGeneratedWriteReceipt {
    readonly schemaId: 'atm.waveGeneratedWriteReceipt.v1';
    readonly specVersion: '0.1.0';
    readonly waveId: string;
    readonly surfaceKind: WaveGeneratedSurfaceKind;
    readonly surfaceFamily: string;
    readonly taskIds: readonly string[];
    readonly ticketIds: readonly string[];
    readonly manifestDigest: string;
    readonly sealedSourceSha: string;
    readonly sourceDigest: string;
    readonly outputDigest: string;
    readonly contentAddressedSkip: boolean;
    readonly executorActor: string;
    readonly payloadDigest: string;
    readonly createdAt: string;
}
export interface WaveGeneratedWritePlan {
    readonly schemaId: 'atm.waveGeneratedWritePlan.v1';
    readonly ok: boolean;
    readonly verdict: 'receipt-ready' | 'serial-fallback' | 'blocked';
    readonly reason: string;
    readonly blockers: readonly string[];
    readonly receipt: WaveGeneratedWriteReceipt | null;
}
export interface AtomicWaveCheckpointInput {
    readonly waveId: string;
    readonly taskIds: readonly string[];
    readonly manifestDigest: string;
    readonly deliveryReceipts: readonly SharedWriteReceipt[];
    readonly buildReceipts: readonly WaveGeneratedWriteReceipt[];
    readonly projectionReceipts: readonly WaveGeneratedWriteReceipt[];
    readonly planningClosebackOk?: boolean;
    readonly now?: string;
}
export interface AtomicWaveCheckpointReadiness {
    readonly schemaId: 'atm.atomicWaveCheckpointReadiness.v1';
    readonly specVersion: '0.1.0';
    readonly waveId: string;
    readonly taskIds: readonly string[];
    readonly manifestDigest: string;
    readonly ready: boolean;
    readonly missingByTask: Readonly<Record<string, readonly string[]>>;
    readonly planningCloseback: 'ready' | 'reconcile-required';
    readonly payloadDigest: string;
    readonly createdAt: string;
}
export declare function planWaveGeneratedWrite(input: WaveGeneratedWriteInput): WaveGeneratedWritePlan;
export declare function fanOutWaveGeneratedReceipt(receipt: WaveGeneratedWriteReceipt): {
    schemaId: "atm.waveGeneratedTaskReceiptRef.v1";
    taskId: string;
    waveId: string;
    surfaceKind: WaveGeneratedSurfaceKind;
    surfaceFamily: string;
    manifestDigest: string;
    payloadDigest: string;
}[];
export declare function evaluateAtomicWaveCheckpoint(input: AtomicWaveCheckpointInput): AtomicWaveCheckpointReadiness;
