import { inspectProtectedAtmStateChanges } from './hook/pre-commit.ts';
import { hookContractVersion, hookMarker, hookProvider, inspectGitHooks, installGitHooks, type GitHookInspectionReport, type HookFileInspection } from './hook/git-hooks-installer.ts';
export { hookContractVersion, hookMarker, hookProvider, inspectGitHooks, installGitHooks, inspectProtectedAtmStateChanges };
export type { GitHookInspectionReport, HookFileInspection };
export declare function runHook(argv: string[]): import("./shared.ts").CommandResult;
export declare function runGitHooks(argv: string[]): import("./shared.ts").CommandResult;
export declare function runCommitRangeGuard(argv: string[]): import("./shared.ts").CommandResult;
