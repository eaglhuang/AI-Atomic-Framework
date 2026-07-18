export type RunnerSyncAdmissionReport = {
    readonly schemaId: 'atm.runnerSyncAdmission.v1';
    readonly ok: boolean;
    readonly stewardActorId: string;
    readonly sealedSourceSha: string | null;
    readonly runnerSyncSteward: {
        readonly stewardWorkId: string;
        readonly queuePosition: number;
        readonly suggestedNextAction: string;
    } | null;
    readonly queueHeadOwnership: {
        readonly ok: boolean;
        readonly stewardWorkId: string | null;
        readonly queuePosition: number | null;
        readonly queueHeadHealth: 'task-active' | 'task-missing' | 'task-terminal';
        readonly waitingTasks: readonly string[];
        readonly ownerActorIds: readonly string[];
        readonly reason: string | null;
        readonly cleanupCommand: string | null;
    };
    readonly foreignNonReleaseWip: readonly string[];
    readonly foreignBuildInputConflicts: readonly RunnerSyncForeignBuildInputConflict[];
    readonly releaseWip: readonly string[];
    readonly ordinaryTaskReleaseAutoStageAllowed: false;
    readonly requiredCommand: string | null;
};
export type RunnerSyncForeignBuildInputConflict = {
    readonly blockingTaskId: string;
    readonly blockingActorId: string | null;
    readonly blockingLaneSessionId: string | null;
    readonly heartbeatAt: string | null;
    readonly intersectingFiles: readonly string[];
    readonly dirtyIntersectingFiles: readonly string[];
    readonly landedIntersectingFiles: readonly string[];
    readonly reasonCode: 'landed-not-closed-build-input-risk';
};
export declare function inspectRunnerSyncAdmission(input: {
    readonly cwd: string;
    readonly stewardActorId: string;
    readonly sealedSourceSha?: string | null;
    readonly runnerSyncSteward?: {
        readonly stewardWorkId: string;
        readonly queuePosition: number;
        readonly suggestedNextAction: string;
    } | null;
    readonly dirtyFiles?: readonly string[] | null;
    readonly foreignClaims?: readonly RunnerSyncForeignClaimInput[] | null;
    readonly landedFiles?: readonly string[] | null;
}): RunnerSyncAdmissionReport;
export type RunnerSyncForeignClaimInput = {
    readonly taskId: string;
    readonly actorId?: string | null;
    readonly laneSessionId?: string | null;
    readonly heartbeatAt?: string | null;
    readonly claimedAt?: string | null;
    readonly files: readonly string[];
};
export declare function assertRunnerSyncAdmission(report: RunnerSyncAdmissionReport): void;
export declare function ordinaryTaskCanAutoStageRelease(input: {
    readonly taskId: string;
    readonly files: readonly string[];
}): false;
