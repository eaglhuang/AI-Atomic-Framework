/**
 * manifest/schema.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * Schema version constant, path normalizer/resolver, SHA-256 helpers,
 * and the install manifest serializer. These utilities are shared by
 * both manifest/construct.ts and verify/*.ts so they live here to
 * avoid circular imports.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
export const installManifestSchemaVersion = 'atm.installManifest.v0.1';
export function sha256Bytes(input) {
    return `sha256:${createHash('sha256').update(input).digest('hex')}`;
}
export function sha256File(absolutePath) {
    return sha256Bytes(readFileSync(absolutePath));
}
export function formatInstallManifest(manifest) {
    return `${JSON.stringify(manifest, null, 2)}\n`;
}
export function normalizeManifestPath(candidatePath) {
    const normalized = candidatePath
        .replace(/\\/g, '/')
        .replace(/^\.\/+/, '')
        .replace(/\/+/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.includes(':') || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
        throw new Error(`unsafe manifest path: ${candidatePath}`);
    }
    return normalized;
}
export function resolveRepositoryPath(repositoryRoot, manifestPath) {
    const absoluteRoot = path.resolve(repositoryRoot);
    const resolvedPath = path.resolve(absoluteRoot, normalizeManifestPath(manifestPath));
    const comparableRoot = absoluteRoot.toLowerCase();
    const comparablePath = resolvedPath.toLowerCase();
    if (comparablePath !== comparableRoot && !comparablePath.startsWith(`${comparableRoot}${path.sep}`)) {
        throw new Error(`manifest path escapes repository root: ${manifestPath}`);
    }
    return resolvedPath;
}
