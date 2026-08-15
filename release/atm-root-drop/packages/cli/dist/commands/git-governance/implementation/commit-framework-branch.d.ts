import { makeResult } from '../../shared.ts';
type LegacyValue = ReturnType<typeof JSON.parse>;
export type FrameworkBranchOutcome = {
    readonly kind: 'preview';
    readonly result: ReturnType<typeof makeResult>;
} | {
    readonly kind: 'staged';
    readonly autoStagedFrameworkPaths: readonly string[];
    readonly frameworkClaimCommitFiles: readonly string[];
};
export declare function routeFrameworkClaimCommitBranch(input: {
    readonly options: LegacyValue;
    readonly actorId: string;
    readonly usesFrameworkClaimCommit: boolean;
    readonly frameworkClaimFiles: readonly string[] | null;
}): FrameworkBranchOutcome;
export {};
