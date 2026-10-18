import { computeSha256ForContent } from '../hash-lock/hash-lock.js';
export { createAtomicMapSemanticFingerprint } from './semantic-fingerprint.js';
export function createAtomicMapHashPayload(input) {
    return {
        members: normalizeAtomicMapMembers(input.members),
        edges: normalizeAtomicMapEdges(input.edges),
        entrypoints: normalizeAtomicMapEntrypoints(input.entrypoints),
        ...(input.replacement ? { replacement: normalizeAtomicMapReplacement(input.replacement) } : {})
    };
}
export function computeAtomicMapHash(input) {
    return computeSha256ForContent(JSON.stringify(createAtomicMapHashPayload(input)));
}
function normalizeAtomicMapMembers(members = []) {
    return [...members]
        .map((member) => ({
        atomId: String(member.atomId).trim(),
        version: String(member.version).trim(),
        ...(member.role ? { role: String(member.role).trim() } : {})
    }))
        .sort((left, right) => left.atomId.localeCompare(right.atomId) || left.version.localeCompare(right.version) || String(left.role ?? '').localeCompare(String(right.role ?? '')));
}
function normalizeAtomicMapEdges(edges = []) {
    return [...edges]
        .map((edge) => ({
        from: String(edge.from).trim(),
        to: String(edge.to).trim(),
        binding: String(edge.binding).trim(),
        ...(edge.edgeKind ? { edgeKind: String(edge.edgeKind).trim() } : {})
    }))
        .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.binding.localeCompare(right.binding) || String(left.edgeKind ?? '').localeCompare(String(right.edgeKind ?? '')));
}
function normalizeAtomicMapEntrypoints(entrypoints = []) {
    return [...entrypoints]
        .map((entrypoint) => String(entrypoint).trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
}
function normalizeAtomicMapQualityTargets(qualityTargets = {}) {
    const normalizedEntries = Object.entries(qualityTargets)
        .map(([key, value]) => [String(key).trim(), typeof value === 'string' ? value.trim() : value])
        .filter(([key]) => key.length > 0)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
    return Object.fromEntries(normalizedEntries);
}
function normalizeAtomicMapReplacement(replacement) {
    return {
        legacyUris: [...replacement.legacyUris]
            .map((legacyUri) => String(legacyUri).trim())
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right))
    };
}
