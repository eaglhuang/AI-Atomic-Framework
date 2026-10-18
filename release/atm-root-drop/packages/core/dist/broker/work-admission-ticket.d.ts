import type { ForeignGeneratedResidueProvenance } from './foreign-generated-residue-disposition.js';
export declare const WORK_ADMISSION_TICKET_SCHEMA_ID = "atm.workAdmissionTicket.v1";
export declare const WORK_ADMISSION_COVERAGE_RECEIPT_SCHEMA_ID = "atm.workAdmissionCoverageReceipt.v1";
export type WorkAdmissionRecoveryMode = 'auto' | 'enabled' | 'disabled';
export type ResolvedWorkAdmissionRecoveryMode = Exclude<WorkAdmissionRecoveryMode, 'auto'>;
export type WorkAdmissionGrantKind = 'file-write' | 'lifecycle-operation' | 'process-manifest';
export type WorkAdmissionOperation = 'write' | 'stage' | 'commit' | 'close' | 'push';
export type WorkAdmissionOrigin = 'claim' | 'task-import' | 'repair-closure';
export interface WorkAdmissionRunnerSelection {
    readonly runnerKind: 'frozen' | 'source-first';
    readonly runnerRef: string;
    readonly selectedAt: string;
}
export interface WorkAdmissionGrant {
    readonly kind: WorkAdmissionGrantKind;
    readonly values: readonly string[];
    readonly digest: `sha256:${string}`;
}
export interface WorkAdmissionRecoveryPolicy {
    readonly requestedMode: WorkAdmissionRecoveryMode;
    readonly resolvedMode: ResolvedWorkAdmissionRecoveryMode;
    readonly reasons: readonly string[];
    readonly maxSavePoints: 0 | 2;
    readonly perTaskByteBudget: number;
    readonly repositoryByteBudget: number;
    readonly handoffTtlSeconds: number;
    readonly tempRoot: '.atm/runtime/work-admission-temp';
    readonly policyDigest: `sha256:${string}`;
}
export interface WorkAdmissionTicket {
    readonly schemaId: typeof WORK_ADMISSION_TICKET_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly ticketId: string;
    readonly ticketDigest: `sha256:${string}`;
    readonly taskId: string;
    readonly origin: WorkAdmissionOrigin;
    readonly actorId: string;
    readonly laneSessionId: string | null;
    readonly claimGeneration: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly scopeDigest: `sha256:${string}`;
    readonly runnerSelection: WorkAdmissionRunnerSelection;
    readonly grants: readonly WorkAdmissionGrant[];
    readonly deferredForeignResidue: readonly ForeignGeneratedResidueProvenance[];
    readonly recovery: WorkAdmissionRecoveryPolicy;
}
export interface WorkAdmissionCoverageReceipt {
    readonly schemaId: typeof WORK_ADMISSION_COVERAGE_RECEIPT_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly ticketId: string;
    readonly ticketDigest: `sha256:${string}`;
    readonly taskId: string;
    readonly actorId: string;
    readonly operation: WorkAdmissionOperation;
    readonly path: string;
    readonly baseDigest: `sha256:${string}` | null;
    readonly observedDigest: `sha256:${string}`;
    readonly producingAtmCommand: string;
    readonly recordedAt: string;
}
export interface WorkAdmissionTicketDecision {
    readonly ok: boolean;
    readonly code: 'ATM_WORK_ADMISSION_OK' | 'ATM_WRITE_TICKET_MISSING' | 'ATM_WRITE_TICKET_STALE' | 'ATM_WRITE_TICKET_SCOPE_VIOLATION' | 'ATM_WORK_ADMISSION_DELIVERY_NOT_AUTHORIZED';
    readonly reason: string;
}
export interface WorkAdmissionRecoveryDecision {
    readonly state: 'covered' | 'recovery-required';
    readonly disposition: 'late-attach' | 'scope-amendment' | 'split' | 'handoff' | 'quarantine' | 'discard-with-proof' | 'historical-delivery-review' | 'corrective-commit' | 'remote-incident';
    readonly reason: string;
}
export interface WorkAdmissionSnapshotPlan {
    readonly enabled: boolean;
    readonly maxSavePoints: 0 | 2;
    readonly claimBaseline: 'reference-clean-git-blobs-and-capture-dirty-preimages' | 'not-created';
    readonly preRiskSavePoint: 'replaceable' | 'not-created';
    readonly tempRoot: '.atm/runtime/work-admission-temp' | null;
    readonly cleanup: 'close-immediately' | 'none';
}
export interface WorkAdmissionSnapshotSource {
    readonly path: string;
    readonly state: 'clean-tracked' | 'dirty-tracked' | 'untracked';
    readonly gitBlobId?: string | null;
    readonly content?: string | null;
}
export interface WorkAdmissionSnapshotEntry {
    readonly path: string;
    readonly kind: 'git-blob-reference' | 'compressed-preimage';
    readonly digest: `sha256:${string}`;
    readonly byteLength: number;
    readonly gitBlobId: string | null;
    readonly objectPath: string | null;
}
export interface WorkAdmissionSnapshot {
    readonly schemaId: 'atm.workAdmissionSnapshot.v1';
    readonly taskId: string;
    readonly ticketId: string;
    readonly point: 'claim-baseline' | 'pre-risk';
    readonly createdAt: string;
    readonly expiresAt: string | null;
    readonly entries: readonly WorkAdmissionSnapshotEntry[];
    readonly compressedBytes: number;
}
export declare function issueWorkAdmissionTicket(input: {
    readonly taskId: string;
    readonly origin?: WorkAdmissionOrigin;
    readonly actorId: string;
    readonly laneSessionId?: string | null;
    readonly claimGeneration: string;
    readonly allowedFiles: readonly string[];
    readonly requestedRecoveryMode?: WorkAdmissionRecoveryMode | null;
    readonly runnerSelection: WorkAdmissionRunnerSelection;
    readonly now?: string;
    readonly ttlSeconds?: number;
    readonly elevatedRisk?: {
        readonly complex?: boolean;
        readonly destructiveCapability?: boolean;
        readonly sharedSurface?: boolean;
        readonly workerEvidence?: 'trusted' | 'untrusted' | 'degraded' | 'unproven';
    };
    readonly processManifests?: readonly string[];
    readonly deferredForeignResidue?: readonly ForeignGeneratedResidueProvenance[];
}): WorkAdmissionTicket;
export declare function checkWorkAdmissionTicket(input: {
    readonly ticket: WorkAdmissionTicket | null | undefined;
    readonly taskId: string;
    readonly actorId: string;
    readonly laneSessionId?: string | null;
    readonly claimGeneration?: string | null;
    readonly files: readonly string[];
    readonly operation: WorkAdmissionOperation;
    readonly runnerSelection?: WorkAdmissionRunnerSelection | null;
    readonly now?: string;
}): WorkAdmissionTicketDecision;
export declare function createWorkAdmissionCoverageReceipt(input: {
    readonly ticket: WorkAdmissionTicket;
    readonly operation: WorkAdmissionOperation;
    readonly path: string;
    readonly baseContent?: string | null;
    readonly observedContent: string;
    readonly producingAtmCommand: string;
    readonly now?: string;
}): WorkAdmissionCoverageReceipt;
export declare function resolveWorkAdmissionRecoveryPolicy(input: {
    readonly requestedMode: WorkAdmissionRecoveryMode;
    readonly elevatedRisk?: {
        readonly complex?: boolean;
        readonly destructiveCapability?: boolean;
        readonly sharedSurface?: boolean;
        readonly workerEvidence?: 'trusted' | 'untrusted' | 'degraded' | 'unproven';
    };
}): WorkAdmissionRecoveryPolicy;
export declare function createWorkAdmissionSnapshotPlan(ticket: WorkAdmissionTicket): WorkAdmissionSnapshotPlan;
/**
 * Captures at most the two task-defined save points. Clean files never enter
 * the temp store: their Git blob id is enough to reconstruct the baseline.
 */
export declare function captureWorkAdmissionSnapshot(input: {
    readonly rootDir: string;
    readonly ticket: WorkAdmissionTicket;
    readonly point: 'claim-baseline' | 'pre-risk';
    readonly sources: readonly WorkAdmissionSnapshotSource[];
    readonly existingTaskBytes?: number;
    readonly existingRepositoryBytes?: number;
    readonly now?: string;
    readonly handoffPinned?: boolean;
}): WorkAdmissionSnapshot;
export declare function cleanupWorkAdmissionSnapshots(input: {
    readonly rootDir: string;
    readonly taskId: string;
    readonly ticketId?: string | null;
    readonly now?: string;
    readonly expiredOnly?: boolean;
}): readonly string[];
export declare function recoverUnattributedMutation(input: {
    readonly inScope: boolean;
    readonly alreadyPublished?: boolean;
    readonly nativeCommit?: boolean;
    readonly requestedHandoff?: boolean;
}): WorkAdmissionRecoveryDecision;
