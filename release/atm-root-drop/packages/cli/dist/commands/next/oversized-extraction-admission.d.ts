import type { PhysicalLineBudgetReport } from '../git-governance/commit-scope-policy.ts';
export interface OversizedExtractionAdmissionDecision {
    readonly allowed: boolean;
    readonly reason: string;
    readonly metadata: Record<string, unknown>;
}
export declare function evaluateOversizedExtractionClaimAdmission(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly taskPath: string;
    readonly report: PhysicalLineBudgetReport;
}): OversizedExtractionAdmissionDecision;
export declare function assertClaimLineBudgetOrExtractionAdmission(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly taskPath: string;
    readonly report: PhysicalLineBudgetReport;
}): Record<string, unknown> | null;
