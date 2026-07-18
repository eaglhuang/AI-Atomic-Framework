import { createTeamShadowWorkspaceProviderPlan } from './team/shadow-workspace.ts';
import { type BatchRunRecord } from './work-channels.ts';
import { type WavePlan } from '../../../core/src/broker/team-wave-planner.ts';
import { type WaveAdmissionDecision } from '../../../core/src/broker/team-wave-admission.ts';
import { type TeamWaveEnvelope } from '../../../core/src/broker/team-wave-envelope.ts';
import { type WaveManifest } from '../../../core/src/broker/wave-manifest.ts';
import { type TeamWorkerReport } from '../../../core/src/broker/team-worker-report.ts';
/**
 * Build a wave plan for an explicit set of task ids, reading their declared
 * metadata from the ledger. Append-safe paths default to the coverage map,
 * which uses an owner-shard / union-merge strategy.
 */
export declare function buildWavePlanFromTaskIds(cwd: string, taskIds: readonly string[], appendSafePaths?: readonly string[]): {
    readonly plan: WavePlan;
    readonly missing: readonly string[];
};
type WaveExecutor = 'auto' | 'local-lanes' | 'editor-subagents' | 'team-agents' | 'manual';
export interface TeamWaveRuntimeLane {
    readonly taskId: string;
    readonly laneSessionId: string;
    readonly workspace: ReturnType<typeof createTeamShadowWorkspaceProviderPlan>;
    readonly workerCanCommitOrClose: false;
    readonly allowedReturnSchemas: readonly ['atm.patchEnvelope.v1', 'atm.teamWorkerReport.v1'];
}
export interface TeamWaveRuntimeRecord {
    readonly schemaId: 'atm.teamWaveRuntime.v1';
    readonly specVersion: '0.1.0';
    readonly waveId: string;
    readonly batchId: string;
    readonly executor: WaveExecutor;
    readonly coordinatorActorId: string;
    readonly taskIds: readonly string[];
    readonly manifest: WaveManifest;
    readonly lanes: readonly TeamWaveRuntimeLane[];
    readonly workerReports: readonly TeamWorkerReport[];
    readonly acceptedTaskIds: readonly string[];
    readonly deferredTaskIds: readonly string[];
    readonly outOfScopeFindings: readonly {
        readonly taskId: string;
        readonly files: readonly string[];
    }[];
    readonly resultState: 'ready-for-write' | 'needs-review' | 'serial-fallback';
    readonly writesPerformed: false;
    readonly createdAt: string;
}
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
export declare function buildManifestRuntimeRecordFromBatch(input: {
    readonly cwd: string;
    readonly batchId: string;
    readonly waveId: string;
    readonly executor: WaveExecutor;
    readonly coordinatorActorId: string;
    readonly workerReports?: readonly TeamWorkerReport[];
    readonly now?: string;
}): {
    readonly ok: boolean;
    readonly runtime: TeamWaveRuntimeRecord | null;
    readonly reason: string | null;
    readonly batchRun: BatchRunRecord | null;
};
/**
 * Handle `team wave <plan|dispatch> <csv>`. Delegated to from the `team` command
 * so no new top-level command registration is required.
 */
export declare function runTeamWave(argv: readonly string[], cwd: string): import("./shared.ts").CommandResult;
export {};
