import { createHash } from 'node:crypto';
import { createRunnerVersionRegistry } from './runner-version-registry.js';
export const RUNNER_REGISTRY_SNAPSHOT_SCHEMA = 'atm.runnerRegistrySnapshot.v1';
export function buildRunnerRegistrySnapshot(input) {
    const core = {
        schemaId: RUNNER_REGISTRY_SNAPSHOT_SCHEMA,
        specVersion: '0.1.0',
        generatedAt: input.generatedAt,
        policyVersion: input.policyVersion,
        versions: normalizePublishedRunnerVersions(input.versions)
    };
    return { ...core, snapshotDigest: digestCanonicalJson(core) };
}
export function readRunnerRegistrySnapshotValue(snapshot) {
    const rebuilt = buildRunnerRegistrySnapshot({
        versions: snapshot.versions,
        generatedAt: snapshot.generatedAt,
        policyVersion: snapshot.policyVersion
    });
    if (rebuilt.snapshotDigest !== snapshot.snapshotDigest) {
        throw new Error(`Runner registry snapshot digest mismatch: expected ${snapshot.snapshotDigest}, got ${rebuilt.snapshotDigest}`);
    }
    return rebuilt;
}
export function createRegistryFromSnapshot(snapshot) {
    return createRunnerVersionRegistry(readRunnerRegistrySnapshotValue(snapshot).versions);
}
export function digestCanonicalJson(value) {
    return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}
function normalizePublishedRunnerVersions(versions) {
    return [...versions]
        .map((version) => ({
        ...version,
        publishedSurfaces: sortedStrings(version.publishedSurfaces),
        capabilityProof: {
            validators: sortedStrings(version.capabilityProof?.validators ?? []),
            schemas: sortedStrings(version.capabilityProof?.schemas ?? [])
        }
    }))
        .sort((a, b) => a.sealedSourceSha.localeCompare(b.sealedSourceSha) ||
        a.aggregateInputTreeHash.localeCompare(b.aggregateInputTreeHash) ||
        a.publishedAt.localeCompare(b.publishedAt));
}
function sortedStrings(values) {
    return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function canonicalJson(value) {
    return JSON.stringify(sortJson(value));
}
function sortJson(value) {
    if (Array.isArray(value))
        return value.map(sortJson);
    if (!value || typeof value !== 'object')
        return value;
    const record = value;
    return Object.fromEntries(Object.keys(record).sort((a, b) => a.localeCompare(b)).map((key) => [key, sortJson(record[key])]));
}
