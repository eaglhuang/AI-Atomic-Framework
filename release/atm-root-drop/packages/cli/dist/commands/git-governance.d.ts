export interface GitGovernanceViolation {
    readonly code: string;
    readonly detail: string;
}
export interface GitGovernanceCheckResult {
    readonly ok: boolean;
    readonly actorId: string;
    readonly taskId: string | null;
    readonly claimLeaseId: string | null;
    readonly sessionId: string | null;
    readonly gitName: string | null;
    readonly gitEmail: string | null;
    readonly trailers: Readonly<Record<string, readonly string[]>>;
    readonly violations: readonly GitGovernanceViolation[];
}
export declare function runAtmGit(argv: string[]): Promise<import("./shared.ts").CommandResult>;
export declare function evaluateGitGovernanceCheck(input: {
    cwd: string;
    actorInput: string | null;
    taskId: string | null;
    sessionId?: string | null;
    requireTrailers: boolean;
}): GitGovernanceCheckResult;
