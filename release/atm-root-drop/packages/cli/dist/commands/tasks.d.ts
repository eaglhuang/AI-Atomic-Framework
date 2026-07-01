import { type CommandResult } from './shared.ts';
import { safeTaskFileReadDir, safeTaskFileStat, readJsonRecord, taskPathFor, collectTaskFileValues, normalizeRelativePath, legacyTaskRequiresBaseline } from './tasks/task-file-io-helpers.ts';
import { type TaskImportSource as TaskImportSourceContract, type TaskCardImportDiagnostic as TaskCardImportDiagnosticContract, type TaskImportRecord as TaskImportRecordContract, type TaskImportStatus as TaskImportStatusContract, type TaskImportManifest as TaskImportManifestContract, type TaskDeliverableGateReport as TaskDeliverableGateReportContract, type TaskImportDiagnostic as TaskImportDiagnosticContract, type TaskVerifyReport as TaskVerifyReportContract, type TaskLegacyLedgerMigrationReport as TaskLegacyLedgerMigrationReportContract, type TaskLegacyLedgerMigrationEntry as TaskLegacyLedgerMigrationEntryContract, type TaskLegacyLedgerMigrationSkip as TaskLegacyLedgerMigrationSkipContract } from './tasks/result-contracts.ts';
export type TaskImportSource = TaskImportSourceContract;
export type TaskCardImportDiagnostic = TaskCardImportDiagnosticContract;
export type TaskImportRecord = TaskImportRecordContract;
export type TaskImportStatus = TaskImportStatusContract;
export type TaskImportManifest = TaskImportManifestContract;
export type TaskDeliverableGateReport = TaskDeliverableGateReportContract;
export type TaskImportDiagnostic = TaskImportDiagnosticContract;
export type TaskVerifyReport = TaskVerifyReportContract;
export type TaskLegacyLedgerMigrationReport = TaskLegacyLedgerMigrationReportContract;
export type TaskLegacyLedgerMigrationEntry = TaskLegacyLedgerMigrationEntryContract;
export type TaskLegacyLedgerMigrationSkip = TaskLegacyLedgerMigrationSkipContract;
export declare function runTasks(argv: string[]): Promise<CommandResult>;
export type { TaskResidueBucket, TaskResidueClassification } from './tasks/residue-diagnostics.ts';
export declare function loadTaskDocumentOrThrow(cwd: string, taskId: string): {
    taskPath: string;
    taskDocument: Record<string, unknown>;
};
export declare function buildResidueDiagnosisEvidence(cwd: string, taskId: string, taskDocument: Record<string, unknown>): import("./tasks/residue-diagnostics.ts").TaskResidueDiagnosisEvidence;
export interface TaskClaimPreparationStep {
    readonly action: 'reserve' | 'promote';
    readonly status: 'reserved' | 'ready';
    readonly transitionPath: string;
    readonly importEvidencePath?: string | null;
}
export interface TaskClaimPreparationResult {
    readonly taskId: string;
    readonly originalStatus: string;
    readonly finalStatus: string;
    readonly steps: readonly TaskClaimPreparationStep[];
}
export declare function prepareTaskForClaim(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly status: unknown;
    readonly title?: string | null;
    readonly transitionCommand?: string | null;
    readonly stopAfterAction?: 'reserve' | 'promote' | 'all';
}): TaskClaimPreparationResult;
export { verifyCloseoutProvenance } from './tasks/closeout-provenance.ts';
export { findTaskClaimDependencyBlockers } from './tasks/dependency-gates.ts';
export type { TaskClaimDependencyBlocker } from './tasks/dependency-gates.ts';
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
export { parseReconcileOptions, parseDeliverAndCloseOptions, parseCreateOptions, parseMirrorOptions, parseCloseOptions, parseStatusOptions, parseFinalizeDiagnoseOptions, parseResetOptions, parseLockCleanupOptions, parseClaimLifecycleOptions, parseHistoricalDeliveryRefs, parseScopeAddOptions, parseScopeRepairOptions, parseQueueOptions, parseAuditOptions, parseLegacyLedgerMigrationOptions, parseAllowStaleRunnerFlag } from './tasks/task-option-parsers.ts';
export { safeTaskFileReadDir, safeTaskFileStat, readJsonRecord, taskPathFor, collectTaskFileValues, normalizeRelativePath, legacyTaskRequiresBaseline };
