export type GitWorktreeReadinessStatus = 'ready' | 'not-git' | 'bare-worktree-mismatch' | 'bare-repository' | 'git-error';
export interface GitWorktreeReadinessReport {
    readonly ok: boolean;
    readonly status: GitWorktreeReadinessStatus;
    readonly cwd: string;
    readonly worktreeRoot: string | null;
    readonly gitDir: string | null;
    readonly isBareRepository: boolean | null;
    readonly isInsideWorkTree: boolean | null;
    readonly reason: string | null;
    readonly localConfigLikely: boolean;
    readonly recommendedFixCommand: string | null;
}
export declare function inspectGitWorktreeReadiness(cwd: string): GitWorktreeReadinessReport;
