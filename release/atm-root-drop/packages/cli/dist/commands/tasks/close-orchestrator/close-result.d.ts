export declare function makeTasksClosedResult(input: {
    readonly options: any;
    readonly actorId: string;
    readonly taskPath: string;
    readonly evidenceGate: unknown;
    readonly closurePacketPath: string | null;
    readonly transitionPath: string;
    readonly closeCommitWindowPathFromClose: string | null;
    readonly closeArtifactFiles: readonly string[];
    readonly deliverableGate: unknown;
    readonly cleanedTeamRuns: unknown;
    readonly closeScopedDiffIsolation: unknown;
    readonly emergencyUse: unknown;
    readonly protectedOverrideOutcome: unknown;
    readonly failedEmergencyAuditPath: string | null;
    readonly taskQueue: unknown;
    readonly historicalBatchSlice: unknown;
}): import("../../shared.ts").CommandResult;
