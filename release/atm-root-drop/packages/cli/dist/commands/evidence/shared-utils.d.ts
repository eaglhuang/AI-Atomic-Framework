export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function isCommandRunProof(value: unknown): boolean;
export declare function quoteForShell(arg: string): string;
export interface CommandRunEvidenceInput {
    readonly command: string;
    readonly cwd?: string;
    readonly exitCode: number;
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
    readonly validators?: readonly string[];
    readonly cached?: boolean;
    readonly cacheKey?: string;
    readonly runnerKind?: string;
    readonly sourceCommit?: string;
    readonly runnerVersion?: string;
    readonly generatedAt?: string;
    readonly stdoutPreview?: string;
    readonly stderrPreview?: string;
}
