/**
 * verify/uninstall-safety.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * Preserve-if-modified uninstall safety. Compares each file's current
 * hash against the manifest; user-edited files are preserved, untouched
 * files are removed. The manifest file itself is hash-checked before
 * deletion.
 */
import { existsSync, rmSync } from 'node:fs';
import { formatInstallManifest, normalizeManifestPath, resolveRepositoryPath, sha256Bytes, sha256File } from '../manifest/schema.js';
export function uninstallManifestFiles(adapterId, context, manifest) {
    const findings = [];
    const removedFiles = [];
    const preservedFiles = [];
    for (const fileRecord of manifest.files) {
        const absolutePath = resolveRepositoryPath(context.repositoryRoot, fileRecord.path);
        if (!existsSync(absolutePath)) {
            findings.push(createFinding('warning', 'file-missing', fileRecord.path, 'Installed file was already missing.'));
            continue;
        }
        const currentDigest = sha256File(absolutePath);
        if (currentDigest !== fileRecord.sha256) {
            findings.push(createFinding('warning', 'hash-mismatch', fileRecord.path, 'Installed file was edited and will be preserved.'));
            preservedFiles.push(fileRecord.path);
            continue;
        }
        rmSync(absolutePath, { force: true });
        removedFiles.push(fileRecord.path);
    }
    const manifestPath = normalizeManifestPath(context.manifestPath ?? '.atm/integrations/manifest.json');
    const absoluteManifestPath = resolveRepositoryPath(context.repositoryRoot, manifestPath);
    if (existsSync(absoluteManifestPath)) {
        const expectedManifestDigest = sha256Bytes(formatInstallManifest(manifest));
        const actualManifestDigest = sha256File(absoluteManifestPath);
        if (actualManifestDigest === expectedManifestDigest) {
            rmSync(absoluteManifestPath, { force: true });
            removedFiles.push(manifestPath);
            findings.push(createFinding('info', 'manifest-removed', manifestPath, 'Install manifest matched and was removed.'));
        }
        else {
            preservedFiles.push(manifestPath);
            findings.push(createFinding('warning', 'manifest-preserved', manifestPath, 'Install manifest was edited and will be preserved.'));
        }
    }
    return {
        ok: true,
        adapterId,
        removedFiles,
        preservedFiles,
        findings
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
