type LegacyValue = ReturnType<typeof JSON.parse>;
export interface CommitCandidatePreparation {
    readonly scopedCommitFiles: LegacyValue;
    readonly stagedCommitSurface: LegacyValue;
    readonly preStagedEvidence: LegacyValue;
}
export declare function prepareCommitCandidate(input: LegacyValue): CommitCandidatePreparation;
export declare function assertGovernedCommitPhysicalLineBudget(cwd: LegacyValue, files: LegacyValue, actorId: LegacyValue, taskId: LegacyValue): void;
export {};
