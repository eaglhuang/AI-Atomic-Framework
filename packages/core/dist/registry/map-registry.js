import { computeAtomicMapHash } from './map-hash.js';
import { normalizeSemanticFingerprint } from './semantic-fingerprint.js';
import { migrateRegistryStatus } from './status-migration.js';
export function createAtomicMapRegistryEntry(atomicMap, options = {}) {
    const statusMigration = migrateRegistryStatus({
        entryType: 'map',
        status: options.status ?? 'draft',
        governanceTier: options.governanceTier ?? null
    });
    const baseEntry = {
        schemaId: 'atm.atomicMap',
        specVersion: atomicMap.specVersion,
        schemaPath: options.schemaPath ?? 'schemas/registry/atomic-map.schema.json',
        mapId: String(atomicMap.mapId).trim(),
        mapVersion: String(atomicMap.mapVersion).trim(),
        members: atomicMap.members.map((member) => ({
            atomId: String(member.atomId).trim(),
            version: String(member.version).trim(),
            ...(member.role ? { role: String(member.role).trim() } : {}),
            ...(member.versionLineage ? { versionLineage: member.versionLineage } : {})
        })),
        edges: atomicMap.edges.map((edge) => ({
            from: String(edge.from).trim(),
            to: String(edge.to).trim(),
            binding: String(edge.binding).trim(),
            ...(edge.edgeKind ? { edgeKind: String(edge.edgeKind).trim() } : {})
        })),
        entrypoints: atomicMap.entrypoints.map((entrypoint) => String(entrypoint).trim()),
        qualityTargets: Object.fromEntries(Object.entries(atomicMap.qualityTargets).map(([key, value]) => [String(key).trim(), typeof value === 'string' ? value.trim() : value])),
        mapHash: computeAtomicMapHash(atomicMap),
        ...(atomicMap.replacement ? { replacement: normalizeReplacement(atomicMap.replacement) } : {}),
        status: statusMigration.status,
        governance: statusMigration.governance
    };
    const semanticFingerprint = normalizeSemanticFingerprint(options.semanticFingerprint ?? atomicMap.semanticFingerprint ?? null);
    const pendingSfCalculation = options.pendingSfCalculation === true || atomicMap.pendingSfCalculation === true;
    const lineageLogRef = options.lineageLogRef ?? atomicMap.lineageLogRef;
    const ttl = options.ttl ?? atomicMap.ttl;
    const location = options.location
        ? {
            specPath: String(options.location.specPath).trim(),
            codePaths: normalizeStringArray(options.location.codePaths),
            testPaths: normalizeStringArray(options.location.testPaths),
            reportPath: options.location.reportPath == null ? null : String(options.location.reportPath).trim(),
            workbenchPath: options.location.workbenchPath == null ? null : String(options.location.workbenchPath).trim()
        }
        : undefined;
    const evidence = normalizeStringArray(options.evidence ?? []);
    return {
        ...baseEntry,
        ...(semanticFingerprint ? { semanticFingerprint } : (pendingSfCalculation ? { semanticFingerprint: null } : {})),
        ...(pendingSfCalculation ? { pendingSfCalculation: true } : {}),
        ...(lineageLogRef ? { lineageLogRef } : {}),
        ...(typeof ttl === 'number' ? { ttl } : {}),
        ...(location ? { location } : {}),
        ...(evidence.length > 0 ? { evidence } : {})
    };
}
export function isAtomicMapRegistryEntry(value) {
    return Boolean(value && typeof value === 'object' && value.schemaId === 'atm.atomicMap');
}
export function validateAtomicMapRegistryEntryHash(entry) {
    const expected = computeAtomicMapHash(entry);
    return {
        ok: entry.mapHash === expected,
        actual: entry.mapHash,
        expected
    };
}
function normalizeStringArray(values) {
    return [...new Set(values
            .map((value) => String(value || '').trim())
            .filter(Boolean))];
}
function normalizeReplacement(replacement) {
    return {
        legacyUris: normalizeStringArray(replacement.legacyUris),
        mode: replacement.mode,
        evidenceRefs: normalizeStringArray(replacement.evidenceRefs)
    };
}
