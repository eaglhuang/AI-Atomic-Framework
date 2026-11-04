export declare const DIAGNOSTIC_LOOP_RECEIPT_SCHEMA_ID: "atm.diagnosticLoopReceipt.v1";
export type DiagnosticLoopSeverity = 'blocking' | 'non-blocking';
export interface DiagnosticLoopHypothesis {
    readonly id: string;
    readonly summary: string;
    readonly predictedObservation: string;
    readonly experimentCommand: string;
    readonly experimentResult: 'matched' | 'falsified' | 'inconclusive';
}
export interface DiagnosticLoopCommandObservation {
    readonly command: string;
    readonly exitCode: number;
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
}
export interface DiagnosticLoopReceiptInput {
    readonly taskId: string;
    readonly symptom: string;
    readonly severity: DiagnosticLoopSeverity;
    readonly reproducer: DiagnosticLoopCommandObservation;
    readonly symptomObserved: boolean;
    readonly reproductionRate: number;
    readonly minimizedFixture: string;
    readonly candidateDigest: string;
    readonly environmentDigest: string;
    readonly hypotheses: readonly DiagnosticLoopHypothesis[];
    readonly winningHypothesisId: string;
    readonly regressionCaseId: string;
    readonly greenEvidence: DiagnosticLoopCommandObservation;
    readonly temporaryInstrumentation: 'removed' | 'promoted' | 'none';
    readonly emergencyRationale?: {
        readonly reason: string;
        readonly expiresAt: string;
    } | null;
    readonly createdAt?: string | null;
}
export interface DiagnosticLoopReceipt {
    readonly schemaId: typeof DIAGNOSTIC_LOOP_RECEIPT_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none';
        readonly fromVersion: null;
        readonly notes: string;
    };
    readonly taskId: string;
    readonly symptom: string;
    readonly severity: DiagnosticLoopSeverity;
    readonly reproducer: DiagnosticLoopCommandObservation;
    readonly symptomObserved: boolean;
    readonly reproductionRate: number;
    readonly minimizedFixture: string;
    readonly candidateDigest: string;
    readonly environmentDigest: string;
    readonly hypotheses: readonly DiagnosticLoopHypothesis[];
    readonly winningHypothesisId: string;
    readonly regressionCaseId: string;
    readonly greenEvidence: DiagnosticLoopCommandObservation;
    readonly temporaryInstrumentation: 'removed' | 'promoted' | 'none';
    readonly emergencyRationale: {
        readonly reason: string;
        readonly expiresAt: string;
    } | null;
    readonly valid: boolean;
    readonly admission: 'admit-repair' | 'fail-closed';
    readonly reasons: readonly string[];
    readonly receiptDigest: string;
    readonly createdAt: string;
}
export declare function evaluateDiagnosticLoopReceipt(input: DiagnosticLoopReceiptInput): DiagnosticLoopReceipt;
