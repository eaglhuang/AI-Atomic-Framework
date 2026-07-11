import { readActiveTaskDirectionLocks } from '../task-direction.ts';
export { isAncestorCommit, isCommitAcceptedByLegacyBaseline, readFrameworkCommitRangeBaseline } from './commit-range-guard.ts';
interface ParsedHookArgs {
    readonly cwd: string;
    readonly action: 'pre-commit' | 'pre-push';
    readonly base: string | null;
    readonly head: string | null;
}
interface PushBaseResolution {
    readonly base: string | null;
    readonly source: 'argument' | 'upstream' | 'head-parent' | 'unresolved';
    readonly upstreamRef: string | null;
    readonly currentBranch: string | null;
}
export interface CommandRunReport {
    readonly command: string;
    readonly cwd: string;
    readonly exitCode: number;
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
    readonly stdoutPreview: string;
    readonly stderrPreview: string;
}
interface ValidatorRunTriage {
    readonly blockingRuns: readonly CommandRunReport[];
    readonly advisoryFindings: readonly PreCommitAdvisoryFinding[];
}
export interface PreCommitAdvisoryFinding {
    readonly code: string;
    readonly source: string;
    readonly detail: string;
    readonly file?: string;
    readonly files?: readonly string[];
    readonly scope: 'tree-wide';
    readonly taskId?: string;
    readonly classification?: 'tree-wide-advisory';
    readonly data?: unknown;
}
interface PrePushRefUpdate {
    readonly localRef: string;
    readonly localSha: string;
    readonly remoteRef: string;
    readonly remoteSha: string;
    readonly remoteBranch: string | null;
}
export declare function runPrePushHook(cwd: string, base: string | null, head: string | null): import("../shared.ts").CommandResult;
export declare function runRequiredFrameworkValidators(cwd: string, requiredGates: readonly string[]): readonly CommandRunReport[];
export declare function triageForeignTaskflowValidatorRuns(input: {
    cwd: string;
    stagedFiles: readonly string[];
    activeDirectionLocks: ReturnType<typeof readActiveTaskDirectionLocks>;
    failedRuns: readonly CommandRunReport[];
}): ValidatorRunTriage;
export declare function runCommandForReport(cwd: string, command: string, args: readonly string[]): CommandRunReport;
export declare function runShellCommandForReport(cwd: string, commandLine: string): CommandRunReport;
export declare function resolvePushBase(cwd: string, explicitBase: string | null): PushBaseResolution;
export declare function readPrePushRefUpdates(): readonly PrePushRefUpdate[];
export declare function parseHookArgs(argv: string[]): ParsedHookArgs;
