export declare const TDD_CYCLE_RECEIPT_SCHEMA_ID: "atm.tddCycleReceipt.v1";
export declare const TDD_LIFECYCLE_BINDING_SCHEMA_ID: "atm.tddLifecycleBinding.v1";
export declare const TDD_SUCCESS_RATE_SCHEMA_ID: "atm.tddSuccessRate.v1";
export declare const TDD_MODES: readonly ["required", "recommended", "reasoned-not-applicable"];
export type TddMode = (typeof TDD_MODES)[number];
export declare const TDD_PHASES: readonly ["red", "green"];
export type TddPhase = (typeof TDD_PHASES)[number];
export declare const TDD_FAILURE_CLASSES: readonly ["assertion-failure", "syntax", "setup", "environment", "unrelated", "digest-mismatch", "case-mismatch"];
export type TddFailureClass = (typeof TDD_FAILURE_CLASSES)[number];
export declare const TDD_EXEMPTION_KINDS: readonly ["mechanical", "docs", "advisory", "quarantined"];
export type TddExemptionKind = (typeof TDD_EXEMPTION_KINDS)[number];
/** Binding identity that red and green must share for one case proof. */
export interface TddCaseBinding {
    readonly caseId: string;
    readonly testDigest: string;
    readonly acceptanceIds: readonly string[];
    readonly publicSeam: string;
    /** Sealed baseline SHA the red phase executes against. */
    readonly baselineSha: string;
    /** Sealed candidate SHA for green; null while proving red on baseline. */
    readonly candidateSha: string | null;
}
export interface TddPhaseObservation {
    readonly phase: TddPhase;
    readonly binding: TddCaseBinding;
    readonly exitCode: number;
    readonly commandOk: boolean;
    readonly failureClass?: TddFailureClass | null;
    readonly failureReason?: string | null;
    readonly executedCaseCount: number;
    readonly assertionCount: number;
    readonly advisory?: boolean | null;
    readonly quarantineStatus?: string | null;
    readonly expectedRedPredicate?: string | null;
}
export interface TddPhaseReceipt {
    readonly schemaId: typeof TDD_CYCLE_RECEIPT_SCHEMA_ID;
    readonly phase: TddPhase;
    readonly binding: TddCaseBinding;
    readonly valid: boolean;
    readonly countsAsRed: boolean;
    readonly countsAsGreen: boolean;
    readonly failureClass: TddFailureClass | null;
    readonly reasons: readonly string[];
    readonly bindingDigest: string;
}
export interface TddLifecycleBindingResult {
    readonly schemaId: typeof TDD_LIFECYCLE_BINDING_SCHEMA_ID;
    readonly ok: boolean;
    readonly caseId: string;
    readonly testDigest: string;
    readonly acceptanceIds: readonly string[];
    readonly publicSeam: string;
    readonly baselineSha: string;
    readonly candidateSha: string;
    readonly red: TddPhaseReceipt;
    readonly green: TddPhaseReceipt;
    readonly reasons: readonly string[];
}
export interface TddExemptionDeclaration {
    readonly caseId: string;
    readonly kind: TddExemptionKind;
    readonly reason: string;
    readonly reviewed: boolean;
    readonly reviewActorId?: string | null;
}
export interface TddCaseOutcome {
    readonly caseId: string;
    readonly lifecycleComplete: boolean;
    readonly exemption?: TddExemptionDeclaration | null;
    readonly advisory?: boolean | null;
    readonly quarantineStatus?: string | null;
}
export interface TddSuccessRateReport {
    readonly schemaId: typeof TDD_SUCCESS_RATE_SCHEMA_ID;
    readonly eligibleCount: number;
    readonly successCount: number;
    readonly excludedCount: number;
    readonly rate: number | null;
    readonly excludedCaseIds: readonly string[];
    readonly eligibleCaseIds: readonly string[];
    readonly successCaseIds: readonly string[];
}
export interface TddTaskLifecycleResult {
    readonly ok: boolean;
    readonly tddMode: TddMode;
    readonly bindings: readonly TddLifecycleBindingResult[];
    readonly successRate: TddSuccessRateReport;
    readonly reasons: readonly string[];
}
export declare function isTddMode(value: unknown): value is TddMode;
export declare function parseTddMode(raw: unknown): TddMode | null;
export declare function bindingDigest(binding: TddCaseBinding): string;
/**
 * Classify a failed observation. Explicit failureClass wins; otherwise infer
 * from failureReason / exit semantics. Only assertion-failure may count as red.
 */
export declare function classifyTddFailure(input: {
    readonly exitCode: number;
    readonly commandOk: boolean;
    readonly failureClass?: TddFailureClass | null;
    readonly failureReason?: string | null;
    readonly expectedCaseId?: string | null;
    readonly observedCaseId?: string | null;
    readonly expectedTestDigest?: string | null;
    readonly observedTestDigest?: string | null;
}): TddFailureClass;
export declare function evaluateTddPhaseReceipt(observation: TddPhaseObservation): TddPhaseReceipt;
export declare function bindRedGreenLifecycle(input: {
    readonly red: TddPhaseObservation;
    readonly green: TddPhaseObservation;
}): TddLifecycleBindingResult;
/**
 * One task may prove multiple integration case IDs. Exemptions that are
 * mechanical/docs/advisory/quarantined are excluded from success-rate inflation.
 */
export declare function evaluateTddSuccessRate(outcomes: readonly TddCaseOutcome[]): TddSuccessRateReport;
export declare function isExcludedFromTddSuccessRate(outcome: TddCaseOutcome): boolean;
export declare function evaluateTaskTddLifecycle(input: {
    readonly tddMode: TddMode;
    readonly notApplicableReason?: string | null;
    readonly pairs: readonly {
        red: TddPhaseObservation;
        green: TddPhaseObservation;
    }[];
    readonly exemptions?: readonly TddExemptionDeclaration[];
}): TddTaskLifecycleResult;
