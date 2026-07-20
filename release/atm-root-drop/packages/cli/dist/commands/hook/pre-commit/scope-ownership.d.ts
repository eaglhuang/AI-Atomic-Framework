import { readActiveTaskDirectionLocks } from '../../task-direction.ts';
interface SameFileClaimOwnershipFinding {
    readonly code: 'ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS' | 'ATM_PRE_COMMIT_CLOSEOUT_ONLY_CLAIM_MUTATION';
    readonly file: string;
    readonly committingTaskId: string | null;
    readonly writeClaimTaskIds: readonly string[];
    readonly detail: string;
    readonly requiredCommand: string | null;
}
interface SameFileClaimOwnershipReport {
    readonly ok: boolean;
    readonly committingTaskId: string | null;
    readonly committingClaimIntent: string | null;
    readonly multiClaimFiles: readonly {
        readonly file: string;
        readonly writeClaimTaskIds: readonly string[];
    }[];
    readonly stewardCoveredFiles: readonly string[];
    readonly findings: readonly SameFileClaimOwnershipFinding[];
}
export declare function inspectSameFileClaimOwnership(input: {
    readonly cwd: string;
    readonly stagedFiles: readonly string[];
    readonly activeDirectionLocks: ReturnType<typeof readActiveTaskDirectionLocks>;
    readonly exemptAllowedFileSets: readonly (readonly string[])[];
}): SameFileClaimOwnershipReport;
export declare function selectRelevantDirectionLocksForCommit(input: {
    readonly activeDirectionLocks: ReturnType<typeof readActiveTaskDirectionLocks>;
    readonly stagedFiles: readonly string[];
    readonly committingTaskId: string | null;
    readonly taskGovernedCommitAllowedFiles: readonly string[];
    readonly closeCommitWindowAllowedFiles: readonly string[];
    readonly closeCommitWindowPlanningMirrorFiles: readonly string[];
}): ReturnType<typeof readActiveTaskDirectionLocks>;
export declare function isTaskDirectionPreCommitExempt(value: string): boolean;
export declare function collectStagedBatchCheckpointScopeFiles(cwd: string, stagedFiles: readonly string[]): readonly string[];
export declare function collectFrameworkTempClaimAllowedFiles(cwd: string): readonly string[];
export declare function collectCloseCommitWindowPlanningMirrorFiles(cwd: string): readonly string[];
export declare function collectTaskGovernedCommitAllowedFiles(cwd: string, taskId: string | null): readonly string[];
export declare function isPlainObject(value: unknown): value is Record<string, unknown>;
export {};
