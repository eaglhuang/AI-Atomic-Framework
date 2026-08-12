import type { TeamBrokerLaneEvidence } from '../../../../../core/src/broker/team-lane.ts';
import { inspectTeamRuntimeBackendCapabilities } from '../../integration.ts';
import type { TeamRuntimeContract } from './types.ts';
export declare function buildBrokerConflictSharedVocabulary(brokerLane: TeamBrokerLaneEvidence): {
    decisionClass: string;
    decisionReason: string;
    violationStatus: string;
    statusCode: string;
} | null;
export declare function evaluateTeamRuntimeBackendAdmission(runtimeContract: TeamRuntimeContract, readiness: ReturnType<typeof inspectTeamRuntimeBackendCapabilities>): {
    ok: boolean;
    reason: string;
};
export declare function buildBrokerConflictUxProjection(input: {
    readonly primaryTaskId: string;
    readonly conflictingTaskIds: readonly string[];
    readonly sharedPaths?: readonly string[];
    readonly overlappingAtomIds?: readonly string[];
    readonly decisionClass: string;
    readonly decisionReason: string;
    readonly violationStatus: string;
    readonly statusCode?: string;
    readonly currentAllowedTaskId?: string | null;
    readonly blockedTaskIds?: readonly string[];
    readonly requiredCommand?: string | null;
}): {
    schemaId: string;
    playbookSlice: string;
    requiredResolutionArtifact: string;
    decisionClass: string;
    decisionReason: string;
    violationStatus: string;
    statusCode: string;
    primaryTaskId: string;
    conflictingTaskIds: string[];
    blockedTaskIds: string[];
    currentAllowedTaskId: string;
    sharedPaths: string[];
    overlappingAtomIds: string[];
    nextSafeResolutionCommand: string;
    captainGuidance: string[];
};
export declare function runTeamBroker(argv: string[], defaultCwd: string): import("../../shared.ts").CommandResult;
export declare function runTeamObservability(argv: string[], defaultCwd: string): import("../../shared.ts").CommandResult;
export declare function runTeamBrokerConflictResolve(argv: string[], defaultCwd: string): import("../../shared.ts").CommandResult;
