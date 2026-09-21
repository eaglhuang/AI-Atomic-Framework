import { normalizeSemanticFingerprint } from './semantic-fingerprint.js';
export function upcastRegistryDocumentVersionHistory(registryDocument, options = {}) {
    return {
        ...registryDocument,
        entries: Array.isArray(registryDocument.entries)
            ? registryDocument.entries.map((entry) => isAtomRegistryEntry(entry)
                ? upcastRegistryEntryVersionHistory(entry, options)
                : entry)
            : []
    };
}
export function upcastRegistryEntryVersionHistory(entry, options = {}) {
    const versions = normalizeRegistryVersionHistory(entry, options);
    const currentVersion = entry.currentVersion ??
        versions[versions.length - 1]?.version ??
        resolveRegistryVersion(entry, options);
    return {
        ...entry,
        currentVersion,
        versions
    };
}
export function normalizeRegistryVersionHistory(entry, options = {}) {
    const existingVersions = Array.isArray(entry.versions) && entry.versions.length > 0
        ? entry.versions.map((version) => normalizeRegistryVersionRecord(version))
        : [];
    if (existingVersions.length > 0) {
        return existingVersions;
    }
    return [createRegistryVersionRecord(entry, resolveRegistryVersion(entry, options), options.timestamp)];
}
export function createRegistryVersionRecord(entry, version, timestamp = new Date().toISOString()) {
    const selfVerification = entry.selfVerification;
    const semanticFingerprint = normalizeSemanticFingerprint(entry.semanticFingerprint ?? null);
    const baseRecord = {
        version,
        specHash: selfVerification?.specHash ?? entry.hashLock.digest,
        codeHash: selfVerification?.codeHash ?? entry.hashLock.digest,
        testHash: selfVerification?.testHash ?? entry.hashLock.digest,
        timestamp
    };
    return {
        ...baseRecord,
        ...(semanticFingerprint
            ? { semanticFingerprint }
            : (entry.semanticFingerprint === null ? { semanticFingerprint: null } : {}))
    };
}
function normalizeRegistryVersionRecord(versionRecord) {
    const semanticFingerprint = normalizeSemanticFingerprint(versionRecord.semanticFingerprint ?? null);
    const baseRecord = {
        version: String(versionRecord.version).trim(),
        specHash: String(versionRecord.specHash).trim(),
        codeHash: String(versionRecord.codeHash).trim(),
        testHash: String(versionRecord.testHash).trim(),
        timestamp: String(versionRecord.timestamp).trim()
    };
    return {
        ...baseRecord,
        ...(semanticFingerprint
            ? { semanticFingerprint }
            : (versionRecord.semanticFingerprint === null ? { semanticFingerprint: null } : {}))
    };
}
function resolveRegistryVersion(entry, options = {}) {
    const fallbackVersion = options.defaultVersion ?? entry.currentVersion ?? entry.atomVersion ?? entry.specVersion;
    return String(fallbackVersion || '0.1.0').trim();
}
function isAtomRegistryEntry(entry) {
    return entry?.schemaId === 'atm.atomicSpec';
}
