export declare function inspectGitIndexAccess(cwd: string): {
    schemaId: string;
    ok: boolean;
    code: string;
    exitCode: number;
    indexLockPath: string;
    indexLockPresent: boolean;
    stderr: string;
    detail: string;
    requiredCommand: string | null;
};
export declare function classifyGitIndexFailure(stderr: string): string;
export declare function classifySandboxGitFailure(stderr: string): boolean;
export declare function classifyGitIndexPermissionFailure(stderr: string): boolean;
export declare function createSanitizedGitEnv(extra?: Record<string, string>): NodeJS.ProcessEnv;
export declare function runGitLines(cwd: string, args: readonly string[]): readonly string[];
export declare function runGitScalar(cwd: string, args: readonly string[]): string | null;
export declare function runGit(cwd: string, args: readonly string[], env?: Record<string, string>): {
    exitCode: number;
    stdout: string;
    stderr: string;
};
export declare function normalizeRelativePath(value: string): string;
