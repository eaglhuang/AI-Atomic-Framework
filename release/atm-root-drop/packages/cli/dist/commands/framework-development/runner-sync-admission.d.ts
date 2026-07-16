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
        readonly waitingTasks: readonly string[];
        readonly ownerActorIds: readonly string[];
        readonly reason: string | null;
    };
    readonly foreignNonReleaseWip: readonly string[];
    readonly releaseWip: readonly string[];
    readonly ordinaryTaskReleaseAutoStageAllowed: false;
    readonly requiredCommand: string | null;
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
}): RunnerSyncAdmissionReport;
export declare function assertRunnerSyncAdmission(report: RunnerSyncAdmissionReport): void;
export declare function ordinaryTaskCanAutoStageRelease(input: {
    readonly taskId: string;
    readonly files: readonly string[];
}): false;
