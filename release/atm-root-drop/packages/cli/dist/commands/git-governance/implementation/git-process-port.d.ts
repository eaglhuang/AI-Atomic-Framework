type LegacyValue = ReturnType<typeof JSON.parse>;
export declare function resolveGitExecutable(): string;
export declare const DEFAULT_GIT_COMMIT_TIMEOUT_MS = 420000;
export declare function resolveGitCommitTimeoutMs(explicitTimeoutMs: LegacyValue): any;
export declare function gitCommitAttemptStatusRelativePath(actorId: LegacyValue, taskId: LegacyValue): string;
export declare function writeGitCommitAttemptStatus(cwd: LegacyValue, statusRelativePath: LegacyValue, status: LegacyValue): void;
export declare function readGitCommitAttemptStatus(cwd: LegacyValue, actorId: LegacyValue, taskId: LegacyValue): any;
export declare function runGitCommand(cwd: LegacyValue, args: LegacyValue, stdio?: LegacyValue): string;
export declare function runGitCommandWithEnv(cwd: LegacyValue, args: LegacyValue, env: LegacyValue, stdio?: LegacyValue): string;
export declare function inspectStdinPathspecGitAddProcesses(): ({
    pid: any;
    commandLine: any;
} | null)[];
export declare function isStdinPathspecGitAddProcess(processInfo: LegacyValue): any;
export declare function assertNoStdinPathspecGitAddPreflight(cwd: LegacyValue): void;
export declare function stageTrackedActorRegistryIfNeeded(cwd: LegacyValue): ".atm/catalog/registry/actors.json" | null;
export declare function listCommitAttributionSideEffectPaths(cwd: LegacyValue): string[];
export declare function isCommitAttributionSideEffectPath(filePath: LegacyValue): boolean;
export declare function createSanitizedGitEnv(extra?: LegacyValue): NodeJS.ProcessEnv;
/**
 * Keeps Git hook interpreter discovery available after ATM has removed
 * repository-selection variables. Git for Windows executes shebang hooks
 * through `/usr/bin/env`; its `usr/bin` directory is therefore a runtime
 * dependency of Git itself, not an inherited shell capability.
 */
export declare function addTrustedGitHookRuntimePath(env: NodeJS.ProcessEnv, options?: {
    readonly platform?: NodeJS.Platform;
    readonly gitExecutable?: string;
    readonly pathExists?: (candidate: string) => boolean;
}): NodeJS.ProcessEnv;
export declare function shouldStageGovernedGitHeadEvidenceBeforeCommit(stagedFiles: LegacyValue): any;
export declare function isRuntimeCommitSideEffect(filePath: LegacyValue): boolean;
export declare function isIgnorableTaskScopedDirtySideEffect(filePath: LegacyValue): boolean;
export {};
