export interface GuardViolation {
    readonly guardId: string;
    readonly justification?: string;
}
export interface GuardJustificationInput {
    readonly violations: readonly GuardViolation[];
}
export interface RequiredJustification {
    readonly requiredGuardIds: readonly string[];
    readonly requiredEvidenceKinds: readonly string[];
    readonly humanReviewRequired: boolean;
    readonly rationale: string;
}
export interface GuardJustificationResult {
    readonly ok: boolean;
    readonly checkedViolations: number;
    readonly missingJustifications: readonly string[];
    readonly requiredJustification: RequiredJustification | null;
}
export declare function checkGuardJustification(input: GuardJustificationInput): GuardJustificationResult;
