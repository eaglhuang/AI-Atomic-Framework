export declare function parseResetOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    actorId: string | null;
    emergencyApproval: string | null;
    to: string;
    reason: string | null;
};
export declare function parseAuditOptions(argv: string[]): {
    cwd: string;
    staged: boolean;
};
export declare function parseQueueOptions(argv: string[]): {
    cwd: string;
    queueId: string | null;
    actorId: string | null;
    reason: string | null;
};
export declare function parseLockCleanupOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    actorId: string | null;
    reason: string | null;
    emergencyApproval: string | null;
    allStale: boolean;
};
export declare function parseLegacyLedgerMigrationOptions(argv: string[]): {
    cwd: string;
    actorId: string | null;
    dryRun: boolean;
    apply: boolean;
    reason: string;
};
export declare function parseClaimLifecycleOptions(action: 'claim' | 'renew' | 'release' | 'handoff' | 'takeover', argv: string[]): {
    cwd: string;
    taskId: string;
    actorId: string | null;
    files: string[];
    ttlSeconds: number;
    handoffTo: string | null;
    reason: string | null;
    reservedOk: boolean;
    claimIntent: "write" | "closeout-only";
    autoIntent: boolean;
    claimIntentExplicit: boolean;
};
