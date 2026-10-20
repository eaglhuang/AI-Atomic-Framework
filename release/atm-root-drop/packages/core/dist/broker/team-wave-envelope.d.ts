export type WaveExecutionState = 'done' | 'partial' | 'blocked' | 'not-started' | 'needs-review';
export interface TeamWaveMemberEnvelope {
    readonly taskId: string;
    readonly workerActorId: string | null;
    readonly scopePaths: readonly string[];
    readonly deliverables: readonly string[];
    /** Reference to the worker's patch envelope (atm.patchEnvelope.v1) id, if captured. */
    readonly patchEnvelopeId: string | null;
    readonly executionState?: WaveExecutionState;
}
export interface TeamWaveEnvelope {
    readonly schemaId: 'atm.teamWaveEnvelope.v1';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly waveId: string;
    readonly coordinatorActorId: string;
    readonly targetRepo: string | null;
    readonly closureAuthority: string | null;
    readonly members: readonly TeamWaveMemberEnvelope[];
    readonly metadata: {
        readonly plannedAt: string;
        readonly waveIndex: number;
        readonly appendSafePaths?: readonly string[];
        readonly notes?: string | null;
    };
}
export declare function createTeamWaveEnvelope(input: {
    readonly waveId?: string;
    readonly coordinatorActorId: string;
    readonly targetRepo: string | null;
    readonly closureAuthority: string | null;
    readonly waveIndex: number;
    readonly members: readonly TeamWaveMemberEnvelope[];
    readonly appendSafePaths?: readonly string[];
    readonly plannedAt?: string;
    readonly notes?: string | null;
}): TeamWaveEnvelope;
export interface TeamWaveEnvelopeValidation {
    readonly ok: boolean;
    readonly reason: string;
}
/**
 * Structural validation beyond the JSON schema: enforces the cross-field
 * invariants from the spec — single target repo, single closure authority, and
 * disjoint declared deliverables across members (spec §5 rules 5, 6, 2/7).
 */
export declare function validateTeamWaveEnvelope(envelope: TeamWaveEnvelope): TeamWaveEnvelopeValidation;
/** Members whose execution state allows close-input preparation (spec §7). */
export declare function closeReadyMembers(envelope: TeamWaveEnvelope): readonly TeamWaveMemberEnvelope[];
