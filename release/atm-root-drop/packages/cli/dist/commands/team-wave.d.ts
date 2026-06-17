import { type WavePlan } from '../../../core/src/broker/team-wave-planner.ts';
import { type WaveAdmissionDecision } from '../../../core/src/broker/team-wave-admission.ts';
import { type TeamWaveEnvelope } from '../../../core/src/broker/team-wave-envelope.ts';
/**
 * Build a wave plan for an explicit set of task ids, reading their declared
 * metadata from the ledger. Append-safe paths default to the coverage map,
 * which uses an owner-shard / union-merge strategy.
 */
export declare function buildWavePlanFromTaskIds(cwd: string, taskIds: readonly string[], appendSafePaths?: readonly string[]): {
    readonly plan: WavePlan;
    readonly missing: readonly string[];
};
export type WaveRole = 'coordinator' | 'worker' | 'validator' | 'reviewer';
export type WavePrivilegedAction = 'git-write' | 'task-closeout' | 'checkpoint';
export interface CoordinatorGuardResult {
    readonly allowed: boolean;
    readonly reason: string;
}
export declare function assertCoordinatorOnly(role: WaveRole, action: WavePrivilegedAction): CoordinatorGuardResult;
/**
 * Build admission decision + per-wave envelopes for the first planned wave.
 * TASK-MAO-0027: this is the dispatch surface that turns a metadata wave plan
 * into a coordinator-owned runtime record. Lifecycle authority remains with
 * batch checkpoint / taskflow close — this only records intent.
 */
export declare function buildWaveRuntimeRecord(cwd: string, taskIds: readonly string[], coordinatorActorId: string): {
    readonly plan: WavePlan;
    readonly admission: WaveAdmissionDecision;
    readonly envelope: TeamWaveEnvelope | null;
    readonly missing: readonly string[];
};
/**
 * Handle `team wave <plan|dispatch> <csv>`. Delegated to from the `team` command
 * so no new top-level command registration is required.
 */
export declare function runTeamWave(argv: readonly string[], cwd: string): import("./shared.ts").CommandResult;
