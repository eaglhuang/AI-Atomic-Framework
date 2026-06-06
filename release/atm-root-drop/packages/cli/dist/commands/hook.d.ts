import { detectFrameworkRepoIdentity } from './framework-development.ts';
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
export declare function runHook(argv: string[]): import("./shared.ts").CommandResult;
export declare function runGitHooks(argv: string[]): import("./shared.ts").CommandResult;
export declare function runCommitRangeGuard(argv: string[]): import("./shared.ts").CommandResult;
export declare function inspectGitHooks(cwd: string, options?: {
    frameworkRequired?: boolean;
}): GitHookInspectionReport;
export declare function installGitHooks(cwd: string, options?: {
    frameworkRequired?: boolean;
}): {
    schemaId: string;
    generatedAt: string;
    repoIdentity: import("./framework-development.ts").FrameworkRepoIdentity;
    required: boolean;
    writtenFiles: string[];
    gitConfigExitCode: number;
    gitConfigStderr: string;
    ok: boolean;
    inspection: GitHookInspectionReport;
};
