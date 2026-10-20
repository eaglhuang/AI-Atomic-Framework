import { SHARED_COMPOSE_CONTRACT, type ProposalStage, type ProposalTerminal, type StopReason } from './shared-compose-inbox-contract.js';
export interface ComposeAdmission {
    readonly admitted: boolean;
    readonly reasonCode: string | null;
    readonly waitMs: number;
}
export interface StoredComposeProposal {
    proposalId: string;
    taskId: string;
    actorId: string;
    targetFile: string;
    targetPath: string;
    baseHash: string;
    baseBytes: string;
    baseCommit: string | null;
    patch: string;
    scope: string | null;
    ticket: string | null;
    validators: string[];
    arrivedAt: number;
    firstSubmittedAt: number;
    deadlineMs: number;
    itemStopAt: number | null;
    retryCount: number;
    attemptCount: number;
    late: boolean;
    admission: ComposeAdmission;
    stages: ProposalStage[];
    hashDriftCount: number;
}
export interface ComposeWindowMember {
    readonly proposalId: string;
    readonly arrivedAt: number;
    readonly late: boolean;
}
export interface ComposeWindowRecord {
    windowId: string;
    targetFile: string;
    targetPath: string;
    baseHash: string;
    baseBytes: string;
    policyVersion: string;
    openedAt: number;
    expiresAt: number;
    composeWindowMs: number;
    maxBatchSize: number;
    members: ComposeWindowMember[];
    state: 'open';
}
export type ComposeBatchStatus = 'composing' | 'committing' | 'committed' | 'rejected' | 'superseded';
export interface ComposeBatchRecord {
    batchId: string;
    windowId: string;
    targetFile: string;
    targetPath: string;
    baseHash: string;
    baseBytes: string;
    policyVersion: string;
    openedAt: number;
    sealedAt: number;
    arrivals: ComposeWindowMember[];
    batchSize: number;
    status: ComposeBatchStatus;
    memberTerminal: boolean;
    acceptedIds: string[];
    rejectedIds: string[];
    errorIds: string[];
    rejectionDetails: Record<string, string>;
    errorDetails: Record<string, string>;
    composeVerdict: 'compatible' | 'conflict' | 'error' | 'mixed' | null;
    diagnosticComposeVerdict: string | null;
    candidate: string | null;
    renameCount: number;
    renameAt: number | null;
    resultHash: string | null;
    terminal: ProposalTerminal | null;
    detail: string | null;
}
export interface SharedComposeReceipt {
    schemaId: typeof SHARED_COMPOSE_CONTRACT.schemaId;
    proposalId: string;
    taskId: string;
    actorId: string;
    scope: string | null;
    ticket: string | null;
    validators: string[];
    stage: ProposalStage;
    stagesReached: ProposalStage[];
    batchId: string | null;
    batchSize: number | null;
    memberProposalIds: string[];
    acceptedSetKey: string[];
    baseHash: string;
    declaredBaseHash: string;
    resultHash: string | null;
    late: boolean;
    terminal: ProposalTerminal;
    resolvedTerminal: ProposalTerminal | null;
    resolvedStopReason: StopReason | null;
    stopReason: StopReason;
    executableSeconds: number;
    firstSubmittedAt: number;
    effectiveStopAt: number;
    elapsedMs: number;
    attemptCount: number;
    retryCount: number;
    renameAt: number | null;
    ackAt: number | null;
    renameCount: number;
    detail: string | null;
    composeVerdict: string | null;
    diagnosticComposeVerdict: string | null;
    hashDriftCount: number;
    policyVersion: string;
}
export interface EntryPointRecord {
    entryPointId: string;
    pid: number;
    stoppedAt: number | null;
}
export declare function hashComposeBytes(text: string): string;
export declare function sharedComposeFileKey(targetFile: string): string;
export declare function composeToken(prefix: string): string;
export declare function assertSafeId(value: string, label: string): void;
export declare function ensureComposeInbox(inboxDir: string): void;
export declare function withComposeFileLock<T>(inboxDir: string, targetFile: string, waitMs: number, fn: () => T): T;
export declare function atomicWriteText(filePath: string, content: string): string;
/** One file fsync plus a best-effort directory fsync. Callers must not count this as a retry. */
export declare function commitTempFile(tmpPath: string, filePath: string): void;
export declare function writeJsonAtomic(filePath: string, value: unknown): void;
export declare function readJson<T>(filePath: string): T | null;
export declare function proposalPath(inboxDir: string, proposalId: string): string;
export declare function windowPath(inboxDir: string, targetFile: string): string;
export declare function batchPath(inboxDir: string, batchId: string): string;
export declare function receiptPath(inboxDir: string, proposalId: string): string;
export declare function entryPointPath(inboxDir: string, entryPointId: string): string;
export declare function readProposal(inboxDir: string, proposalId: string): StoredComposeProposal | null;
export declare function writeProposal(inboxDir: string, proposal: StoredComposeProposal): void;
export declare function readWindow(inboxDir: string, targetFile: string): ComposeWindowRecord | null;
export declare function writeWindow(inboxDir: string, window: ComposeWindowRecord): void;
export declare function deleteWindow(inboxDir: string, targetFile: string): void;
export declare function readBatch(inboxDir: string, batchId: string): ComposeBatchRecord | null;
export declare function writeBatch(inboxDir: string, batch: ComposeBatchRecord): void;
export declare function listBatches(inboxDir: string): ComposeBatchRecord[];
export declare function readReceipt(inboxDir: string, proposalId: string): SharedComposeReceipt | null;
export declare function writeReceipt(inboxDir: string, receipt: SharedComposeReceipt): SharedComposeReceipt;
export declare function listReceipts(inboxDir: string): SharedComposeReceipt[];
export declare function readEntryPoint(inboxDir: string, entryPointId: string): EntryPointRecord | null;
export declare function writeEntryPoint(inboxDir: string, record: EntryPointRecord): void;
export declare function listEntryPoints(inboxDir: string): EntryPointRecord[];
export declare function liveEntryPoints(inboxDir: string): EntryPointRecord[];
export declare function isProcessAlive(pid: number): boolean;
export declare function tempOwnerPid(fileName: string): number | null;
/** Removes compose temps whose owner pid is dead. Live writers' temps stay. */
export declare function removeComposeTempFiles(directories: readonly string[]): string[];
export declare function parentDir(filePath: string): string;
export declare function readTargetText(targetPath: string): string;
