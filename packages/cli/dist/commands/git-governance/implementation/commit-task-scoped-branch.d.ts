import { makeResult } from '../../shared.ts';
type LegacyValue = ReturnType<typeof JSON.parse>;
export type TaskScopedBranchOutcome = {
    readonly kind: 'preview';
    readonly result: ReturnType<typeof makeResult>;
} | {
    readonly kind: 'resolved';
    readonly taskScopedBundleReport: LegacyValue;
    readonly deferredForeignStagedSnapshotPath: LegacyValue;
};
export declare function routeTaskScopedCommitBranch(input: {
    readonly options: LegacyValue;
    readonly actorId: string;
    readonly taskDocument: LegacyValue;
    readonly claim: LegacyValue;
    readonly session: LegacyValue;
    readonly claimForTrailers: LegacyValue;
    readonly laneSessionId: string | null;
}): TaskScopedBranchOutcome;
export {};
