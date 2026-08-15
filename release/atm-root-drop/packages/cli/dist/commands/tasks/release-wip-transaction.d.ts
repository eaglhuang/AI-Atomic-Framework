export declare function isConfirmedWipCommitResult(result: any): boolean;
export declare function prepareReleaseWip(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly currentClaim: Record<string, any> | null;
    readonly taskDocument: Record<string, any>;
    readonly dirtyInScopeFiles: readonly string[];
    readonly discardWip: boolean;
    readonly wipCommit: boolean;
    readonly reason: string | null;
    readonly nowIso: string;
}): Promise<{
    readonly wipCommitReceipt: Record<string, unknown> | null;
    readonly discardWipReceipt: Record<string, unknown> | null;
}>;
