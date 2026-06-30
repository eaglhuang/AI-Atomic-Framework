function asRetirementProofRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
export function validateRetirementProof(proof) {
    const record = asRetirementProofRecord(proof);
    const issues = [];
    if (record?.fromMode !== 'active') {
        issues.push('retirement proof must start from active mode.');
    }
    if (record?.toMode !== 'legacy-retired') {
        issues.push('retirement proof must target legacy-retired mode.');
    }
    if (record?.callerRiskCleared !== true) {
        issues.push('caller risk must be cleared.');
    }
    if (record?.entrypointRiskCleared !== true) {
        issues.push('entrypoint risk must be cleared.');
    }
    if (Array.isArray(record?.unresolvedCallers) && record.unresolvedCallers.length > 0) {
        issues.push('retirement proof still has unresolved callers.');
    }
    if (Array.isArray(record?.unresolvedEntrypoints) && record.unresolvedEntrypoints.length > 0) {
        issues.push('retirement proof still has unresolved entrypoints.');
    }
    return {
        ok: issues.length === 0,
        issues
    };
}
export function createRetirementProof(options) {
    const unresolvedCallers = normalizeStringArray(options.unresolvedCallers);
    const unresolvedEntrypoints = normalizeStringArray(options.unresolvedEntrypoints);
    const verificationStatus = options.callerRiskCleared === true
        && options.entrypointRiskCleared === true
        && unresolvedCallers.length === 0
        && unresolvedEntrypoints.length === 0
        ? 'passed'
        : 'failed';
    return {
        schemaId: 'atm.retirementProof',
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'Initial retirement proof contract.'
        },
        proofId: `retirement-proof.${String(options.mapId).toLowerCase()}`,
        mapId: options.mapId,
        ...(options.mapVersion ? { mapVersion: options.mapVersion } : {}),
        fromMode: 'active',
        toMode: 'legacy-retired',
        verifiedAt: options.verifiedAt,
        verifiedBy: options.verifiedBy,
        retiredLegacyUris: normalizeStringArray(options.retiredLegacyUris),
        callerRiskCleared: options.callerRiskCleared,
        entrypointRiskCleared: options.entrypointRiskCleared,
        unresolvedCallers,
        unresolvedEntrypoints,
        reviewAdvisoryRefs: normalizeStringArray(options.reviewAdvisoryRefs),
        ...(options.notes ? { notes: options.notes } : {}),
        verificationStatus,
        ...(verificationStatus === 'failed' ? { failureReason: 'Retirement proof validation failed.' } : {})
    };
}
function normalizeStringArray(values) {
    return [...new Set((Array.isArray(values) ? values : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean))];
}
