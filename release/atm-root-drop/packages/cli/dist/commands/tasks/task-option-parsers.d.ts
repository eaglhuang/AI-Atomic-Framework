import type { TaskImportStatus } from '../tasks.ts';
export declare function parseAllowStaleRunnerFlag(argv: readonly string[]): boolean;
export declare function parseStatusOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    residueOnly: boolean;
};
export declare function parseFinalizeDiagnoseOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    residueOnly: boolean;
};
export declare function parseReconcileOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    deliveryCommit: string;
    historicalDeliveryRepo: string | null;
    waiverReason: string | null;
    actorId: string | null;
    waiverOutOfScopeDelivery: boolean;
    emergencyApproval: string | null;
    allowStaleRunner: boolean;
};
export declare function parseDeliverAndCloseOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    actorId: string | null;
    deliveryCommit: string | null;
    message: string | null;
    reason: string | null;
    dryRun: boolean;
    fromBatchCheckpoint: boolean;
    batchId: string | null;
};
export declare function parseScopeAddOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    reason: string | null;
    actorId: string | null;
    claimFirst: boolean;
    emergencyApproval: string | null;
    addPaths: string[];
    /** 修改類型：doc-sync | help-snapshot-sync | test-alignment | generated-artifact | linked-surface */
    amendmentClass: string | null;
    /** 修改階段：pre-implementation | during-implementation | closeout */
    amendmentPhase: string | null;
};
/**
 * 解析 `tasks scope repair` 維護緊急通道的選項。
 * 與 `parseScopeAddOptions` 相似，但強制要求 `--emergency-approval` 和 `--reason`。
 */
export declare function parseScopeRepairOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    reason: string;
    actorId: string | null;
    emergencyApproval: string | null;
    addPaths: string[];
};
export declare function parseMetadataRepairDeliverablesOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    reason: string;
    actorId: string | null;
    setPaths: string[];
};
export declare function parseCreateOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    actorId: string | null;
    title: string | null;
    force: boolean;
};
export declare function parseMirrorOptions(argv: string[]): {
    cwd: string;
    provider: string;
    originTaskId: string;
    taskId: string | null;
    actorId: string | null;
    originUrl: string | null;
    title: string | null;
    status: TaskImportStatus;
    syncStatus: string;
};
export declare function parseHistoricalDeliveryRefs(value: string): string[];
export declare function parseCloseOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    historicalDeliveryRefs: readonly string[];
    historicalDeliveryRepo: string | null;
    reason: string | null;
    actorId: string | null;
    status: "done" | "review" | "blocked" | "abandoned";
    fromBatchCheckpoint: boolean;
    batchId: string | null;
    historicalBatchRef: string | null;
    waiverOutOfScopeDelivery: boolean;
    emergencyApproval: string | null;
    allowStaleRunner: boolean;
};
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
