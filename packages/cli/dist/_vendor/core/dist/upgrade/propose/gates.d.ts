/**
 * gates.ts
 *
 * TASK-ASR-0012 — propose.ts 完整拆分
 *
 * 所有 upgrade proposal gate builders。每個 gate 決定一個面向
 * 的升級條件是否通過，結果統一為 { passed, reportId, reportPath, summary }。
 */
/** Normalised gate result returned by all gate builders */
export interface GateResult {
    passed: boolean;
    reportId: string;
    reportPath: string;
    summary: string;
}
/** Raw gate object supplied by callers before normalisation */
interface RawGate {
    passed?: unknown;
    reportId?: unknown;
    reportPath?: unknown;
    summary?: unknown;
}
/** Target descriptor passed to gate builders */
interface GateTarget {
    kind: string;
    mapId: string;
}
/** Generic report-file input holding a parsed document and its file path */
interface ReportInput {
    document: Record<string, unknown> | null | undefined;
    path: string;
}
export declare function normalizeGateResult(gate: RawGate | null | undefined, gateName: string): GateResult | null;
export declare function buildGateResult(gateName: string, report: Record<string, unknown> | null | undefined, reportPath: string, successSummary: string): GateResult;
export declare function buildQualityComparisonGate(report: Record<string, unknown> | null | undefined, reportPath: string): GateResult;
export declare function buildRegistryCandidateGate(report: Record<string, unknown> | null | undefined, reportPath: string): GateResult;
export declare function buildMapEquivalenceGate(target: GateTarget, requestedReplacementMode: string, input: ReportInput | null | undefined): GateResult | null;
export declare function buildPolymorphImpactGate(target: GateTarget, requestedReplacementMode: string, repositoryRoot: string, toVersion: string, input: ReportInput | null | undefined): GateResult | null;
export declare function buildRollbackProofGate(target: GateTarget, requestedReplacementMode: string, input: ReportInput | null | undefined): GateResult | null;
export declare function buildPropagationReportGate(target: GateTarget, requestedReplacementMode: string, atomId: string, input: ReportInput | null | undefined): GateResult | null;
export declare function buildReviewAdvisoryGate(target: GateTarget, requestedReplacementMode: string, proposalId: string, input: ReportInput | null | undefined): GateResult | null;
export declare function buildHumanReviewGate(target: GateTarget, requestedReplacementMode: string, proposalId: string, atomId: string, input: ReportInput | null | undefined): GateResult | null;
export declare function buildRetirementProofGate(target: GateTarget, requestedReplacementMode: string, input: ReportInput | null | undefined): GateResult | null;
export {};
