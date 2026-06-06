/**
 * gates.ts
 *
 * TASK-ASR-0012 — propose.ts 完整拆分
 *
 * 所有 upgrade proposal gate builders。每個 gate 決定一個面向
 * 的升級條件是否通過，結果統一為 { passed, reportId, reportPath, summary }。
 */
export declare function normalizeGateResult(gate: any, gateName: any): {
    passed: any;
    reportId: any;
    reportPath: any;
    summary: any;
} | null;
export declare function buildGateResult(gateName: any, report: any, reportPath: any, successSummary: any): {
    passed: boolean;
    reportId: any;
    reportPath: any;
    summary: string;
};
export declare function buildQualityComparisonGate(report: any, reportPath: any): {
    passed: any;
    reportId: any;
    reportPath: any;
    summary: string;
};
export declare function buildRegistryCandidateGate(report: any, reportPath: any): {
    passed: boolean;
    reportId: any;
    reportPath: any;
    summary: string;
};
export declare function buildMapEquivalenceGate(target: any, requestedReplacementMode: any, input: any): {
    passed: boolean;
    reportId: any;
    reportPath: any;
    summary: string;
} | null;
export declare function buildPolymorphImpactGate(target: any, requestedReplacementMode: any, repositoryRoot: any, toVersion: any, input: any): {
    passed: boolean;
    reportId: any;
    reportPath: any;
    summary: string;
} | null;
export declare function buildRollbackProofGate(target: any, requestedReplacementMode: any, input: any): {
    passed: boolean;
    reportId: any;
    reportPath: any;
    summary: string;
} | null;
export declare function buildPropagationReportGate(target: any, requestedReplacementMode: any, atomId: any, input: any): {
    passed: boolean;
    reportId: any;
    reportPath: any;
    summary: string;
} | null;
export declare function buildReviewAdvisoryGate(target: any, requestedReplacementMode: any, proposalId: any, input: any): {
    passed: boolean;
    reportId: any;
    reportPath: any;
    summary: string;
} | null;
export declare function buildHumanReviewGate(target: any, requestedReplacementMode: any, proposalId: any, atomId: any, input: any): {
    passed: boolean;
    reportId: any;
    reportPath: any;
    summary: string;
} | null;
export declare function buildRetirementProofGate(target: any, requestedReplacementMode: any, input: any): {
    passed: boolean;
    reportId: any;
    reportPath: any;
    summary: string;
} | null;
