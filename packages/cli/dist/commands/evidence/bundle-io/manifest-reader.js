import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isRecord } from '../shared-utils.js';
export const EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID = 'atm.evidenceBundleManifest.v1';
export function evidenceBundleManifestRelativePath(taskId) {
    return `.atm/history/evidence/${taskId}.bundle-manifest.json`;
}
export function evidenceBundleManifestPathForTask(cwd, taskId) {
    return path.join(cwd, evidenceBundleManifestRelativePath(taskId));
}
export function readEvidenceBundleManifest(cwd, taskId) {
    const manifestPath = evidenceBundleManifestPathForTask(cwd, taskId);
    if (!existsSync(manifestPath))
        return null;
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!isRecord(parsed) || parsed.schemaId !== EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID)
        return null;
    if (typeof parsed.taskId !== 'string' || parsed.taskId !== taskId)
        return null;
    return {
        schemaId: EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID,
        taskId,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
        updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : 'unknown',
        freshValidationPasses: readStringArray(parsed.freshValidationPasses),
        staleValidationPasses: readStringArray(parsed.staleValidationPasses),
        commandRuns: Array.isArray(parsed.commandRuns) ? parsed.commandRuns.filter(isRecord) : [],
        artifactPaths: readStringArray(parsed.artifactPaths).map(normalizeRelativePath),
    };
}
function readStringArray(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
        : [];
}
function normalizeRelativePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
