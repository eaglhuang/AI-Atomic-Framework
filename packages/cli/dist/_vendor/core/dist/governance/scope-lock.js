const atomIdPattern = /^ATM-[A-Z][A-Z0-9]*-\d{4}$/;
const mapIdPattern = /^ATM-MAP-\d{4}$/;
const legacyUriPattern = /^[a-z][a-z0-9+.-]*:\/\/.+/;
const validEdgeKinds = new Set(['data-flow', 'control-flow', 'event-flow', 'validation', 'fallback', 'side-effect', 'rollback']);
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
export function createScopeLockRecord(input) {
    const record = asRecord(input);
    const files = normalizeStringArray(record?.files, 'files');
    const selectors = normalizeSelectors(record?.selectors);
    const inferredSpecVersion = selectors ? '0.2.0' : '0.1.0';
    const specVersion = normalizeSpecVersion(record?.specVersion ?? inferredSpecVersion, Boolean(selectors));
    return {
        schemaId: 'atm.governanceScopeLock',
        specVersion,
        migration: normalizeMigration(record?.migration, specVersion),
        workItemId: normalizePatternString(record?.workItemId, atomIdPattern, 'workItemId'),
        lockedBy: normalizeNonEmptyString(record?.lockedBy, 'lockedBy'),
        lockedAt: normalizeNonEmptyString(record?.lockedAt, 'lockedAt'),
        files,
        ...(typeof record?.reason === 'string' && record.reason.trim().length > 0 ? { reason: record.reason.trim() } : {}),
        ...(selectors ? { selectors } : {})
    };
}
export function parseScopeLockRecord(document) {
    return createScopeLockRecord(document);
}
export function hasMapSelectors(scopeLock) {
    return Boolean(scopeLock.selectors && Object.keys(scopeLock.selectors).length > 0);
}
export function validateScopeLeaseFencing(entries) {
    const findings = [];
    findings.push(...findDuplicateExclusiveOwners(entries));
    findings.push(...findReleasedTombstoneReacquires(entries));
    findings.push(...findAllowedFilesViolations(entries));
    findings.push(...findWaitForCycles(entries));
    return {
        ok: findings.length === 0,
        findings
    };
}
export function validateScopeLeaseEpoch(input) {
    if (input.actualEpoch === input.expectedEpoch) {
        return { ok: true, findings: [] };
    }
    return {
        ok: false,
        findings: [{
                code: 'ATM_SCOPE_LEASE_STALE_EPOCH',
                detail: `Stale lease epoch for ${input.leaseId}: expected ${input.expectedEpoch}, received ${input.actualEpoch}.`,
                leaseIds: [input.leaseId],
                expectedEpoch: input.expectedEpoch,
                actualEpoch: input.actualEpoch,
                runModes: [input.runMode]
            }]
    };
}
function findDuplicateExclusiveOwners(entries) {
    const findings = [];
    const activeByResource = new Map();
    for (const entry of entries.filter((candidate) => candidate.status === 'active')) {
        activeByResource.set(entry.resourceKey, [...(activeByResource.get(entry.resourceKey) ?? []), entry]);
    }
    for (const [resourceKey, active] of activeByResource.entries()) {
        const ownerKeys = new Set(active.map((entry) => writerKey(entry.owner)));
        if (ownerKeys.size > 1) {
            findings.push({
                code: 'ATM_SCOPE_LEASE_DUPLICATE_EXCLUSIVE_OWNER',
                detail: `Resource ${resourceKey} has ${ownerKeys.size} active exclusive owners.`,
                leaseIds: active.map((entry) => entry.leaseId),
                runModes: uniqueRunModes(active)
            });
        }
    }
    return findings;
}
function findReleasedTombstoneReacquires(entries) {
    const findings = [];
    const released = entries.filter((entry) => entry.status === 'released');
    const active = entries.filter((entry) => entry.status === 'active');
    for (const tombstone of released) {
        for (const candidate of active) {
            const sameOwner = writerKey(candidate.owner) === writerKey(tombstone.owner);
            const staleEpoch = candidate.leaseEpoch <= tombstone.leaseEpoch;
            if (candidate.resourceKey === tombstone.resourceKey && sameOwner && staleEpoch) {
                findings.push({
                    code: 'ATM_SCOPE_LEASE_TOMBSTONE_REACQUIRE',
                    detail: `Released tombstone ${tombstone.leaseId} blocks stale reacquire ${candidate.leaseId}.`,
                    leaseIds: [tombstone.leaseId, candidate.leaseId],
                    expectedEpoch: tombstone.leaseEpoch + 1,
                    actualEpoch: candidate.leaseEpoch,
                    runModes: uniqueRunModes([tombstone, candidate])
                });
            }
        }
    }
    return findings;
}
function findAllowedFilesViolations(entries) {
    const findings = [];
    for (const entry of entries.filter((candidate) => candidate.status === 'active')) {
        const allowed = entry.allowedFiles.map(normalizePathForLease);
        const violations = entry.writeSet
            .map(normalizePathForLease)
            .filter((writePath) => !allowed.some((allowedPath) => pathMatchesLeasePattern(writePath, allowedPath)));
        if (violations.length > 0) {
            findings.push({
                code: 'ATM_SCOPE_LEASE_ALLOWED_FILES_VIOLATION',
                detail: `Lease ${entry.leaseId} writes outside allowedFiles: ${violations.join(', ')}.`,
                leaseIds: [entry.leaseId],
                runModes: [entry.runMode]
            });
        }
    }
    return findings;
}
function findWaitForCycles(entries) {
    const active = entries.filter((entry) => entry.status === 'active');
    const byId = new Map(active.map((entry) => [entry.leaseId, entry]));
    const findings = [];
    const visited = new Set();
    const visiting = new Set();
    const visit = (leaseId, stack) => {
        if (visiting.has(leaseId)) {
            const cycle = stack.slice(stack.indexOf(leaseId)).concat(leaseId);
            const cycleEntries = cycle.map((id) => byId.get(id)).filter((entry) => Boolean(entry));
            findings.push({
                code: 'ATM_SCOPE_LEASE_WAIT_FOR_CYCLE',
                detail: `Wait-for graph cycle detected: ${cycle.join(' -> ')}.`,
                leaseIds: cycle,
                runModes: uniqueRunModes(cycleEntries)
            });
            return;
        }
        if (visited.has(leaseId))
            return;
        const entry = byId.get(leaseId);
        if (!entry)
            return;
        visiting.add(leaseId);
        for (const next of entry.waitsFor ?? []) {
            visit(next, [...stack, leaseId]);
        }
        visiting.delete(leaseId);
        visited.add(leaseId);
    };
    for (const entry of active) {
        visit(entry.leaseId, []);
    }
    return dedupeFindings(findings);
}
function writerKey(owner) {
    return `${owner.instanceId}::${owner.worktreeId}`;
}
function uniqueRunModes(entries) {
    return [...new Set(entries.map((entry) => entry.runMode))].sort();
}
function normalizePathForLease(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '');
}
function pathMatchesLeasePattern(filePath, pattern) {
    if (pattern.endsWith('/**')) {
        return filePath === pattern.slice(0, -3) || filePath.startsWith(pattern.slice(0, -2));
    }
    return filePath === pattern;
}
function dedupeFindings(findings) {
    const seen = new Set();
    return findings.filter((finding) => {
        const key = `${finding.code}:${finding.leaseIds.join('|')}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
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
    const record = asRecord(migration);
    const rawStrategy = typeof record?.strategy === 'string' && record.strategy.trim().length > 0
        ? record.strategy.trim()
        : (specVersion === '0.2.0' ? 'additive' : 'none');
    const strategy = rawStrategy === 'additive' || rawStrategy === 'none' || rawStrategy === 'breaking'
        ? rawStrategy
        : 'none';
    const fromVersion = record?.fromVersion == null ? null : normalizeSemver(record.fromVersion, 'migration.fromVersion');
    const notes = typeof record?.notes === 'string' && record.notes.trim().length > 0
        ? record.notes.trim()
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
    const record = asRecord(value);
    if (!record) {
        throw new Error('Scope lock selectors must be an object.');
    }
    const selectors = {
        ...(record.mapId ? { mapId: normalizePatternString(record.mapId, mapIdPattern, 'selectors.mapId') } : {}),
        ...(record.mapMembers ? { mapMembers: normalizeAtomIdArray(record.mapMembers, 'selectors.mapMembers') } : {}),
        ...(record.mapEdges ? { mapEdges: normalizeEdgeSelectors(record.mapEdges) } : {}),
        ...(record.mapEntrypoints ? { mapEntrypoints: normalizeAtomIdArray(record.mapEntrypoints, 'selectors.mapEntrypoints') } : {}),
        ...(record.legacyUris ? { legacyUris: normalizeLegacyUris(record.legacyUris) } : {})
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
        const record = asRecord(entry);
        const from = normalizePatternString(record?.from, atomIdPattern, `selectors.mapEdges[${index}].from`);
        const to = normalizePatternString(record?.to, atomIdPattern, `selectors.mapEdges[${index}].to`);
        const edgeKind = record?.edgeKind == null ? undefined : normalizeEdgeKind(record.edgeKind, `selectors.mapEdges[${index}].edgeKind`);
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
