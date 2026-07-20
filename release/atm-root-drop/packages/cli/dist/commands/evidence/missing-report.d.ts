import { type ValidatorEvidenceState, type ValidatorTier } from './validator-classification.ts';
export type { ValidatorEvidenceState };
export interface MissingValidatorFinding {
    readonly code: string;
    readonly validator: string;
    readonly category: 'absent' | 'failed-run' | 'stale' | 'diagnostic-only';
    readonly summary: string;
    readonly requiredCommand: string;
}
export interface ValidatorCatalogEntry {
    readonly name: string;
    readonly tier: ValidatorTier;
    /** TASK-AAO-0017 follow-up：標記此 validator 是否為 closure gate 必要條件 */
    readonly closureRequired: boolean;
    readonly expectedCommand: string;
    readonly evidenceState: ValidatorEvidenceState;
}
export interface MissingValidatorReport {
    readonly schemaId: 'atm.missingValidatorReport.v1';
    readonly taskId: string;
    readonly ok: boolean;
    readonly tldr: string;
    readonly totalRequired: number;
    readonly passedCount: number;
    readonly missingCount: number;
    readonly categories: {
        readonly absent: readonly string[];
        readonly failedRun: readonly string[];
        readonly stale: readonly string[];
        readonly diagnosticOnly: readonly string[];
    };
    /** Closure-required 缺失（advisory gates 不會進入此清單） */
    readonly missingValidationPasses: readonly MissingValidatorFinding[];
    /** Closure-required 中 absent + failed-run 的 hard blocker 子集 */
    readonly blockingFindings: readonly MissingValidatorFinding[];
    /** TASK-AAO-0017 follow-up：batch-tier advisory gate 缺失，不阻擋 close */
    readonly advisoryFindings: readonly MissingValidatorFinding[];
    readonly validators: readonly ValidatorCatalogEntry[];
}
export declare function classifyValidatorEvidenceState(bundle: readonly Record<string, unknown>[], gate: string): ValidatorEvidenceState;
export declare function buildMissingValidatorFinding(gate: string, state: Exclude<ValidatorEvidenceState, 'pass'>, taskId: string, actor: string, runnerKind: 'dev-source' | 'frozen-runner'): MissingValidatorFinding;
export declare function computeMissingValidatorReport(cwd: string, taskId: string, actorId: string): MissingValidatorReport;
export type AutoEvidenceDisposition = 'to-run' | 'already-satisfied' | 'skipped-out-of-scope' | 'requires-approval';
export interface AutoEvidencePlanEntry {
    readonly validator: string;
    readonly capability: 'validator' | 'integration-test';
    readonly catalogKey: string | null;
    readonly disposition: AutoEvidenceDisposition;
    readonly command: string | null;
    readonly evidenceState: ValidatorEvidenceState;
    readonly reason: string;
    readonly requiredCommand: string | null;
    readonly linkedValidators: readonly string[];
}
export interface AutoEvidencePlan {
    readonly schemaId: 'atm.autoEvidencePlan.v1';
    readonly taskId: string;
    readonly mode: 'dry-run' | 'execute';
    readonly ok: boolean;
    readonly toRun: readonly AutoEvidencePlanEntry[];
    readonly alreadySatisfied: readonly AutoEvidencePlanEntry[];
    readonly skippedOutOfScope: readonly AutoEvidencePlanEntry[];
    readonly requiresApproval: readonly AutoEvidencePlanEntry[];
    readonly remediationCommand: string | null;
}
export interface AutoEvidenceExecutionResult {
    readonly schemaId: 'atm.autoEvidenceExecution.v1';
    readonly taskId: string;
    readonly ok: boolean;
    readonly plan: AutoEvidencePlan;
    readonly runs: ReadonlyArray<{
        readonly validator: string;
        readonly command: string;
        readonly ok: boolean;
        readonly errorCode?: string;
    }>;
    readonly failedValidator: string | null;
    readonly remediationCommand: string | null;
}
