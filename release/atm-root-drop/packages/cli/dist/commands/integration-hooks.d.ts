export type HookIntegrationId = 'copilot' | 'claude-code' | 'cursor' | 'gemini' | 'codex' | 'antigravity';
export type IntegrationHookAction = 'pre-agent' | 'pre-tool';
interface InstallEditorHooksOptions {
    readonly dryRun?: boolean;
    readonly force?: boolean;
}
export declare function runIntegrationHookInvocation(argv: string[]): import("./shared.ts").CommandResult;
export declare function installEditorIntegrationHooks(cwd: string, adapterId: string, options?: InstallEditorHooksOptions): {
    schemaId: string;
    generatedAt: string;
    adapterId: "cursor" | "gemini" | "codex" | "antigravity";
    supported: boolean;
    repoIdentity: import("./framework-development.ts").FrameworkRepoIdentity;
    writtenFiles: never[];
    gitHooks: null;
    ok: boolean;
    reason: string;
} | {
    schemaId: string;
    generatedAt: string;
    adapterId: "claude-code" | "copilot";
    supported: boolean;
    repoIdentity: import("./framework-development.ts").FrameworkRepoIdentity;
    writtenFiles: string[];
    dryRun: boolean;
    hookContractVersion: "atm.integration-hooks/v1";
    hookProvider: "atm-framework-development-hooks/v1";
    supportedHookEvents: readonly string[];
    gitHooks: import("./hook.ts").GitHookInspectionReport | {
        schemaId: string;
        generatedAt: string;
        repoIdentity: import("./framework-development.ts").FrameworkRepoIdentity;
        required: boolean;
        writtenFiles: string[];
        gitConfigExitCode: number;
        gitConfigStderr: string;
        ok: boolean;
        inspection: import("./hook.ts").GitHookInspectionReport;
    };
    ok: boolean;
};
export declare function verifyEditorIntegrationHooks(cwd: string, adapterId: string): {
    schemaId: string;
    generatedAt: string;
    adapterId: HookIntegrationId;
    supported: boolean;
    repoIdentity: import("./framework-development.ts").FrameworkRepoIdentity;
    hookContractVersion: "atm.integration-hooks/v1";
    hookProvider: "atm-framework-development-hooks/v1";
    supportedHookEvents: readonly string[];
    installedHookFiles: ({
        path: string;
        present: boolean;
        markerPresent: boolean;
        sha256: null;
    } | {
        path: string;
        present: boolean;
        markerPresent: boolean;
        sha256: string;
    })[];
    manifestHookContractOk: boolean;
    gitHooks: import("./hook.ts").GitHookInspectionReport;
    ok: boolean;
};
export declare function inspectFrameworkHookReadiness(cwd: string): {
    schemaId: string;
    generatedAt: string;
    repoIdentity: import("./framework-development.ts").FrameworkRepoIdentity;
    required: boolean;
    gitHooks: import("./hook.ts").GitHookInspectionReport;
    editorHooks: {
        schemaId: string;
        generatedAt: string;
        adapterId: HookIntegrationId;
        supported: boolean;
        repoIdentity: import("./framework-development.ts").FrameworkRepoIdentity;
        hookContractVersion: "atm.integration-hooks/v1";
        hookProvider: "atm-framework-development-hooks/v1";
        supportedHookEvents: readonly string[];
        installedHookFiles: ({
            path: string;
            present: boolean;
            markerPresent: boolean;
            sha256: null;
        } | {
            path: string;
            present: boolean;
            markerPresent: boolean;
            sha256: string;
        })[];
        manifestHookContractOk: boolean;
        gitHooks: import("./hook.ts").GitHookInspectionReport;
        ok: boolean;
    }[];
    ok: boolean;
};
export declare function makeIntegrationHookInstallResult(cwd: string, adapterId: string, options?: InstallEditorHooksOptions): import("./shared.ts").CommandResult;
export declare function makeIntegrationHookVerifyResult(cwd: string, adapterId: string): import("./shared.ts").CommandResult;
export {};
