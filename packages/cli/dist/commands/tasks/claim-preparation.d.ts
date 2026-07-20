import type { TaskImportRecord } from './result-contracts.ts';
export interface TaskClaimPreparationStep {
    readonly action: 'reserve' | 'promote';
    readonly status: 'reserved' | 'ready';
    readonly transitionPath: string;
    readonly importEvidencePath?: string | null;
}
export interface TaskClaimPreparationResult {
    readonly taskId: string;
    readonly originalStatus: string;
    readonly finalStatus: string;
    readonly steps: readonly TaskClaimPreparationStep[];
}
export interface ClaimPreparationDependencies {
    readonly parseSingleCard: (input: {
        readonly planText: string;
        readonly planRelativePath: string;
        readonly importedAt: string;
    }) => TaskImportRecord | null;
    readonly writeTaskFiles: (input: {
        readonly cwd: string;
        readonly tasks: readonly TaskImportRecord[];
        readonly force: boolean;
        readonly forceOverwriteClaims: boolean;
        readonly resetOpen: boolean;
        readonly reopen: boolean;
    }) => {
        readonly diagnostics: readonly {
            readonly level: string;
        }[];
        readonly writtenPaths: readonly string[];
    };
    readonly writeImportEvidence: (input: {
        readonly cwd: string;
        readonly tasks: readonly TaskImportRecord[];
        readonly planPath: string;
        readonly generatedAt: string;
        readonly writtenPaths: readonly string[];
    }) => string | null;
}
export declare function prepareTaskForClaim(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly status: unknown;
    readonly title?: string | null;
    readonly transitionCommand?: string | null;
} & ClaimPreparationDependencies): TaskClaimPreparationResult;
