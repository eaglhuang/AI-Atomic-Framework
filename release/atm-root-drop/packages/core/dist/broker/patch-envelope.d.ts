export type PatchEnvelopeMode = 'metadata-only' | 'textual-diff';
export type PatchEnvelopeWipState = 'partial' | 'complete';
export interface PatchEnvelope {
    readonly schemaId: 'atm.patchEnvelope.v1';
    readonly specVersion: '0.1.0';
    readonly envelopeId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly mode: PatchEnvelopeMode;
    readonly wipState: PatchEnvelopeWipState;
    readonly snapshotDir: string;
    readonly targetFiles: readonly string[];
    readonly patchText: string | null;
    readonly metadata: {
        readonly freezeId: string;
        readonly capturedAt: string;
        readonly confidence: 'low' | 'medium' | 'high';
        readonly partialReason: string | null;
    };
}
export declare function createPatchEnvelope(input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly freezeId: string;
    readonly snapshotDir?: string;
    readonly targetFiles?: readonly string[];
    readonly patchText?: string | null;
    readonly wipState?: PatchEnvelopeWipState;
    readonly confidence?: 'low' | 'medium' | 'high';
    readonly partialReason?: string | null;
    readonly capturedAt?: string;
}): PatchEnvelope;
export declare function isMetadataOnlyEnvelope(envelope: PatchEnvelope): boolean;
export interface PatchEnvelopeSummary {
    readonly envelopeId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly freezeId: string;
    readonly mode: PatchEnvelopeMode;
    readonly wipState: PatchEnvelopeWipState;
    readonly confidence: 'low' | 'medium' | 'high';
    readonly fileCount: number;
    readonly hasPatchText: boolean;
    readonly capturedAt: string;
}
export interface PatchEnvelopeDivergence {
    readonly field: string;
    readonly left: unknown;
    readonly right: unknown;
}
export declare function summarizePatchEnvelope(envelope: PatchEnvelope): PatchEnvelopeSummary;
export declare function comparePatchEnvelopes(left: PatchEnvelope, right: PatchEnvelope): {
    readonly equal: boolean;
    readonly divergences: readonly PatchEnvelopeDivergence[];
};
export declare function validatePatchEnvelope(envelope: PatchEnvelope): {
    readonly ok: boolean;
    readonly reason: string;
};
