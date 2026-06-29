import { type MutationRequest } from '../broker/types.ts';
export interface GitDiffMutationRequestOptions {
    readonly cwd: string;
    readonly actorId: string;
    readonly taskId?: string | null;
    readonly branch?: string | null;
    readonly remote?: string | null;
    readonly fetch?: boolean;
    readonly gitExecutable?: string;
}
export interface GitBranchTopologySnapshot {
    readonly branch: string;
    readonly remote: string;
    readonly remoteRef: string;
    readonly headSha: string;
    readonly remoteSha: string;
    readonly mergeBaseSha: string;
    readonly fetched: boolean;
}
export type GitDiffChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechanged' | 'unmerged' | 'unknown';
export interface GitDiffEntry {
    readonly filePath: string;
    readonly previousFilePath: string | null;
    readonly status: GitDiffChangeKind;
    readonly rawStatus: string;
    readonly similarityScore: number | null;
}
export interface GitDiffMutationRequestEnvelope {
    readonly topology: GitBranchTopologySnapshot;
    readonly localRequests: readonly MutationRequest[];
    readonly remoteRequests: readonly MutationRequest[];
    readonly localDiff: readonly GitDiffEntry[];
    readonly remoteDiff: readonly GitDiffEntry[];
}
export declare function collectGitDiffMutationRequests(input: GitDiffMutationRequestOptions): GitDiffMutationRequestEnvelope;
export declare function buildGitDiffMutationRequests(input: {
    readonly actorId: string;
    readonly taskId?: string | null;
    readonly topology: GitBranchTopologySnapshot;
    readonly side: 'local' | 'remote';
    readonly entries: readonly GitDiffEntry[];
}): readonly MutationRequest[];
export declare function parseGitNameStatusZ(output: string): readonly GitDiffEntry[];
