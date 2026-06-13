import { type CommandResult } from './shared.ts';
import { type TaskDependencyCloseoutBlocker } from './tasks/closeout-provenance.ts';
import { type TaskDispatchPattern } from './tasks/task-markdown-helpers.ts';
import { safeTaskFileReadDir, safeTaskFileStat, readJsonRecord, taskPathFor, collectTaskFileValues, normalizeRelativePath, legacyTaskRequiresBaseline } from './tasks/task-file-io-helpers.ts';
import { type ContextMap } from './tasks/task-import-validators.ts';
export interface TaskImportSource {
    readonly planPath: string;
    readonly sectionTitle: string;
    readonly headingLine: number;
    readonly hash: string;
}
export interface TaskCardImportDiagnostic {
    readonly code: string;
    readonly severity: 'info' | 'warning' | 'error';
    readonly message: string;
    readonly field?: string;
    readonly alias?: string;
    readonly canonical?: string;
    readonly candidates?: readonly string[];
}
export interface TaskImportRecord {
    readonly schemaVersion: 'atm.workItem.v0.2';
    readonly workItemId: string;
    readonly title: string;
    readonly status: TaskImportStatus;
    readonly milestone?: string | null;
    readonly dependencies: readonly string[];
    readonly acceptance: readonly string[];
    readonly deliverables: readonly string[];
    readonly scopePaths?: readonly string[];
    readonly validators?: readonly string[];
    readonly planningRepo?: string | null;
    readonly targetRepo?: string | null;
    readonly closureAuthority?: string | null;
    readonly planningReadOnlyPaths?: readonly string[];
    readonly planningMirrorPaths?: readonly string[];
    readonly outOfScope?: readonly string[];
    readonly nonGoals?: readonly string[];
    readonly evidenceRequired?: string | null;
    readonly rollbackStrategy?: string | null;
    readonly rollbackNotes?: string | null;
    readonly atomizationImpact?: {
        readonly ownerAtomOrMap?: string | null;
        readonly mapUpdates?: readonly string[];
    };
    readonly legacyImportAliases?: Record<string, readonly string[] | string>;
    readonly importDiagnostics?: readonly TaskCardImportDiagnostic[];
    readonly tags: readonly string[];
    readonly notes?: string | null;
    readonly contextMap?: ContextMap;
    readonly dispatchPattern?: TaskDispatchPattern;
    readonly conditionReview?: readonly string[];
    readonly mailboxAssignee?: string | null;
    readonly source: TaskImportSource;
    readonly importedAt: string;
}
export type TaskImportStatus = 'planned' | 'open' | 'in_progress' | 'reserved' | 'ready' | 'running' | 'review' | 'blocked' | 'abandoned' | 'done';
export interface TaskImportManifest {
    readonly schemaId: 'atm.taskImportManifest';
    readonly specVersion: '0.1.0';
    readonly generatedAt: string;
    readonly planPath: string;
    readonly mode: 'dry-run' | 'write';
    readonly tasks: readonly TaskImportRecord[];
    readonly diagnostics: readonly TaskImportDiagnostic[];
    readonly writtenPaths: readonly string[];
    readonly evidencePath: string | null;
}
export interface TaskDeliverableGateReport {
    readonly schemaId: 'atm.taskDeliverableGate.v1';
    readonly generatedAt: string;
    readonly taskId: string;
    readonly deliveryPrinciple: string;
    readonly required: boolean;
    readonly ok: boolean;
    readonly reason: string;
    readonly changedFiles: readonly string[];
    readonly deliverableFiles: readonly string[];
    readonly declaredFiles: readonly string[];
    readonly historicalDeliveries: readonly TaskHistoricalDeliveryReport[];
    readonly notAllowedAsCompletion: readonly string[];
    readonly remediation: string;
    readonly requiredCommand: string | null;
}
export interface HistoricalDeliveryFileBuckets {
    readonly taskMatchedFiles: readonly string[];
    readonly governanceFiles: readonly string[];
    readonly allowedRunnerOutputFiles: readonly string[];
    readonly outOfScopeSourceFiles: readonly string[];
    readonly ignoredFiles: readonly string[];
}
export interface TaskHistoricalDeliveryReport {
    readonly requestedRef: string;
    readonly commitSha: string | null;
    readonly ok: boolean;
    readonly reason: string;
    readonly changedFiles: readonly string[];
    readonly deliverableFiles: readonly string[];
    readonly fileBuckets: HistoricalDeliveryFileBuckets;
    readonly waiverApplied: boolean;
}
export interface TaskImportDiagnostic {
    readonly level: 'info' | 'warning' | 'error';
    readonly code: string;
    readonly text: string;
    readonly workItemId?: string;
    readonly sourceLine?: number;
}
export interface TaskVerifyReport {
    readonly schemaId: 'atm.taskVerifyReport';
    readonly specVersion: '0.1.0';
    readonly generatedAt: string;
    readonly taskStorePath: string;
    readonly inspectedTasks: number;
    readonly findings: readonly TaskImportDiagnostic[];
    readonly ok: boolean;
}
export interface TaskLegacyLedgerMigrationReport {
    readonly schemaId: 'atm.taskLegacyLedgerMigrationReport';
    readonly specVersion: '0.1.0';
    readonly generatedAt: string;
    readonly mode: 'dry-run' | 'apply';
    readonly taskRoot: string;
    readonly eventRoot: string;
    readonly inspectedTaskCount: number;
    readonly migratableTaskCount: number;
    readonly migratedTaskCount: number;
    readonly skippedTaskCount: number;
    readonly migratedTasks: readonly TaskLegacyLedgerMigrationEntry[];
    readonly skippedTasks: readonly TaskLegacyLedgerMigrationSkip[];
}
export interface TaskLegacyLedgerMigrationEntry {
    readonly taskId: string;
    readonly taskPath: string;
    readonly taskFormat: 'json' | 'markdown';
    readonly status: string;
    readonly reason: 'missing-transition-id' | 'missing-transition-event';
    readonly transitionPath: string | null;
}
export interface TaskLegacyLedgerMigrationSkip {
    readonly taskId: string;
    readonly taskPath: string;
    readonly taskFormat: 'json' | 'markdown';
    readonly reason: string;
}
export declare function runTasks(argv: string[]): Promise<CommandResult>;
export type TaskResidueBucket = 'no-residue' | 'complete-but-unfinalized' | 'source-done-governance-incomplete' | 'planning-mirror-only' | 'interrupted-close' | 'stale-import' | 'ambiguous-manual-review';
export interface TaskResidueClassification {
    bucket: TaskResidueBucket;
    truth: string;
    residue: string;
    reason: string;
    nextCommandTemplate: string;
    nextCommand: string;
    autoMutationAllowed: false;
}
export declare function loadTaskDocumentOrThrow(cwd: string, taskId: string): {
    taskPath: string;
    taskDocument: Record<string, unknown>;
};
export declare function buildResidueDiagnosisEvidence(cwd: string, taskId: string, taskDocument: Record<string, unknown>): {
    schemaId: "atm.taskResidueDiagnosis.v1";
    taskId: string;
    bucket: TaskResidueBucket;
    truth: string;
    residue: string;
    reason: string;
    nextCommand: string;
    nextCommandTemplate: string;
    autoMutationAllowed: false;
    diagnostics: {
        codes: string[];
        messages: string[];
    };
    triangulation: {
        ssot: "liveLedger";
        liveLedger: {
            status: string | null;
            claimState: "active" | "released" | "handoff" | "taken_over" | null;
            lastTransitionId: string | null;
            lastTransitionAt: string | null;
        };
        lastTransitionEvent: {
            action: string | null;
            actorId: string | null;
            createdAt: string | null;
            fromStatus: string | null;
            toStatus: string | null;
        } | null;
        planningFrontmatter: {
            status: string | null;
            source: string | null;
        };
        divergence: {
            field: string;
            liveLedger: string | null;
            planningFrontmatter?: string | null;
            lastTransitionEvent?: string | null;
        }[];
        recommendation: string | null;
        residueClassification: TaskResidueClassification;
    };
};
export { verifyCloseoutProvenance } from './tasks/closeout-provenance.ts';
export type TaskClaimDependencyBlocker = TaskDependencyCloseoutBlocker;
export declare function findTaskClaimDependencyBlockers(cwd: string, taskId: string, taskDocument: Record<string, unknown>): TaskClaimDependencyBlocker[];
export declare function categorizeHistoricalCommitFiles(input: {
    readonly taskId: string;
    readonly changedFiles: readonly string[];
    readonly declaredFiles: readonly string[];
}): HistoricalDeliveryFileBuckets;
export declare function inspectHistoricalDelivery(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly requestedRef: string;
    readonly declaredFiles: readonly string[];
    readonly enforceDeclaredScope: boolean;
    readonly waiverOutOfScopeDelivery: boolean;
    readonly waiverReason: string | null;
}): TaskHistoricalDeliveryReport;
export interface ParsedPlanResult {
    readonly tasks: readonly TaskImportRecord[];
    readonly diagnostics: TaskImportDiagnostic[];
}
export declare function parsePlanMarkdown(input: {
    readonly planText: string;
    readonly planRelativePath: string;
    readonly importedAt: string;
}): ParsedPlanResult;
export declare function runTasksRosterUpdate(argv: string[]): Promise<CommandResult>;
export interface GenerateTaskCardInput {
    cwd: string;
    templateKey?: string;
    taskId: string;
    title?: string;
    outputPath: string;
    dependsOn?: string;
    scopePath?: string;
    testPath?: string;
    atomId?: string;
    capability?: string;
    goal?: string;
}
export interface GeneratedTaskCardResult {
    taskId: string;
    content: string;
    sourcePath: string;
    templateUsed: string;
}
export declare function generateTaskCard(input: GenerateTaskCardInput): Promise<GeneratedTaskCardResult>;
export { parseReconcileOptions, parseDeliverAndCloseOptions, parseCreateOptions, parseMirrorOptions, parseCloseOptions, parseStatusOptions, parseFinalizeDiagnoseOptions, parseResetOptions, parseLockCleanupOptions, parseClaimLifecycleOptions, parseHistoricalDeliveryRefs, parseScopeAddOptions, parseQueueOptions, parseAuditOptions, parseLegacyLedgerMigrationOptions, parseAllowStaleRunnerFlag } from './tasks/task-option-parsers.ts';
export { safeTaskFileReadDir, safeTaskFileStat, readJsonRecord, taskPathFor, collectTaskFileValues, normalizeRelativePath, legacyTaskRequiresBaseline };
