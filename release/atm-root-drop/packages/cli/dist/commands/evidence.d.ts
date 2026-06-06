export type EvidenceGate = 'close' | 'commit' | 'pr';
type CanonicalEvidenceKind = 'test' | 'artifact' | 'attestation' | 'review' | 'commit' | 'waiver' | 'other';
export interface EvidenceGateResult {
    readonly ok: boolean;
    readonly gate: EvidenceGate;
    readonly total: number;
    readonly counts: Readonly<Record<CanonicalEvidenceKind, number>>;
    readonly freshCount: number;
    readonly commandRunEvidenceCount: number;
    readonly reopenedRedteamTask: boolean;
    readonly codeOrFrameworkTask: boolean;
    readonly missing: readonly string[];
}
export declare function runEvidence(argv: string[]): Promise<import("./shared.ts").CommandResult>;
/** validator tier 說明
 * - focused: 必須每次 task 重跑，例如 typecheck、validate:cli、validate:git-head-evidence
 * - batch: cache key 未變時可跨 task 重用，例如 framework-development、tasks-audit、doctor
 * - release: 只在 release task 需要，例如 validate:root-drop-release
 */
type ValidatorTier = 'focused' | 'batch' | 'milestone' | 'release';
export type ValidatorEvidenceState = 'pass' | 'absent' | 'failed-run' | 'stale' | 'diagnostic-only';
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
/**
 * TASK-AAO-0017: 計算缺失 validator 報告，可被 tasks close / batch checkpoint 的錯誤訊息引用，
 * 也可獨立供 `evidence missing` 子命令呼叫。
 */
export declare function computeMissingValidatorReport(cwd: string, taskId: string, actorId: string): MissingValidatorReport;
export declare function verifyTaskEvidence(input: {
    cwd: string;
    taskId: string;
    gate: EvidenceGate;
    taskDocument?: Record<string, unknown> | null;
    taskDeclaredFiles?: readonly string[];
    frameworkTask?: boolean;
}): EvidenceGateResult;
export declare function quoteForShell(arg: string): string;
export declare function detectAutoLinkedValidator(command: string): string | null;
export {};
