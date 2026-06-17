import type { WaveExecutionState } from './team-wave-envelope.ts';
export interface WaveEvidenceMember {
    readonly taskId: string;
    readonly scopePaths: readonly string[];
    readonly deliverables: readonly string[];
}
export interface WaveEvidenceInput {
    readonly members: readonly WaveEvidenceMember[];
    /** All files changed across the wave (e.g. a combined git diff name list). */
    readonly changedFiles: readonly string[];
    /** Files known to be shared/append-safe; attributed to every owning member, never ambiguous. */
    readonly appendSafePaths?: readonly string[];
}
export interface TaskEvidenceSlice {
    readonly taskId: string;
    readonly attributedFiles: readonly string[];
}
export interface WaveEvidenceResult {
    readonly schemaId: 'atm.teamWaveEvidence.v1';
    readonly slices: readonly TaskEvidenceSlice[];
    /** Files matching no member's scope. */
    readonly unattributed: readonly string[];
    /** Files matching more than one member's scope (excluding append-safe). */
    readonly ambiguous: readonly {
        readonly file: string;
        readonly taskIds: readonly string[];
    }[];
    /** Wave-level execution state for evidence purposes. */
    readonly state: Extract<WaveExecutionState, 'done' | 'needs-review'>;
}
/**
 * Slice a wave diff into per-task evidence. The result is `done` only when every
 * changed file is attributed to exactly one member (append-safe files excepted);
 * otherwise the wave is `needs-review` and callers must not checkpoint any member
 * as done from this evidence.
 */
export declare function sliceWaveEvidence(input: WaveEvidenceInput): WaveEvidenceResult;
