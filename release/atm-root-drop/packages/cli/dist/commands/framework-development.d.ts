import { type TaskLedgerMode, type TaskLedgerPolicy } from './task-ledger.ts';
export type FrameworkMode = 'inactive' | 'suspected' | 'required' | 'cross-repo-target-required';
export type ClosureAuthority = 'local' | 'target_repo' | 'none';
/**
 * Classification of an existing framework-temp lock that blocks a new claim.
 *
 * - `stale-completed` means the linked task is terminal and release-then-claim is safe.
 * - `stale-ttl-expired` means the runtime lease expired without renewal.
 * - `possibly-stale` means ATM can see a live lock but cannot verify the linked task.
 * - `still-active` means the linked task is still active and must use handoff/takeover.
 */
export type FrameworkStaleLockKind = 'stale-completed' | 'stale-ttl-expired' | 'possibly-stale' | 'still-active';
export interface FrameworkStaleLockInfo {
    readonly kind: FrameworkStaleLockKind;
    readonly lockTaskId: string;
    readonly lockPath: string;
    readonly actorId: string;
    readonly lockedAt: string | null;
    readonly linkedTaskId: string | null;
    readonly currentTaskId: string | null;
    readonly requiredCommand: string;
    readonly releaseCommand: string | null;
    readonly detail: string;
}
export interface FrameworkRepoIdentity {
    readonly isFrameworkRepo: boolean;
    readonly score: number;
    readonly root: string;
    readonly name: string | null;
    readonly signals: readonly string[];
}
export interface FrameworkModeStatusReport {
    readonly schemaId: 'atm.frameworkDevelopmentStatus';
    readonly specVersion: '0.1.0';
    readonly generatedAt: string;
    readonly repoRole: 'framework' | 'host';
    readonly repoIdentity: FrameworkRepoIdentity;
    readonly targetRepo: string | null;
    readonly targetRepoIdentity: FrameworkRepoIdentity | null;
    readonly mode: FrameworkMode;
    readonly closureAuthority: ClosureAuthority;
    readonly taskLedgerMode: TaskLedgerMode;
    readonly taskLedger: TaskLedgerPolicy;
    readonly changedFiles: readonly string[];
    readonly criticalChangedFiles: readonly string[];
    readonly docsOnlyChangedFiles: readonly string[];
    readonly requiredGates: readonly string[];
    readonly activeLocks: readonly string[];
    readonly staleLocks: readonly FrameworkStaleLockInfo[];
    readonly pinnedRunner: PinnedRunnerStatus;
    readonly blockers: readonly string[];
    readonly warnings: readonly string[];
}
export interface PinnedRunnerStatus {
    readonly status: 'available' | 'missing' | 'source-unavailable';
    readonly metadataPath: string;
    readonly sourcePath: string | null;
    readonly runnerPath: string | null;
    readonly reason: string | null;
}
export interface ClosurePacketCommandRun {
    readonly command: string;
    readonly cwd: string;
    readonly exitCode: number;
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
    readonly runnerVersion: string;
}
export interface ClosurePacketTargetCommitDelta {
    readonly currentCommitSha: string | null;
    readonly parentCommitShas: readonly string[];
    readonly governedTreeSha: string | null;
    readonly changedFiles: readonly string[];
}
export interface ClosurePacketRequiredGatesSnapshot {
    readonly schemaId: 'atm.requiredGatesSnapshot.v1';
    readonly generatedAt: string;
    readonly source: 'frameworkStatus.requiredGates';
    readonly ruleVersion: string;
    readonly frameworkMode: FrameworkMode;
    readonly repoRole: 'framework' | 'host';
    readonly changedFiles: readonly string[];
    readonly criticalChangedFiles: readonly string[];
    readonly requiredGates: readonly string[];
}
export interface ClosurePacketReconcileAttestation {
    readonly schemaId: 'atm.reconcileAttestation.v1';
    readonly deliveryCommit: string;
    readonly reconciledAt: string;
    readonly reconciledByActor: string;
    readonly reason: string;
}
export interface ClosurePacketRepairMetadata {
    readonly schemaId: 'atm.closurePacketRepair.v1';
    readonly repairedAt: string;
    readonly repairedByCommand: 'atm tasks repair-closure';
    readonly originalPacketCommitSha: string | null;
    readonly repairedTargetCommitSha: string | null;
    readonly evidencePath: string;
}
export interface HistoricalDeliveryProvenance {
    readonly schemaId: 'atm.historicalDeliveryProvenance.v1';
    readonly deliveryCommitSha: string;
    readonly taskMatchedFiles: readonly string[];
    readonly governanceFiles: readonly string[];
    readonly allowedRunnerOutputFiles: readonly string[];
    readonly outOfScopeSourceFiles: readonly string[];
    readonly waivedOutOfScopeFiles: readonly string[];
    readonly waiverReason: string | null;
}
export interface ClosurePacket {
    readonly schemaId: 'atm.closurePacket.v1';
    readonly specVersion: '0.1.0';
    readonly taskId: string;
    readonly targetRepoIdentity: FrameworkRepoIdentity;
    readonly targetCommit: string | null;
    readonly governedTreeSha: string | null;
    readonly targetCommitDelta: ClosurePacketTargetCommitDelta;
    readonly closedByCommand: 'atm tasks close';
    readonly commandRuns: readonly ClosurePacketCommandRun[];
    readonly validationPasses: readonly string[];
    readonly evidenceFreshness: 'fresh' | 'historical-reference' | 'draft';
    readonly requiredGates: readonly string[];
    readonly requiredGatesSnapshot: ClosurePacketRequiredGatesSnapshot;
    readonly evidencePath: string;
    readonly closedAt: string;
    readonly closedByActor: string;
    readonly sessionId: string | null;
    readonly attestation?: ClosurePacketReconcileAttestation | null;
    readonly repair?: ClosurePacketRepairMetadata | null;
    readonly historicalDeliveryProvenance?: HistoricalDeliveryProvenance | null;
    readonly recoveredFromMissingPacket?: boolean;
}
export interface FrameworkCloseWorktreeReport {
    readonly ok: boolean;
    readonly trackedDirtyFiles: readonly string[];
    readonly unstagedFiles: readonly string[];
    readonly stagedFiles: readonly string[];
    readonly untrackedFiles: readonly string[];
    readonly ignoredUntrackedFiles: readonly string[];
}
export declare function isTaskCloseGovernanceCriticalPath(filePath: string, taskId: string): boolean;
export type ClosureRepairUpstreamStatus = 'detached-head' | 'no-upstream' | 'ahead-of-upstream' | 'published-head-blocked';
export interface ClosurePacketValidationIssue {
    readonly path: string;
    readonly kind: 'missing' | 'invalidFormat';
    readonly formatExpected?: string;
    readonly actualValue?: string;
}
export interface ClosurePacketRepairResult {
    readonly taskId: string;
    readonly packetPath: string;
    readonly previousHead: string | null;
    readonly repairedHead: string | null;
    readonly targetCommit: string | null;
    readonly governedTreeSha: string | null;
    readonly changedFiles: readonly string[];
    readonly gitHeadEvidencePath: string;
    readonly amended: boolean;
    readonly dryRun: boolean;
    readonly changed: boolean;
    readonly upstreamStatus: ClosureRepairUpstreamStatus | null;
    readonly nextActionCommand: string | null;
    readonly commitMessage: string | null;
    readonly remediation: string | null;
    readonly scopeWarnings?: readonly string[];
    readonly upstreamEvidenceNormalized?: boolean;
}
export declare function normalizeSha256DigestValue(value: string): string;
export declare function normalizeSha256FieldsDeep<T>(value: T): T;
export interface TaskAuditFinding {
    readonly level: 'error' | 'warning';
    readonly code: string;
    readonly path: string;
    readonly taskId?: string;
    readonly detail: string;
}
export interface TaskAuditReport {
    readonly schemaId: 'atm.taskAuditReport';
    readonly specVersion: '0.1.0';
    readonly generatedAt: string;
    readonly repoIdentity: FrameworkRepoIdentity;
    readonly inspectedTaskCount: number;
    readonly inspectedEvidenceCount: number;
    readonly findings: readonly TaskAuditFinding[];
    readonly ok: boolean;
}
interface FrameworkModeOptions {
    readonly cwd: string;
    readonly files?: readonly string[];
    readonly targetRepo?: string | null;
}
export interface InferredFrameworkTargetRepo {
    readonly taskId: string;
    readonly taskPath: string;
    readonly field: string;
    readonly rawTargetRepo: string;
    readonly targetRepo: string;
    readonly targetRepoIdentity: FrameworkRepoIdentity;
}
export declare function runFrameworkMode(argv: string[]): import("./shared.ts").CommandResult | Promise<import("./shared.ts").CommandResult>;
export declare function runFrameworkTempClaim(cwd: string, actor: string | null, files: readonly string[], reason: string | null, linkedTaskId?: string | null): Promise<import("./shared.ts").CommandResult>;
export declare function runFrameworkTempRelease(cwd: string, actor: string | null): Promise<import("./shared.ts").CommandResult>;
export declare function buildFrameworkTempClaimCommand(files?: readonly string[], reason?: string | null, actorId?: string | null): string;
/**
 * Inspect the framework-temp lock for one actor and classify the safe recovery path.
 */
