import { type GitDiffMutationRequestEnvelope, type GitDiffMutationRequestOptions } from '../../../core/src/git/index.ts';
export interface AtmPrePushHookManifest {
    readonly schemaId: 'atm.gitPrePushHookInstall.v1';
    readonly specVersion: '0.1.0';
    readonly repoRoot: string;
    readonly hookPath: string;
    readonly backupPath: string | null;
    readonly outputJsonPath: string;
    readonly installedAt: string;
}
export interface AtmPrePushHookInstallReport {
    readonly ok: boolean;
    readonly hookPath: string;
    readonly backupPath: string | null;
    readonly manifestPath: string;
    readonly outputJsonPath: string;
    readonly manualInstall: readonly string[];
    readonly alreadyInstalled: boolean;
    readonly restoredPreviousHookPossible: boolean;
    readonly scriptPreview: string;
}
export interface AtmPrePushHookVerifyReport {
    readonly ok: boolean;
    readonly hookPath: string;
    readonly manifestPath: string;
    readonly outputJsonPath: string;
    readonly installed: boolean;
    readonly markerPresent: boolean;
    readonly delegatesToAtmCli: boolean;
    readonly summaryProjectionEnabled: boolean;
    readonly outputJsonConfigured: boolean;
    readonly manualInstall: readonly string[];
}
export interface AtmPrePushHookUninstallReport {
    readonly ok: boolean;
    readonly hookPath: string;
    readonly manifestPath: string;
    readonly backupPath: string | null;
    readonly restoredBackup: boolean;
    readonly removedAtmHook: boolean;
    readonly reason: string | null;
}
export declare function resolveGitDiffMutationRequests(options: GitDiffMutationRequestOptions): GitDiffMutationRequestEnvelope;
export declare function installAtmPrePushHook(cwd: string, options?: {
    dryRun?: boolean;
    force?: boolean;
}): AtmPrePushHookInstallReport;
export declare function verifyAtmPrePushHook(cwd: string): AtmPrePushHookVerifyReport;
export declare function uninstallAtmPrePushHook(cwd: string, options?: {
    dryRun?: boolean;
}): AtmPrePushHookUninstallReport;
