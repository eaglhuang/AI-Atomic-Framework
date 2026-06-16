import type { BrokerDecision, MergeVerdict, MutationRequest, BrokerOperationRunRecord, BrokerOperationRunRecordEnvelope } from './types.ts';
import type { WriteIntent } from './types.ts';
import type { VirtualAtomInUseRegistryDocument } from './registry.ts';
export declare const DEFAULT_TEAM_STEWARD_ID = "neutral-write-steward";
export declare const DEFAULT_BROKER_REGISTRY_RELATIVE_PATH = ".atm/runtime/write-broker.registry.json";
export type TeamBrokerChosenLane = 'direct-brokered' | 'deterministic-composer' | 'neutral-steward' | 'serial' | 'blocked';
export interface TeamBrokerLaneEvidence {
    readonly schemaId: 'atm.teamBrokerLaneEvidence.v1';
    readonly specVersion: '0.1.0';
    readonly taskId: string;
    readonly actorId: string;
    readonly registryPath: string;
    readonly writeIntent: WriteIntent;
    readonly decision: BrokerDecision;
    readonly virtualAtomInUseRegistry: VirtualAtomInUseRegistryDocument;
    readonly chosenLane: TeamBrokerChosenLane;
    readonly stewardId: string | null;
    readonly composerPath: string | null;
    readonly safeToStart: boolean;
    readonly blockedReasons: readonly string[];
}
export interface TeamBrokerLaneResult {
    readonly ok: boolean;
    readonly evidence: TeamBrokerLaneEvidence;
}
export interface TeamBrokerRuntimeActivationHandshakeEvidence {
    readonly schemaId: 'atm.teamBrokerRuntimeActivationHandshake.v1';
    readonly specVersion: '0.1.0';
    readonly taskId: string;
    readonly actorId: string;
    readonly registryPath: string;
    readonly brokerLane: TeamBrokerLaneEvidence;
    readonly activationState: 'activated' | 'blocked';
    readonly scopedWriteExecution: {
        readonly approved: boolean;
        readonly allowedFiles: readonly string[];
        readonly evidencePath: string | null;
        readonly acceptedInputs: readonly ['PatchProposal', 'MergePlan', 'StewardPlan'];
    };
    readonly runtimeBoundary: {
        readonly gitWrite: false;
        readonly taskLifecycle: false;
        readonly selfClose: false;
    };
    readonly blockedReasons: readonly string[];
}
export interface TeamBrokerRuntimeActivationHandshakeResult {
    readonly ok: boolean;
    readonly evidence: TeamBrokerRuntimeActivationHandshakeEvidence;
}
export interface TeamBrokerFinding {
    readonly level: 'error' | 'warning';
    readonly code: string;
    readonly detail: string;
    readonly paths?: string[];
}
export interface BrokerRunRecordInput {
    readonly runId: string;
    readonly planId: string;
    readonly request: MutationRequest;
    readonly adapterChoice: string;
    readonly laneDecision: string;
    readonly mergeVerdict: MergeVerdict;
    readonly evidencePath: string;
    readonly appliedFiles?: readonly string[];
}
export declare function buildTeamBrokerRunRecord(input: BrokerRunRecordInput): BrokerOperationRunRecord;
export declare function buildTeamBrokerRunRecordEnvelope(input: {
    readonly runId: string;
    readonly planId: string;
    readonly records: readonly BrokerOperationRunRecord[];
}): BrokerOperationRunRecordEnvelope;
export declare function buildTeamWriteIntent(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly task: unknown;
    readonly writePaths: readonly string[];
}): WriteIntent;
export declare function resolveTeamBrokerLane(decision: BrokerDecision): {
    readonly chosenLane: TeamBrokerChosenLane;
    readonly stewardId: string | null;
    readonly composerPath: string | null;
    readonly safeToStart: boolean;
    readonly blockedReasons: readonly string[];
};
export declare function evaluateTeamBrokerLane(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly task: unknown;
    readonly writePaths: readonly string[];
    readonly registryPath?: string;
}): TeamBrokerLaneResult;
export declare function buildTeamBrokerEvidence(result: TeamBrokerLaneResult): TeamBrokerLaneEvidence;
export declare function buildTeamBrokerRuntimeActivationHandshake(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly task: unknown;
    readonly writePaths: readonly string[];
    readonly registryPath?: string;
    readonly evidencePath?: string | null;
}): TeamBrokerRuntimeActivationHandshakeResult;
export declare function brokerLaneToFindings(result: TeamBrokerLaneResult): TeamBrokerFinding[];
