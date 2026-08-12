import { type ValidationContractCatalog, type ValidationContractChangeSet, type ValidationContractEvaluation, type ValidationContractEvidence, type ValidationContractTask } from '../../../../core/src/evidence/validation-contract.ts';
import { type PhaseSuitePromotionInput, type PhaseSuitePromotionReport } from '../../../../core/src/evidence/phase-suite.ts';
import { preflightBlockersToWriteReadinessBlockers, type HistoricalClosePreflightSummary } from './historical-close-preflight.ts';
export type { HistoricalClosePreflightSummary };
export interface TaskflowPlanningAuthorityDeliveryGate {
    required: boolean;
    ok: boolean;
    repoRoot: string | null;
    matchedFiles: string[];
    reason: string | null;
}
export declare function extractTaskflowDeclaredFiles(cwd: string, taskId: string, taskDocument: Record<string, unknown>): string[];
export declare function inspectPlanningAuthorityDelivery(input: {
    cwd: string;
    taskDocument: Record<string, unknown>;
    historicalDeliveryRefs: string[];
    resolvedPlanningMirrorPath?: string | null;
}): TaskflowPlanningAuthorityDeliveryGate;
export declare function buildTaskflowClosePreflight(input: {
    cwd: string;
    taskId: string;
    actorId: string;
    taskDocument: Record<string, unknown>;
    previewCommitBundle: unknown;
    historicalDeliveryRefs: string[];
    deferForeignStaged?: boolean;
    waiverOutOfScopeDelivery: boolean;
    waiverReason: string | null;
}): HistoricalClosePreflightSummary;
export declare function selectPreCloseLineBudgetTouchedFiles(input: {
    readonly cwd: string;
    readonly foreignActiveDirtyFiles?: readonly string[];
    readonly readTouched?: (cwd: string) => readonly string[];
}): string[];
export declare function buildPlanningDeliveryRequiredCommand(taskId: string, actorId: string): string;
export declare function resolveClosePreflightValidationContract(task: ValidationContractTask, changeSet: ValidationContractChangeSet, catalog: ValidationContractCatalog, evidence?: ValidationContractEvidence): ValidationContractEvaluation;
/**
 * Deterministic digest of a validation-contract evaluation. Evidence run,
 * pre-close, close packet, and pre-push must all recompute the identical digest
 * from the same evaluation so a card cannot silently change its required set,
 * freshness, or phase ownership between stages.
 */
export declare function validationContractDigest(evaluation: ValidationContractEvaluation): string;
export interface ValidatorReviewLifecycleRequiredReceipt {
    readonly caseId: string;
    readonly status: 'passed' | 'failed' | 'missing' | 'stale';
    readonly executedCaseCount: number;
}
export interface ValidatorReviewLifecycleGateInput {
    readonly evaluation: ValidationContractEvaluation;
    readonly requiredReceipts?: readonly ValidatorReviewLifecycleRequiredReceipt[];
    readonly phaseSuite?: PhaseSuitePromotionInput;
}
export interface ValidatorReviewLifecycleGateBlocker {
    readonly code: string;
    readonly reason: string;
    readonly caseIds: readonly string[];
}
export interface ValidatorReviewLifecycleGateReport {
    readonly ok: boolean;
    readonly failClosed: boolean;
    readonly contractDigest: string;
    readonly blockers: readonly ValidatorReviewLifecycleGateBlocker[];
    readonly phaseReport: PhaseSuitePromotionReport | null;
}
/**
 * The fail-closed pre-close gate. Blocks on unresolved required cases, zero-test
 * results, and stale phase ownership; advisory selections never block.
 */
export declare function evaluateValidatorReviewLifecycleGate(input: ValidatorReviewLifecycleGateInput): ValidatorReviewLifecycleGateReport;
export { preflightBlockersToWriteReadinessBlockers };
