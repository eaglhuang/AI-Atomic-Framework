import { type ClosurePacket } from '../../framework-development.ts';
import { type CommandResult } from '../../shared.ts';
import { type TaskTransitionClosureMetadata } from '../../task-ledger.ts';
import type { ParsedExternalTask } from '@ai-atomic-framework/plugin-sdk';
import { runTasksClose } from '../close-orchestrator.ts';
import { runTasksImport } from '../import-orchestrator.ts';
import { runTasksVerify } from '../verify-orchestrator.ts';
export { runTasksClose, runTasksImport, runTasksVerify };
export { runTasksClaimLifecycle } from '../claim-orchestrator.ts';
import { type TaskImportResetOpenClassification } from '../import-verify.ts';
import { assertEmergencyApproval } from '../../emergency/gate.ts';
import { evaluateFrameworkDeliveryWindow as delegatedEvaluateFrameworkDeliveryWindow, loadHistoricalBatchCloseSlice as delegatedLoadHistoricalBatchCloseSlice } from '../close-helpers/close-window-diagnostics.ts';
import { extractTaskCloseDeclaredFiles as delegatedExtractTaskCloseDeclaredFiles, extractTaskDeliverableFiles as delegatedExtractTaskDeliverableFiles, taskDeliveryPrincipleText as delegatedTaskDeliveryPrincipleText, evaluateTaskDeliverableGate as delegatedEvaluateTaskDeliverableGate, stageTaskCloseArtifacts as delegatedStageTaskCloseArtifacts, existingTaskCloseArtifacts as delegatedExistingTaskCloseArtifacts } from '../close-helpers/close-artifact-staging.ts';
import { writeTaskDocumentWithTransition as delegatedWriteTaskDocumentWithTransition } from '../close-helpers/task-transition-writer.ts';
import { safeTaskFileReadDir, safeTaskFileStat, readJsonRecord, taskPathFor, collectTaskFileValues, normalizeRelativePath, legacyTaskRequiresBaseline } from '../task-file-io-helpers.ts';
import { type TaskImportSource as TaskImportSourceContract, type TaskCardImportDiagnostic as TaskCardImportDiagnosticContract, type TaskImportRecord as TaskImportRecordContract, type TaskImportStatus as TaskImportStatusContract, type TaskImportManifest as TaskImportManifestContract, type TaskDeliverableGateReport as TaskDeliverableGateReportContract, type TaskImportDiagnostic as TaskImportDiagnosticContract, type TaskVerifyReport as TaskVerifyReportContract, type TaskLegacyLedgerMigrationReport as TaskLegacyLedgerMigrationReportContract, type TaskLegacyLedgerMigrationEntry as TaskLegacyLedgerMigrationEntryContract, type TaskLegacyLedgerMigrationSkip as TaskLegacyLedgerMigrationSkipContract } from '../result-contracts.ts';
import { recordStaleRunnerOverride as recordStaleRunnerOverrideDelegated, recordFailedEmergencyUseAttempt as recordFailedEmergencyUseAttemptDelegated, isCliErrorWithCode as isCliErrorWithCodeDelegated } from '../close-governance.ts';
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
export interface HistoricalBatchCloseSlice {
    readonly batchId: string;
    readonly batchPath: string;
    readonly ok: boolean;
    readonly matchedCommits: readonly string[];
    readonly matchedFiles: readonly string[];
    readonly coverageStatus: 'complete' | 'partial' | 'blocked';
    readonly okToRecordEvidence: boolean;
    readonly okToCloseTask: boolean;
    readonly diagnosticOnly: boolean;
    readonly missingCoverage: readonly string[];
    readonly taskSpecificValidationPasses: readonly string[];
    readonly batchWideValidationPasses: readonly string[];
    readonly advisoryValidationPasses: readonly string[];
}
export declare const validStatuses: Set<TaskImportStatusContract>;
export declare function runTasks(argv: string[]): Promise<CommandResult>;
export type { TaskResidueBucket, TaskResidueClassification } from '../residue-diagnostics.ts';
export declare const recordStaleRunnerOverride: typeof recordStaleRunnerOverrideDelegated;
export declare const isCliErrorWithCode: typeof isCliErrorWithCodeDelegated;
export declare const recordFailedEmergencyUseAttempt: typeof recordFailedEmergencyUseAttemptDelegated;
export declare function loadTaskDocumentOrThrow(cwd: string, taskId: string): {
    taskPath: string;
    taskDocument: Record<string, unknown>;
};
export declare function buildResidueDiagnosisEvidence(cwd: string, taskId: string, taskDocument: Record<string, unknown>): import("../residue-diagnostics.ts").TaskResidueDiagnosisEvidence;
export type { TaskClaimPreparationStep, TaskClaimPreparationResult } from '../claim-preparation.ts';
export declare function prepareTaskForClaim(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly status: unknown;
    readonly title?: string | null;
    readonly transitionCommand?: string | null;
}): import("./implementation.ts").TaskClaimPreparationResult;
export { verifyCloseoutProvenance } from '../closeout-provenance.ts';
export { findTaskClaimDependencyBlockers } from '../dependency-gates.ts';
export type { TaskClaimDependencyBlocker } from '../dependency-gates.ts';
export declare function readDeferredForeignStagedFilesForActiveCloseWindow(cwd: string, taskId: string): string[];
export declare const evaluateFrameworkDeliveryWindow: typeof delegatedEvaluateFrameworkDeliveryWindow;
export declare const evaluateTaskDeliverableGate: typeof delegatedEvaluateTaskDeliverableGate;
export declare const taskDeliveryPrincipleText: typeof delegatedTaskDeliveryPrincipleText;
export declare const loadHistoricalBatchCloseSlice: typeof delegatedLoadHistoricalBatchCloseSlice;
export declare const extractTaskCloseDeclaredFiles: typeof delegatedExtractTaskCloseDeclaredFiles;
export declare const extractTaskDeliverableFiles: typeof delegatedExtractTaskDeliverableFiles;
export declare function assertLocalTaskLedgerEnabled(cwd: string, action: string): void;
export declare function buildTaskTransitionCommand(input: {
    readonly action: string;
    readonly taskId: string;
    readonly actorId: string | null;
    readonly status?: string | null;
    readonly fromBatchCheckpoint?: boolean;
    readonly batchId?: string | null;
    readonly historicalDeliveryRefs?: readonly string[];
}): string;
export declare const writeTaskDocumentWithTransition: typeof delegatedWriteTaskDocumentWithTransition;
export declare const stageTaskCloseArtifacts: typeof delegatedStageTaskCloseArtifacts;
export declare const existingTaskCloseArtifacts: typeof delegatedExistingTaskCloseArtifacts;
export declare function createClosureTransitionMetadata(closurePacketPath: string | null, closurePacket: ClosurePacket | null, batchId?: string | null, sessionId?: string | null): TaskTransitionClosureMetadata | null;
export declare function inspectTaskVerifyStatus(value: unknown): {
    readonly ok: boolean;
    readonly normalizedStatus: string | null;
    readonly warningCode: string | null;
};
export declare function inspectTaskSourceTrace(document: Record<string, unknown>, statusInspection: {
    readonly ok: boolean;
    readonly normalizedStatus: string | null;
    readonly warningCode: string | null;
}): {
    readonly level: 'warning' | 'error';
    readonly code: string;
    readonly text: string;
} | null;
export declare function classifyResetOpenImportForOptions(options: {
    cwd: string;
    from: string;
}): TaskImportResetOpenClassification;
export declare function parseImportOptions(argv: string[]): {
    cwd: string;
    from: string;
    dryRun: boolean;
    write: boolean;
    force: boolean;
    forceOverwriteClaims: boolean;
    resetOpen: boolean;
    reopen: boolean;
    reconcileMirror: boolean;
    strictPaths: boolean;
    emergencyApproval: string | null;
    allowStaleRunner: boolean;
    waivePlanningRoot: boolean;
    reason: string | null;
};
export declare function parseVerifyOptions(argv: string[]): {
    cwd: string;
};
export interface ParsedPlanResult {
    readonly tasks: readonly TaskImportRecord[];
    readonly diagnostics: TaskImportDiagnostic[];
}
export declare function parsePlanMarkdown(input: {
    readonly planText: string;
    readonly planRelativePath: string;
    readonly importedAt: string;
}): ParsedPlanResult;
export declare function detectPlanHeadings(planText: string): readonly {
    readonly line: number;
    readonly text: string;
}[];
export declare function enrichParsedTasksFromSiblingTaskCards(input: {
    readonly cwd: string;
    readonly planAbsolute: string;
    readonly parsed: ParsedPlanResult;
    readonly importedAt: string;
}): ParsedPlanResult;
export declare function collectActiveClaimImportSkips(cwd: string, tasks: readonly TaskImportRecord[], options: {
    readonly force: boolean;
    readonly forceOverwriteClaims: boolean;
    readonly resetOpen: boolean;
    readonly reopen: boolean;
    readonly reconcileMirror?: boolean;
}): TaskImportDiagnostic[];
export declare function writeTaskFiles(input: {
    readonly cwd: string;
    readonly tasks: readonly TaskImportRecord[];
    readonly force: boolean;
    readonly forceOverwriteClaims: boolean;
    readonly resetOpen: boolean;
    readonly reopen: boolean;
    readonly reconcileMirror?: boolean;
}): {
    writtenPaths: string[];
    diagnostics: TaskImportDiagnostic[];
};
export declare function writeImportEvidence(input: {
    readonly cwd: string;
    readonly tasks: readonly TaskImportRecord[];
    readonly planPath: string;
    readonly generatedAt: string;
    readonly writtenPaths: readonly string[];
}): string;
export declare function uniqueStrings(values: readonly string[]): readonly string[];
export declare function parseSingleCardFromPlugin(parsed: ParsedExternalTask, importedAt: string): TaskImportRecord;
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
export { parseReconcileOptions, parseDeliverAndCloseOptions, parseCreateOptions, parseMirrorOptions, parseCloseOptions, parseStatusOptions, parseFinalizeDiagnoseOptions, parseResetOptions, parseLockCleanupOptions, parseClaimLifecycleOptions, parseHistoricalDeliveryRefs, parseScopeAddOptions, parseScopeRepairOptions, parseQueueOptions, parseAuditOptions, parseLegacyLedgerMigrationOptions, parseAllowStaleRunnerFlag } from '../task-option-parsers.ts';
export { safeTaskFileReadDir, safeTaskFileStat, readJsonRecord, taskPathFor, collectTaskFileValues, normalizeRelativePath, legacyTaskRequiresBaseline };
export type EmergencyUseEvidence = ReturnType<typeof assertEmergencyApproval>;
