import type { WaveBrokerBatchDecision, WaveBrokerSchedulerDocument } from './wave-broker-scheduler.js';
import type { SharedWriteReceipt } from './shared-delivery-commit.js';
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
    readonly command?: string | null;
    readonly commandExitCode?: number | null;
    readonly commandDurationMs?: number | null;
    readonly phaseTimingsMs?: Readonly<Record<string, number>> | null;
    readonly observedOutputFiles?: readonly string[];
    readonly treatmentTelemetry?: WaveGeneratedWriteTreatmentTelemetry | null;
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
    readonly command: string | null;
    readonly commandExitCode: number | null;
    readonly commandDurationMs: number | null;
    readonly phaseTimingsMs: Readonly<Record<string, number>>;
    readonly observedOutputFiles: readonly string[];
    readonly telemetry: WaveGeneratedWriteTreatmentTelemetry;
    readonly executorActor: string;
    readonly payloadDigest: string;
    readonly createdAt: string;
}
export interface WaveGeneratedWriteTreatmentTelemetry {
    readonly schemaId: 'atm.generatedWriteTreatmentTelemetry.v1';
    readonly specVersion: '0.1.0';
    readonly surfaceKind: WaveGeneratedSurfaceKind;
    readonly executionMode: 'receipt-only' | 'command-executed' | 'content-addressed-skip';
    readonly sideEffectAllowed: boolean;
    readonly commandExecuted: boolean;
    readonly outputObserved: boolean;
    readonly receiptValidity: 'valid' | 'invalid' | 'pending';
    readonly exactlyOnce: 'not-applicable' | 'observed';
    readonly skipReason: string | null;
    readonly durationMs: number | null;
    readonly phaseTimingsMs: Readonly<Record<string, number>>;
    readonly outputFileCount: number;
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
export interface AtomicWaveCheckpointReceipt {
    readonly schemaId: 'atm.atomicWaveCheckpointReceipt.v1';
    readonly specVersion: '0.1.0';
    readonly waveId: string;
    readonly taskIds: readonly string[];
    readonly manifestDigest: string;
    readonly ready: boolean;
    readonly checkpointWatermark: string;
    readonly readinessDigest: string;
    readonly evidenceConsumed: {
        readonly deliveryReceiptCount: number;
        readonly buildReceiptCount: number;
        readonly projectionReceiptCount: number;
        readonly totalReceiptCount: number;
    };
    readonly evidenceReadback: Readonly<Record<string, {
        readonly commit: 'present' | 'missing';
        readonly build: 'present' | 'missing';
        readonly projection: 'present' | 'missing';
    }>>;
    readonly planningCloseback: {
        readonly status: 'ready' | 'reconcile-required';
        readonly cas: 'matched' | 'conflict';
    };
    readonly missingByTask: Readonly<Record<string, readonly string[]>>;
    readonly treatment: {
        readonly schemaId: 'atm.atomicWaveCheckpointTreatment.v1';
        readonly specVersion: '0.1.0';
        readonly readiness: 'ready' | 'blocked';
        readonly evidenceConsumed: boolean;
        readonly evidenceReadback: boolean;
        readonly uniqueBlock: string | null;
        readonly missingSummary: readonly string[];
    };
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
export declare function createAtomicWaveCheckpointReceipt(input: AtomicWaveCheckpointInput): AtomicWaveCheckpointReceipt;
