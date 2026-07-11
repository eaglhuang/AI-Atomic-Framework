export type RunnerModeClass = 'frozen' | 'source-first' | 'source-import' | 'unknown';
export declare function normalizeRelativePath(root: string, entryPath: string): string;
export declare function classifyRunnerMode(entrypoint: string | null): RunnerModeClass;
export declare function describeRunnerMode(cwd: string): {
    schemaId: string;
    mode: RunnerModeClass;
    entrypoint: string | null;
    normalGovernanceCommand: string;
    sourceFirstCommand: string;
    sourceFirstOnlyWhen: string;
    syncCommand: "ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build";
    frozenRunnerSources: string[];
    guidance: string;
};
export declare function withRunnerMode<T extends {
    evidence?: Record<string, unknown>;
    messages?: unknown[];
}>(result: T, cwd: string): T;
