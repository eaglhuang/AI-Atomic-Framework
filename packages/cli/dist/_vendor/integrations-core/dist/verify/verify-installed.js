/**
 * verify/verify-installed.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * Hash-compare drift detection for installed integration files.
 * Returns an IntegrationVerifyResult describing which files match
 * or have diverged from the install manifest.
 */
import { existsSync } from 'node:fs';
import { normalizeManifestPath, resolveRepositoryPath, sha256File } from '../manifest/schema.js';
export function verifyManifestFiles(adapterId, context, manifest) {
    const findings = [];
    const driftedFiles = [];
    for (const fileRecord of manifest.files) {
        const absolutePath = resolveRepositoryPath(context.repositoryRoot, fileRecord.path);
        if (!existsSync(absolutePath)) {
            findings.push(createFinding('error', 'file-missing', fileRecord.path, 'Installed file is missing.'));
            driftedFiles.push(fileRecord.path);
            continue;
        }
        const currentDigest = sha256File(absolutePath);
        if (currentDigest !== fileRecord.sha256) {
            findings.push(createFinding('error', 'hash-mismatch', fileRecord.path, 'Installed file hash no longer matches the manifest.'));
            driftedFiles.push(fileRecord.path);
            continue;
        }
        findings.push(createFinding('info', 'file-ok', fileRecord.path, 'Installed file matches the manifest.'));
    }
    return {
        ok: driftedFiles.length === 0,
        adapterId,
        findings,
        driftedFiles
    };
}
// ─── Private helpers ───────────────────────────────────────────────────────
function createFinding(level, code, filePath, message) {
    return {
        level,
        code,
        path: normalizeManifestPath(filePath),
        message
    };
}
