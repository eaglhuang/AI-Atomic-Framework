import { detectFrameworkRepoIdentity, type FrameworkRepoIdentity } from '../framework-development.ts';
export declare const hookContractVersion: "atm.integration-hooks/v1";
export declare const hookProvider: "atm-framework-development-hooks/v1";
export declare const hookMarker: "ATM_INTEGRATION_HOOK_CONTRACT_V1";
export interface GitHookInspectionReport {
    readonly schemaId: 'atm.gitHooksInspection.v1';
    readonly generatedAt: string;
    readonly repoIdentity: ReturnType<typeof detectFrameworkRepoIdentity>;
    readonly required: boolean;
    readonly hooksPath: string | null;
    readonly expectedHooksPath: string;
    readonly hooksPathOk: boolean;
    readonly installedHookFiles: readonly HookFileInspection[];
    readonly ok: boolean;
}
export interface HookFileInspection {
    readonly path: string;
    readonly present: boolean;
    readonly markerPresent: boolean;
    readonly sha256: string | null;
}
interface ParsedGitHooksArgs {
    readonly cwd: string;
    readonly action: 'install' | 'verify';
    readonly frameworkRequired: boolean;
}
export declare function inspectGitHooks(cwd: string, options?: {
    frameworkRequired?: boolean;
}): GitHookInspectionReport;
export declare function installGitHooks(cwd: string, options?: {
    frameworkRequired?: boolean;
}): {
    schemaId: string;
    generatedAt: string;
    repoIdentity: FrameworkRepoIdentity;
    required: boolean;
    writtenFiles: string[];
    gitConfigExitCode: number;
    gitConfigStderr: string;
    ok: boolean;
    inspection: GitHookInspectionReport;
};
export declare function createGitHookScript(hookName: 'pre-commit' | 'pre-push', repoIdentity: FrameworkRepoIdentity): string;
export declare function inspectHookFile(cwd: string, hookName: 'pre-commit' | 'pre-push'): HookFileInspection;
export declare function parseGitHooksArgs(argv: string[]): ParsedGitHooksArgs;
export declare function normalizeGitConfigPath(value: string | null): string | null;
export {};
