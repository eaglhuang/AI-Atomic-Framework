import type { LocalGovernanceBootstrapOptions, LocalGovernanceBootstrapResult, LocalGovernanceScriptInstallResult } from '../types.ts';
export declare function installRootDropScripts(cwd: string, options?: {
    readonly force?: boolean;
}): LocalGovernanceScriptInstallResult;
export declare function adoptLocalGovernanceBundle(cwd: string, options?: LocalGovernanceBootstrapOptions): LocalGovernanceBootstrapResult;
export declare function createOfficialBootstrapCommand(commandCwd?: string): string;
export declare function createRecommendedPrompt(taskId?: string): string;
export declare function createSelfHostingAlphaPrompt(): string;
