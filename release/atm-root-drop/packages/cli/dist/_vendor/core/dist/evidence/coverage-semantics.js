export const QUALITY_CERTIFICATE_SCHEMA_ID = 'atm.qualityCertificate.v1';
const GAP_STATUSES = new Set(['blocked', 'unknown', 'stale']);
export function createQualityCertificate(input) {
    return {
        schemaId: QUALITY_CERTIFICATE_SCHEMA_ID,
        specVersion: '0.1.0',
        modelRelative: true,
        ...input,
        assumptions: normalizeAssumptions(input.assumptions),
        exclusions: normalizeExclusions(input.exclusions),
        obligationSummary: normalizeObligationSummary(input.obligationSummary),
        evidenceRefs: uniqueStrings(input.evidenceRefs),
        notes: uniqueStrings(input.notes)
    };
}
export function validateQualityCertificate(certificate) {
    const diagnostics = [];
    if (!certificate.certificateId?.trim()) {
        diagnostics.push(error('ATM_QUALITY_CERTIFICATE_ID_MISSING', 'certificateId is required.', 'certificateId'));
    }
    if (!certificate.model?.modelId?.trim()) {
        diagnostics.push(error('ATM_QUALITY_CERTIFICATE_MODEL_MISSING', 'A quality certificate must name its coverage model.', 'model.modelId'));
    }
    if (certificate.modelRelative !== true) {
        diagnostics.push(error('ATM_QUALITY_CERTIFICATE_NOT_MODEL_RELATIVE', 'Coverage claims must be explicitly model-relative.', 'modelRelative'));
    }
    if (!Number.isFinite(certificate.coverageRatio) || certificate.coverageRatio < 0 || certificate.coverageRatio > 1) {
        diagnostics.push(error('ATM_QUALITY_CERTIFICATE_RATIO_INVALID', 'coverageRatio must be between 0 and 1.', 'coverageRatio'));
    }
    const summary = summarizeQualityCertificate(certificate);
    if (certificate.coverageRatio === 1 && certificate.claimKind === 'finite-model-proven') {
        if (summary.gapCount > 0 || summary.unsupportedCount > 0) {
            diagnostics.push(error('ATM_QUALITY_CERTIFICATE_ABSOLUTE_100_WITH_GAPS', 'A finite-model-proven 100% claim cannot contain open gaps or unsupported obligations.', 'obligationSummary'));
        }
        if (summary.assumptionCount === 0 && summary.exclusionCount === 0 && !certificate.model.digest) {
            diagnostics.push(error('ATM_QUALITY_CERTIFICATE_UNQUALIFIED_100', 'A 100% claim must name the model digest, assumptions, or exclusions that bound the claim.', 'coverageRatio'));
        }
    }
    if (certificate.claimKind === 'sufficient-under-assumptions' && summary.assumptionCount === 0) {
        diagnostics.push(error('ATM_QUALITY_CERTIFICATE_ASSUMPTIONS_MISSING', 'A sufficient-under-assumptions claim must list the assumptions that make it sufficient.', 'assumptions'));
    }
    if (certificate.claimKind === 'unsupported' && summary.unsupportedCount === 0) {
        diagnostics.push(warning('ATM_QUALITY_CERTIFICATE_UNSUPPORTED_WITHOUT_UNSUPPORTED_OBLIGATIONS', 'Unsupported certificate status should normally include unsupported obligations.', 'obligationSummary'));
    }
    return {
        ok: diagnostics.every((entry) => entry.severity !== 'error'),
        diagnostics,
        terminalStatus: certificate.claimKind
    };
}
export function summarizeQualityCertificate(certificate) {
    const countFor = (predicate) => certificate.obligationSummary
        .filter((entry) => predicate(entry.status))
        .reduce((total, entry) => total + Math.max(0, Math.floor(entry.count)), 0);
    return {
        certificateId: certificate.certificateId,
        modelId: certificate.model.modelId,
        claimKind: certificate.claimKind,
        coverageRatio: certificate.coverageRatio,
        provenCount: countFor((status) => status === 'proven' || status === 'sufficient-under-assumptions'),
        gapCount: countFor((status) => GAP_STATUSES.has(status)),
        unsupportedCount: countFor((status) => status === 'unsupported'),
        assumptionCount: certificate.assumptions?.length ?? 0,
        exclusionCount: certificate.exclusions?.length ?? 0,
        modelRelative: true
    };
}
function normalizeObligationSummary(values) {
    return [...values]
        .map((entry) => ({ status: entry.status, count: Math.max(0, Math.floor(Number(entry.count) || 0)) }))
        .filter((entry) => entry.count > 0)
        .sort((left, right) => left.status.localeCompare(right.status));
}
function normalizeAssumptions(values = []) {
    return [...values]
        .map((entry) => ({ id: String(entry.id ?? '').trim(), statement: String(entry.statement ?? '').trim() }))
        .filter((entry) => entry.id && entry.statement)
        .sort((left, right) => left.id.localeCompare(right.id));
}
function normalizeExclusions(values = []) {
    return [...values]
        .map((entry) => ({ id: String(entry.id ?? '').trim(), reason: String(entry.reason ?? '').trim() }))
        .filter((entry) => entry.id && entry.reason)
        .sort((left, right) => left.id.localeCompare(right.id));
}
function uniqueStrings(values = []) {
    return [...new Set(values.map((entry) => String(entry ?? '').trim()).filter(Boolean))].sort();
}
function error(code, message, ref) {
    return { code, severity: 'error', message, ref };
}
function warning(code, message, ref) {
    return { code, severity: 'warning', message, ref };
}
