import { type TeamWorkerReport } from '../broker/team-worker-report.js';
import type { WaveManifest } from '../broker/wave-manifest.js';
import { type RestrictedExecutionAdapterCapability, type RestrictedExecutionEvaluation } from './restricted-execution-gateway.js';
export type TeamWorkerExecutorResultState = 'executing' | 'ready-for-write' | 'needs-review' | 'serial-fallback';
export type TeamWorkerLifecycleEventKind = 'worker.start' | 'worker.heartbeat' | 'worker.report' | 'worker.retry' | 'worker.defer' | 'worker.needs-review';
export interface TeamWorkerExecutionLane {
    readonly taskId: string;
    readonly laneSessionId: string;
    readonly workerCanCommitOrClose: false;
    readonly allowedReturnSchemas: readonly ['atm.patchEnvelope.v1', 'atm.teamWorkerReport.v1'];
    readonly heartbeat: {
        readonly status: 'started' | 'reported' | 'missing-report';
        readonly startedAt: string;
        readonly heartbeatAt: string;
        readonly reportId: string | null;
        readonly tokenUsageSource: 'provider' | 'editor' | 'manual' | 'unavailable';
    };
    readonly lifecycleEvents: readonly TeamWorkerLifecycleEventKind[];
}
export interface TeamWorkerOutOfScopeFinding {
    readonly taskId: string;
    readonly files: readonly string[];
}
export interface TeamWorkerExecutorTelemetrySummary {
    readonly schemaId: 'atm.teamWorkerLifecycleTelemetrySummary.v1';
    readonly waveId: string;
    readonly checkId: 'team.worker-lifecycle';
    readonly missingWorkerReports: readonly string[];
    readonly invalidWorkerReports: readonly {
        readonly taskId: string;
        readonly reason: string;
    }[];
    readonly outOfScopeFindings: readonly TeamWorkerOutOfScopeFinding[];
    readonly deferredTaskIds: readonly string[];
    readonly acceptedTaskIds: readonly string[];
    readonly sourceAvailability: Record<string, 'available' | 'unavailable'>;
}
export interface TeamWorkerExecutionRuntime {
    readonly schemaId: 'atm.teamWorkerExecutionRuntime.v1';
    readonly specVersion: '0.1.0';
    readonly waveId: string;
    readonly batchId: string;
    readonly executor: WaveManifest['executor'];
    readonly coordinatorActorId: string;
    readonly taskIds: readonly string[];
    readonly lanes: readonly TeamWorkerExecutionLane[];
    readonly workerReports: readonly TeamWorkerReport[];
    readonly acceptedTaskIds: readonly string[];
    readonly deferredTaskIds: readonly string[];
    readonly missingWorkerReports: readonly string[];
    readonly invalidWorkerReports: readonly {
        readonly taskId: string;
        readonly reason: string;
    }[];
    readonly outOfScopeFindings: readonly TeamWorkerOutOfScopeFinding[];
    readonly resultState: TeamWorkerExecutorResultState;
    readonly writesPerformed: false;
    readonly telemetrySummary: TeamWorkerExecutorTelemetrySummary;
    readonly createdAt: string;
}
/**
 * Adapter A of the RestrictedExecutionGateway.
 *
 * External workers hold no ambient mutation capability. They may *request* a
 * structured action; the process is launched only if the gateway admits it for
 * the lane's own task and lane session. The lane supplies the authority, so a
 * worker cannot fabricate one by naming a different task in its request.
 */
export declare function evaluateTeamWorkerExecutionRequest(input: {
    readonly lane: Pick<TeamWorkerExecutionLane, 'taskId' | 'laneSessionId'>;
    readonly actorId: string | null;
    readonly executable: string;
    readonly argv?: readonly string[];
    readonly cwd?: string | null;
    readonly declaredOutputs?: readonly string[];
    readonly adapterCapability?: RestrictedExecutionAdapterCapability;
    readonly now?: string;
}): RestrictedExecutionEvaluation;
export declare function buildTeamWorkerExecutionRuntime(input: {
    readonly manifest: WaveManifest;
    readonly workerReports?: readonly TeamWorkerReport[];
    readonly now?: string;
}): TeamWorkerExecutionRuntime;
