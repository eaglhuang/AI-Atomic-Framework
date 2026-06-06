/**
 * manifest/construct.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * Install manifest construction helpers: SHA-256 file records,
 * manifest creation, static adapter factory, and the install
 * source-file writer.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatInstallManifest, normalizeManifestPath, resolveRepositoryPath, sha256Bytes } from './schema.js';
import { verifyManifestFiles } from '../verify/verify-installed.js';
import { uninstallManifestFiles } from '../verify/uninstall-safety.js';
export function createInstallManifest(input) {
    return {
        schemaId: 'atm.integrationInstallManifest',
        schemaVersion: 'atm.installManifest.v0.1',
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'Initial integration adapter install manifest.'
        },
        adapterId: input.adapterId,
        adapterVersion: input.adapterVersion,
        installedAt: input.installedAt,
        ...(input.installedBy ? { installedBy: input.installedBy } : {}),
        targetDir: normalizeManifestPath(input.targetDir),
        files: input.files.map((fileRecord) => ({
            ...fileRecord,
            path: normalizeManifestPath(fileRecord.path)
        })),
        ...(input.metadata ? { metadata: input.metadata } : {})
    };
}
export function createManifestFileRecord(input) {
    const sizeBytes = typeof input.content === 'string'
        ? Buffer.byteLength(input.content, 'utf8')
        : input.content.byteLength;
    return {
        path: normalizeManifestPath(input.path),
        sha256: sha256Bytes(input.content),
        sizeBytes,
        source: input.source,
        fileFormat: input.fileFormat
    };
}
export function createCodexSkillsAdapter(sourceFiles, options = {}) {
    return createStaticIntegrationAdapter({
        id: 'codex',
        displayName: 'Codex skills',
        adapterVersion: options.adapterVersion ?? '0.0.0',
        targetDir: options.targetDir ?? 'integrations/codex-skills',
        fileFormat: 'skill',
        placeholderStyle: '$ARGUMENTS',
        sourceFiles
    });
}
export function createStaticIntegrationAdapter(input) {
    const targetDirectory = normalizeManifestPath(input.targetDir);
    return {
        id: input.id,
        displayName: input.displayName,
        adapterVersion: input.adapterVersion,
        fileFormat: input.fileFormat,
        placeholderStyle: input.placeholderStyle,
        targetDir: () => targetDirectory,
        install: (context) => installSourceFiles({
            adapterId: input.id,
            adapterVersion: input.adapterVersion,
            context,
            defaultFileFormat: input.fileFormat,
            sourceFiles: resolveIntegrationSourceFiles(input.sourceFiles, context),
            targetDirectory
        }),
        verify: (context, manifest) => verifyManifestFiles(input.id, context, manifest),
        uninstall: (context, manifest) => uninstallManifestFiles(input.id, context, manifest)
    };
}
// ─── Private helpers ───────────────────────────────────────────────────────
function resolveIntegrationSourceFiles(sourceFiles, context) {
    return typeof sourceFiles === 'function' ? sourceFiles(context) : sourceFiles;
}
function installSourceFiles(input) {
    const installedAt = input.context.now ?? new Date().toISOString();
    const manifestFiles = input.sourceFiles.map((sourceFile) => {
        const manifestPath = combineManifestPath(input.targetDirectory, sourceFile.relativePath);
        return createManifestFileRecord({
            path: manifestPath,
            content: sourceFile.content,
            source: sourceFile.source ?? 'template',
            fileFormat: sourceFile.fileFormat ?? input.defaultFileFormat
        });
    });
    const manifest = createInstallManifest({
        adapterId: input.adapterId,
        adapterVersion: input.adapterVersion,
        installedAt,
        installedBy: input.context.actor,
        targetDir: input.targetDirectory,
        files: manifestFiles,
        metadata: {
            sourceFileCount: input.sourceFiles.length
        }
    });
    const manifestPath = normalizeManifestPath(input.context.manifestPath ?? '.atm/integrations/manifest.json');
    const writtenFiles = manifest.files.map((fileRecord) => fileRecord.path);
    if (input.context.dryRun !== true) {
        input.sourceFiles.forEach((sourceFile, index) => {
            const fileRecord = manifest.files[index];
            if (!fileRecord) {
                return;
            }
            const absolutePath = resolveRepositoryPath(input.context.repositoryRoot, fileRecord.path);
            mkdirSync(path.dirname(absolutePath), { recursive: true });
            writeFileSync(absolutePath, sourceFile.content);
        });
        const absoluteManifestPath = resolveRepositoryPath(input.context.repositoryRoot, manifestPath);
        mkdirSync(path.dirname(absoluteManifestPath), { recursive: true });
        writeFileSync(absoluteManifestPath, formatInstallManifest(manifest));
    }
    return {
        ok: true,
        dryRun: input.context.dryRun === true,
        adapterId: input.adapterId,
        manifestPath,
        writtenFiles,
        manifest
    };
}
function combineManifestPath(parentPath, childPath) {
    return normalizeManifestPath(`${normalizeManifestPath(parentPath)}/${normalizeManifestPath(childPath)}`);
}
