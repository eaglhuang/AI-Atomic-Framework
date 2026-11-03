export declare const HISTORICAL_WORK_ADMISSION_ATTESTATION_SCHEMA: "atm.historicalWorkAdmissionAttestation.v1";
export declare const HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH: ".atm/history/evidence/TASK-GIT-0024.historical-work-admission-attestations.json";
export declare const HISTORICAL_WORK_ADMISSION_ERROR_CODES: {
    readonly required: "ATM_WRITE_TICKET_HISTORICAL_ATTESTATION_REQUIRED";
    readonly invalid: "ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_INVALID";
    readonly terminalOwnershipInconsistent: "ATM_TERMINAL_LIFECYCLE_OWNERSHIP_INCONSISTENT";
};
export type HistoricalAdmissionDecision = 'covered' | 'missing' | 'invalid';
export interface HistoricalWorkAdmissionAttestation {
    readonly schemaId: typeof HISTORICAL_WORK_ADMISSION_ATTESTATION_SCHEMA;
    readonly commitSha: string;
    readonly parentCommitSha: string;
    readonly treeSha: string;
    readonly provenance: {
        readonly kind: 'ticket' | 'emergency';
        readonly digest: string;
        readonly ref: string;
    };
    readonly reason?: string;
    readonly evidenceRefs?: readonly string[];
    readonly emergencyClass?: string;
    readonly scope?: readonly string[];
    readonly taskId: string;
    readonly laneSessionId: string;
    readonly attestedBy: string;
    readonly attestedAt: string;
    readonly digest: string;
}
export interface HistoricalCommitIdentity {
    readonly commitSha: string;
    readonly parentCommitSha: string;
    readonly treeSha: string;
    readonly isAncestorOfHead: boolean;
}
export interface HistoricalAdmissionEvaluation {
    readonly decision: HistoricalAdmissionDecision;
    readonly code: string | null;
    readonly reason: string;
    readonly attestation: HistoricalWorkAdmissionAttestation | null;
}
export interface ForwardAttestationCommitInput {
    readonly commitSha: string;
    readonly parentCommitSha: string;
    readonly treeSha: string;
}
export interface ForwardAttestationInput {
    readonly taskId: string;
    readonly commit: ForwardAttestationCommitInput;
    readonly provenance: {
        readonly kind: 'ticket' | 'emergency';
        readonly digest: string;
        readonly ref: string;
    };
    readonly laneSessionId: string;
    readonly attestedBy: string;
    readonly attestedAt: string;
    readonly reason?: string | null;
    readonly evidenceRefs?: readonly string[];
    readonly emergencyClass?: string | null;
    readonly scope?: readonly string[];
}
export interface TerminalLifecycleOwnership {
    readonly decision: 'active' | 'terminal' | 'inconsistent';
    readonly reason: string;
}
export declare function digestHistoricalWorkAdmissionAttestation(record: Omit<HistoricalWorkAdmissionAttestation, 'digest'>): string;
export declare function createHistoricalWorkAdmissionAttestation(input: Omit<HistoricalWorkAdmissionAttestation, 'schemaId' | 'digest'>): HistoricalWorkAdmissionAttestation;
export declare function createForwardAttestation(input: ForwardAttestationInput): HistoricalWorkAdmissionAttestation;
export declare function validateHistoricalWorkAdmissionAttestationRecord(record: HistoricalWorkAdmissionAttestation): HistoricalAdmissionEvaluation;
/**
 * Single fail-closed authority shared by the correction command and range gate.
 * A forward record never edits the historical commit: it merely proves exactly
 * which immutable object and contemporary provenance were reviewed.
 */
export declare function evaluateHistoricalWorkAdmission(input: {
    readonly commit: HistoricalCommitIdentity;
    readonly hasNormalWorkAdmissionTrailer: boolean;
    readonly attestations: readonly HistoricalWorkAdmissionAttestation[];
    readonly isProvenanceValid?: (record: HistoricalWorkAdmissionAttestation) => boolean;
}): HistoricalAdmissionEvaluation;
/** One ownership meaning for hooks, cross-task guard, and repair diagnostics. */
export declare function classifyTerminalLifecycleOwnership(input: {
    readonly status: unknown;
    readonly claimState: unknown;
    readonly lockReleased: boolean;
}): TerminalLifecycleOwnership;
