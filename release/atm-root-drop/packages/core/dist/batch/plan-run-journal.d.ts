export declare const ATM_BATCH_PLAN_DIGEST_MISMATCH = "ATM_BATCH_PLAN_DIGEST_MISMATCH";
export declare const ATM_BATCH_RUN_EVENT_JOURNAL_INVALID = "ATM_BATCH_RUN_EVENT_JOURNAL_INVALID";
export type PlanBatchRunPhase = 'created' | 'active' | 'held' | 'completed' | 'abandoned';
export type PlanExecutorPhaseKind = 'preflight' | 'select' | 'claim' | 'workers' | 'reconcile' | 'validate' | 'proposal-sealed' | 'broker-ticketed' | 'composing' | 'semantic-revalidation' | 'prepared' | 'published' | 'generated-writes' | 'commit' | 'checkpoint' | 'closeback' | 'analyze';
export declare const planExecutorPhaseChain: readonly PlanExecutorPhaseKind[];
export interface PlanBatchRunJournalEvent {
    readonly schemaId: 'atm.batchRunJournalEvent.v1';
    readonly eventId: string;
    readonly batchId: string;
    readonly kind: string;
    readonly taskId: string | null;
    readonly actorId: string;
    readonly laneSessionId: string | null;
    readonly tokenUsage: {
        readonly inputTokens: number | null;
        readonly outputTokens: number | null;
        readonly cacheReadTokens: number | null;
        readonly source: 'provider' | 'manual' | 'unavailable';
    };
    readonly waitedMs: number;
    readonly createdAt: string;
    readonly idempotencyKey: string;
    readonly eventDigest: string;
    readonly phase?: PlanExecutorPhaseKind;
    readonly inputDigest?: string;
    readonly outputDigest?: string;
    readonly sideEffectReceiptDigest?: string | null;
    readonly terminal?: boolean;
    readonly skipReason?: string | null;
}
export interface PlanBatchRunRecord {
    readonly schemaId: 'atm.batchRun.v1';
    readonly specVersion: '0.2';
    readonly batchId: string;
    readonly planDigest: string;
    readonly planPath: string | null;
    readonly taskIds: readonly string[];
    readonly phase: PlanBatchRunPhase;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly createdByActor: string;
    readonly laneSessionId: string | null;
    readonly journalPath: string;
    readonly eventCount: number;
    readonly lastEventDigest: string | null;
    readonly completedPhaseKeys?: readonly string[];
    readonly sideEffectReceiptDigests?: Readonly<Record<string, string>>;
}
export declare function startPlanBatchRun(input: {
    readonly cwd: string;
    readonly actorId: string;
    readonly planPath?: string | null;
    readonly taskIds: readonly string[];
    readonly laneSessionId?: string | null;
    readonly nowIso?: string;
}): {
    batchRun: PlanBatchRunRecord;
    event: PlanBatchRunJournalEvent;
};
export declare function appendPlanBatchRunEvent(cwd: string, batchId: string, input: {
    readonly kind: string;
    readonly taskId?: string | null;
    readonly phase?: PlanExecutorPhaseKind | null;
    readonly actorId: string;
    readonly laneSessionId?: string | null;
    readonly idempotencyKey: string;
    readonly inputDigest?: string | null;
    readonly outputDigest?: string | null;
    readonly sideEffectReceiptDigest?: string | null;
    readonly terminal?: boolean | null;
    readonly skipReason?: string | null;
    readonly inputTokens?: number | null;
    readonly outputTokens?: number | null;
    readonly cacheReadTokens?: number | null;
    readonly tokenSource?: 'provider' | 'manual' | 'unavailable';
    readonly waitedMs?: number | null;
    readonly nowIso?: string;
}): {
    batchRun: PlanBatchRunRecord;
    event: PlanBatchRunJournalEvent;
    duplicate: boolean;
};
export declare function readPlanBatchRunEvents(cwd: string, batchId: string): readonly PlanBatchRunJournalEvent[];
export declare function readPlanBatchRun(cwd: string, batchId: string): PlanBatchRunRecord | null;
export declare function planBatchRunRelativePath(batchId: string): string;
export declare function planBatchJournalRelativePath(batchId: string): string;
