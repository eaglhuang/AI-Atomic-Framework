export type WaveBrokerTicketState = 'queued' | 'head' | 'batched' | 'executing' | 'released' | 'failed' | 'cancelled';
export type WaveBrokerSurfaceKind = 'commit' | 'build' | 'runner-sync' | 'projection' | 'checkpoint';
export interface WaveBrokerTicketInput {
    readonly waveId: string;
    readonly taskId: string;
    readonly surfaceKind: WaveBrokerSurfaceKind;
    readonly surfaceFamily: string;
    readonly payloadDigest: string;
    readonly now?: string;
}
export interface WaveBrokerTicket {
    readonly schemaId: 'atm.waveBrokerTicket.v1';
    readonly ticketId: string;
    readonly idempotencyKey: string;
    readonly waveId: string;
    readonly taskId: string;
    readonly surfaceKind: WaveBrokerSurfaceKind;
    readonly surfaceFamily: string;
    readonly payloadDigest: string;
    readonly state: WaveBrokerTicketState;
    readonly enqueuedAt: string;
    readonly updatedAt: string;
}
export interface WaveBrokerSchedulerDocument {
    readonly schemaId: 'atm.waveBrokerScheduler.v1';
    readonly specVersion: '0.1.0';
    readonly tickets: readonly WaveBrokerTicket[];
    readonly updatedAt: string;
}
export interface WaveBrokerBatchDecision {
    readonly schemaId: 'atm.waveBrokerBatchDecision.v1';
    readonly verdict: 'batch-ready' | 'serial-fallback' | 'waiting' | 'empty';
    readonly waveId: string | null;
    readonly surfaceFamily: string | null;
    readonly surfaceKind: WaveBrokerSurfaceKind | null;
    readonly ticketIds: readonly string[];
    readonly missingTaskIds: readonly string[];
    readonly waitedMs: number;
    readonly reason: string;
}
export declare function createEmptyWaveBrokerSchedulerDocument(now?: string): WaveBrokerSchedulerDocument;
export declare function createWaveBrokerTicket(input: WaveBrokerTicketInput): WaveBrokerTicket;
export declare function enqueueWaveBrokerTicket(document: WaveBrokerSchedulerDocument, input: WaveBrokerTicketInput): {
    readonly document: WaveBrokerSchedulerDocument;
    readonly ticket: WaveBrokerTicket;
    readonly replayed: boolean;
};
export declare function transitionWaveBrokerTicket(ticket: WaveBrokerTicket, to: WaveBrokerTicketState, now?: string): WaveBrokerTicket;
export declare function planWaveBrokerBatch(input: {
    readonly document: WaveBrokerSchedulerDocument;
    readonly waveId?: string | null;
    readonly surfaceKind?: WaveBrokerSurfaceKind | null;
    readonly surfaceFamily?: string | null;
    readonly expectedTaskIds?: readonly string[];
    readonly collectionTimeoutMs?: number;
    readonly now?: string;
}): WaveBrokerBatchDecision;
