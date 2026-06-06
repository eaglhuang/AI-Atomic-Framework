const atomIdPattern = /^ATM-[A-Z][A-Z0-9]*-\d{4}$/;
const mapIdPattern = /^ATM-MAP-\d{4}$/;
const legacyUriPattern = /^[a-z][a-z0-9+.-]*:\/\/.+/;
const validEdgeKinds = new Set(['data-flow', 'control-flow', 'event-flow', 'validation', 'fallback', 'side-effect', 'rollback']);
export function createScopeLockRecord(input) {
    const files = normalizeStringArray(input?.files, 'files');
    const selectors = normalizeSelectors(input?.selectors);
    const inferredSpecVersion = selectors ? '0.2.0' : '0.1.0';
    const specVersion = normalizeSpecVersion(input?.specVersion ?? inferredSpecVersion, Boolean(selectors));
    return {
        schemaId: 'atm.governanceScopeLock',
        specVersion,
        migration: normalizeMigration(input?.migration, specVersion),
        workItemId: normalizePatternString(input?.workItemId, atomIdPattern, 'workItemId'),
        lockedBy: normalizeNonEmptyString(input?.lockedBy, 'lockedBy'),
        lockedAt: normalizeNonEmptyString(input?.lockedAt, 'lockedAt'),
        files,
        ...(typeof input?.reason === 'string' && input.reason.trim().length > 0 ? { reason: input.reason.trim() } : {}),
        ...(selectors ? { selectors } : {})
    };
}
export function parseScopeLockRecord(document) {
    return createScopeLockRecord(document);
}
export function hasMapSelectors(scopeLock) {
    return Boolean(scopeLock.selectors && Object.keys(scopeLock.selectors).length > 0);
}
function normalizeSpecVersion(value, hasSelectors) {
    const specVersion = typeof value === 'string' ? value.trim() : '';
    if (specVersion !== '0.1.0' && specVersion !== '0.2.0') {
        throw new Error(`Scope lock specVersion must be 0.1.0 or 0.2.0; received ${String(value ?? '') || '[empty]'}.`);
    }
    if (hasSelectors && specVersion !== '0.2.0') {
        throw new Error('Scope lock selectors require specVersion 0.2.0.');
    }
    return specVersion;
}
function normalizeMigration(migration, specVersion) {
    const strategy = typeof migration?.strategy === 'string' && migration.strategy.trim().length > 0
        ? migration.strategy.trim()
        : (specVersion === '0.2.0' ? 'additive' : 'none');
    const fromVersion = migration?.fromVersion == null ? null : normalizeSemver(migration.fromVersion, 'migration.fromVersion');
    const notes = typeof migration?.notes === 'string' && migration.notes.trim().length > 0
        ? migration.notes.trim()
        : (specVersion === '0.2.0'
            ? 'Scope lock 0.2.0 adds map selectors while preserving 0.1.0 file locks.'
            : 'Scope lock baseline record.');
    return {
        strategy,
        fromVersion,
        notes
    };
}
function normalizeSelectors(value) {
    if (value == null) {
        return null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Scope lock selectors must be an object.');
    }
    const selectors = {
        ...(value.mapId ? { mapId: normalizePatternString(value.mapId, mapIdPattern, 'selectors.mapId') } : {}),
        ...(value.mapMembers ? { mapMembers: normalizeAtomIdArray(value.mapMembers, 'selectors.mapMembers') } : {}),
        ...(value.mapEdges ? { mapEdges: normalizeEdgeSelectors(value.mapEdges) } : {}),
        ...(value.mapEntrypoints ? { mapEntrypoints: normalizeAtomIdArray(value.mapEntrypoints, 'selectors.mapEntrypoints') } : {}),
        ...(value.legacyUris ? { legacyUris: normalizeLegacyUris(value.legacyUris) } : {})
    };
    if (Object.keys(selectors).length === 0) {
        throw new Error('Scope lock selectors must declare at least one map selector.');
    }
    return selectors;
}
function normalizeEdgeSelectors(value) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error('selectors.mapEdges must be a non-empty array.');
    }
    return value.map((entry, index) => {
        const from = normalizePatternString(entry?.from, atomIdPattern, `selectors.mapEdges[${index}].from`);
        const to = normalizePatternString(entry?.to, atomIdPattern, `selectors.mapEdges[${index}].to`);
        const edgeKind = entry?.edgeKind == null ? undefined : normalizeEdgeKind(entry.edgeKind, `selectors.mapEdges[${index}].edgeKind`);
        return {
            from,
            to,
            ...(edgeKind ? { edgeKind } : {})
        };
    });
}
function normalizeEdgeKind(value, fieldName) {
    const normalized = normalizeNonEmptyString(value, fieldName);
    if (!validEdgeKinds.has(normalized)) {
        throw new Error(`${fieldName} must be one of ${[...validEdgeKinds].join(', ')}.`);
    }
    return normalized;
}
function normalizeAtomIdArray(value, fieldName) {
    return normalizeStringArray(value, fieldName).map((entry, index) => normalizePatternString(entry, atomIdPattern, `${fieldName}[${index}]`));
}
function normalizeLegacyUris(value) {
    return normalizeStringArray(value, 'selectors.legacyUris').map((entry, index) => normalizePatternString(entry, legacyUriPattern, `selectors.legacyUris[${index}]`));
}
function normalizeStringArray(value, fieldName) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`${fieldName} must be a non-empty array.`);
    }
    return [...new Set(value.map((entry) => normalizeNonEmptyString(entry, fieldName)))];
}
function normalizePatternString(value, pattern, fieldName) {
    const normalized = normalizeNonEmptyString(value, fieldName);
    if (!pattern.test(normalized)) {
        throw new Error(`${fieldName} is invalid: ${normalized}`);
    }
    return normalized;
}
function normalizeNonEmptyString(value, fieldName) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${fieldName} must be a non-empty string.`);
    }
    return value.trim();
}
function normalizeSemver(value, fieldName) {
    const normalized = normalizeNonEmptyString(value, fieldName);
    if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
        throw new Error(`${fieldName} must be semver.`);
    }
    return normalized;
}
