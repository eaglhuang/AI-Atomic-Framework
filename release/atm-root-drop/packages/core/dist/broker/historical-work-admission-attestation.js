import { createHash } from 'node:crypto';
export const HISTORICAL_WORK_ADMISSION_ATTESTATION_SCHEMA = 'atm.historicalWorkAdmissionAttestation.v1';
// The authority has one durable ledger, owned by its originating GIT task.
// Keeping it task-prefixed makes ordinary task scope and close bundles able to
// account for every forward correction without a global evidence bypass.
export const HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH = '.atm/history/evidence/TASK-GIT-0024.historical-work-admission-attestations.json';
export const HISTORICAL_WORK_ADMISSION_ERROR_CODES = {
    required: 'ATM_WRITE_TICKET_HISTORICAL_ATTESTATION_REQUIRED',
    invalid: 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_INVALID',
    terminalOwnershipInconsistent: 'ATM_TERMINAL_LIFECYCLE_OWNERSHIP_INCONSISTENT'
};
function normalized(value) {
    return String(value ?? '').trim();
}
function canonicalPayload(record) {
    return JSON.stringify({
        schemaId: record.schemaId,
        commitSha: record.commitSha,
        parentCommitSha: record.parentCommitSha,
        treeSha: record.treeSha,
        provenance: { kind: record.provenance.kind, digest: record.provenance.digest, ref: record.provenance.ref },
        taskId: record.taskId,
        laneSessionId: record.laneSessionId,
        attestedBy: record.attestedBy,
        attestedAt: record.attestedAt
    });
}
export function digestHistoricalWorkAdmissionAttestation(record) {
    return `sha256:${createHash('sha256').update(canonicalPayload(record)).digest('hex')}`;
}
export function createHistoricalWorkAdmissionAttestation(input) {
    const record = { schemaId: HISTORICAL_WORK_ADMISSION_ATTESTATION_SCHEMA, ...input };
    return { ...record, digest: digestHistoricalWorkAdmissionAttestation(record) };
}
function isWellFormed(record) {
    const { digest: _digest, ...unsigned } = record;
    return record.schemaId === HISTORICAL_WORK_ADMISSION_ATTESTATION_SCHEMA
        && /^[a-f0-9]{7,64}$/i.test(record.commitSha)
        && /^[a-f0-9]{7,64}$/i.test(record.parentCommitSha)
        && /^[a-f0-9]{7,64}$/i.test(record.treeSha)
        && (record.provenance.kind === 'ticket' || record.provenance.kind === 'emergency')
        && /^sha256:[a-f0-9]{64}$/i.test(record.provenance.digest)
        && normalized(record.provenance.ref).length > 0
        && normalized(record.taskId).length > 0
        && normalized(record.laneSessionId).length > 0
        && normalized(record.attestedBy).length > 0
        && !Number.isNaN(Date.parse(record.attestedAt))
        && record.digest === digestHistoricalWorkAdmissionAttestation(unsigned);
}
/**
 * Single fail-closed authority shared by the correction command and range gate.
 * A forward record never edits the historical commit: it merely proves exactly
 * which immutable object and contemporary provenance were reviewed.
 */
export function evaluateHistoricalWorkAdmission(input) {
    if (input.hasNormalWorkAdmissionTrailer) {
        return { decision: 'covered', code: null, reason: 'Commit has normal ATM-Work-Admission coverage.', attestation: null };
    }
    const matching = input.attestations.filter((record) => record.commitSha === input.commit.commitSha);
    if (matching.length === 0) {
        return { decision: 'missing', code: HISTORICAL_WORK_ADMISSION_ERROR_CODES.required, reason: 'Critical historical commit has neither a normal ticket trailer nor an exact forward attestation.', attestation: null };
    }
    const valid = matching.filter((record) => isWellFormed(record)
        && record.parentCommitSha === input.commit.parentCommitSha
        && record.treeSha === input.commit.treeSha
        && input.commit.isAncestorOfHead
        && (input.isProvenanceValid?.(record) ?? true));
    if (valid.length !== 1 || matching.length !== 1) {
        return { decision: 'invalid', code: HISTORICAL_WORK_ADMISSION_ERROR_CODES.invalid, reason: 'Historical attestation is malformed, no longer matches the immutable commit, targets a non-ancestor, or conflicts with another attestation.', attestation: null };
    }
    return { decision: 'covered', code: null, reason: 'Exact historical work-admission attestation covers the immutable commit.', attestation: valid[0] };
}
/** One ownership meaning for hooks, cross-task guard, and repair diagnostics. */
export function classifyTerminalLifecycleOwnership(input) {
    const status = normalized(input.status).toLowerCase().replace(/-/g, '_');
    const claimState = normalized(input.claimState).toLowerCase();
    const terminal = new Set(['done', 'abandoned', 'blocked']);
    if (!terminal.has(status)) {
        return claimState === 'active'
            ? { decision: 'active', reason: 'Non-terminal task has an active claim.' }
            : { decision: 'inconsistent', reason: 'Non-terminal task has no active claim.' };
    }
    if (input.lockReleased && (claimState === 'released' || claimState.length === 0)) {
        return {
            decision: 'terminal',
            reason: claimState === 'released'
                ? 'Terminal task has both a released claim and a released direction lock.'
                : 'Legacy terminal task has no claim record and no active direction lock.'
        };
    }
    return { decision: 'inconsistent', reason: 'Terminal task must have a released claim and released direction lock.' };
}
