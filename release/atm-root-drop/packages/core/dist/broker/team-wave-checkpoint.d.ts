import type { WaveExecutionState } from './team-wave-envelope.ts';
import { type TeamWorkerReport } from './team-worker-report.ts';
import type { WaveEvidenceResult } from './team-wave-evidence.ts';
export interface WaveCheckpointMember {
    readonly taskId: string;
    readonly report: TeamWorkerReport | null;
}
export interface WaveCheckpointInput {
    readonly members: readonly WaveCheckpointMember[];
    readonly evidence: WaveEvidenceResult;
}
export interface MemberCheckpoint {
    readonly taskId: string;
    readonly state: WaveExecutionState;
    readonly closeReady: boolean;
    readonly reason: string;
}
export interface WaveCheckpointResult {
    readonly schemaId: 'atm.teamWaveCheckpoint.v1';
    readonly members: readonly MemberCheckpoint[];
    /** Task ids whose close input the coordinator may prepare. */
    readonly closeReadyTaskIds: readonly string[];
    /** True when the whole wave's evidence sliced cleanly. */
    readonly evidenceClean: boolean;
}
/**
 * Resolve each member's checkpoint state. The wave evidence gate is authoritative:
 * if the slice is `needs-review`, NO member is close-ready regardless of its own
 * report (spec §7 — ambiguous attribution blocks the whole wave). Otherwise a
 * member is close-ready only when its reconciled worker state is `done`.
 */
export declare function checkpointWave(input: WaveCheckpointInput): WaveCheckpointResult;