export declare function classifyFrameworkStaleLock(cwd: string, actorId: string, options?: {
    readonly currentTaskId?: string | null;
}): FrameworkStaleLockInfo | null;
/**
 * Scan framework-temp locks and return locks that need explicit recovery guidance.
 */
export declare function detectFrameworkStaleLocks(cwd: string): readonly FrameworkStaleLockInfo[];
export declare function buildFrameworkStaleCleanupCommand(staleLock: FrameworkStaleLockInfo, files?: readonly string[], reason?: string | null): string;
export declare function isFrameworkStaleLockReleasable(staleLock: FrameworkStaleLockInfo): boolean;
export declare function runFrameworkDevelopmentGuard(cwd: string, files?: readonly string[], targetRepo?: string | null): import("./shared.ts").CommandResult;
export declare function runFrameworkDevelopmentValidation(cwd: string, files?: readonly string[], targetRepo?: string | null): import("./shared.ts").CommandResult;
export declare function createFrameworkModeStatus(input: FrameworkModeOptions): FrameworkModeStatusReport;
export declare function detectFrameworkRepoIdentity(repositoryRoot: string): FrameworkRepoIdentity;
export declare function inferFrameworkTargetRepoFromTasks(cwd: string): InferredFrameworkTargetRepo | null;
export declare function isAtmCriticalNonDocSurface(filePath: string): boolean;
export declare function isAdopterInfrastructureSyncCommit(files: readonly string[]): boolean;
export declare function isAdopterInfrastructureSyncPath(value: string): boolean;
export declare function auditTasks(cwd: string): TaskAuditReport;
export declare function validateClosurePacket(value: unknown): {
    ok: boolean;
    missing: readonly string[];
    invalidFormat: readonly ClosurePacketValidationIssue[];
};
export declare function normalizeUpstreamEvidenceForTask(cwd: string, taskId: string): {
    evidencePath: string;
    changed: boolean;
};
export declare function requiredValidationPassesForClosure(requiredGates: readonly string[]): readonly string[];
export declare function createClosurePacket(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly sessionId?: string | null;
    readonly evidencePath: string;
    readonly requiredGates?: readonly string[];
    readonly changedFiles?: readonly string[];
    readonly frameworkStatus?: Pick<FrameworkModeStatusReport, 'mode' | 'repoRole' | 'changedFiles' | 'criticalChangedFiles' | 'requiredGates'> | null;
    readonly attestation?: ClosurePacketReconcileAttestation | null;
    readonly historicalDeliveryProvenance?: HistoricalDeliveryProvenance | null;
}): ClosurePacket;
export declare function writeClosurePacket(cwd: string, taskId: string, packet: ClosurePacket): string;
export type AtmTasksWriteAction = 'tasks-close' | 'tasks-reconcile' | 'tasks-import-write' | 'tasks-repair-closure-write';
export declare function isRunnerSyncRequired(cwd: string): boolean;
export declare function runnerStaleWarningMessage(): string;
export declare function assertRunnerFreshForWriteAction(input: {
    readonly cwd: string;
    readonly action: AtmTasksWriteAction;
    readonly allowStaleRunner: boolean;
}): {
    readonly warning: string | null;
};
export declare function closeJournalPath(cwd: string, taskId: string): string;
export interface TaskCloseTransactionResult {
    readonly transitionPath: string;
    readonly closurePacketPath: string | null;
}
export declare function executeTaskCloseTransaction(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly taskPath: string;
    readonly phase: 'close' | 'reconcile';
    readonly previousTaskContent: string;
    readonly createdClosurePacketAbsolute: string | null;
    readonly runWrites: () => TaskCloseTransactionResult | Promise<TaskCloseTransactionResult>;
}): Promise<TaskCloseTransactionResult>;
export declare const CLOSE_COMMIT_WINDOW_TTL_SECONDS = 30;
export declare const CLOSE_COMMIT_WINDOW_SCHEMA_ID = "atm.closeCommitWindow.v1";
export interface CloseCommitWindowRecord {
    readonly schemaId: typeof CLOSE_COMMIT_WINDOW_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly taskId: string;
    readonly actorId: string;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly ttlSeconds: number;
    readonly allowedFiles: readonly string[];
    readonly transitionId: string | null;
    readonly transitionAction: 'close' | 'reconcile';
}
export declare function registerCloseCommitWindow(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly allowedFiles: readonly string[];
    readonly transitionId: string | null;
    readonly action: 'close' | 'reconcile';
}): string;
export declare function readActiveCloseCommitWindows(cwd: string): readonly CloseCommitWindowRecord[];
export declare function findCloseCommitWindowCoveringPaths(cwd: string, candidatePaths: readonly string[]): CloseCommitWindowRecord | null;
export declare function inspectFrameworkCloseWorktree(cwd: string, taskId?: string | null): FrameworkCloseWorktreeReport;
export declare function repairClosurePacketForTask(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId?: string | null;
    readonly dryRun?: boolean;
    readonly amend?: boolean;
    readonly scopeTaskId?: string | null;
}): ClosurePacketRepairResult;
export declare function requireTargetRepoClosureAuthority(input: {
    readonly cwd: string;
    readonly taskDocument: Record<string, unknown>;
    readonly taskId: string;
    readonly status: string;
}): null;
export {};
