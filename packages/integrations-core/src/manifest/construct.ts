/**
 * manifest/construct.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * Install manifest construction helpers: SHA-256 file records,
 * manifest creation, static adapter factory, and the install
 * source-file writer.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  formatInstallManifest,
  normalizeManifestPath,
  resolveRepositoryPath,
  sha256Bytes,
  sha256File
} from './schema.ts';
import type {
  CodexSkillsAdapterOptions,
  CreateInstallManifestInput,
  InstallManifest,
  InstallManifestFile,
  IntegrationAdapter,
  IntegrationFileFormat,
  IntegrationInstallContext,
  IntegrationInstallResult,
  IntegrationSourceFile,
  IntegrationSourceCoverage,
  StaticIntegrationAdapterInput
} from './types.ts';
import { verifyManifestFiles } from '../verify/verify-installed.ts';
import { uninstallManifestFiles } from '../verify/uninstall-safety.ts';
import { assertUnchanged, losslessUtf8, planSafeFile, safeInstallPath } from './safe-install.ts';

export function createInstallManifest(input: CreateInstallManifestInput): InstallManifest {
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

export function createManifestFileRecord(input: {
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly source: InstallManifestFile['source'];
  readonly fileFormat: IntegrationFileFormat;
}): InstallManifestFile {
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

export function createCodexSkillsAdapter(sourceFiles: readonly IntegrationSourceFile[], options: CodexSkillsAdapterOptions = {}): IntegrationAdapter {
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

export function createStaticIntegrationAdapter(input: StaticIntegrationAdapterInput): IntegrationAdapter {
  const targetDirectory = normalizeManifestPath(input.targetDir);
  return {
    id: input.id,
    displayName: input.displayName,
    adapterVersion: input.adapterVersion,
    fileFormat: input.fileFormat,
    placeholderStyle: input.placeholderStyle,
    targetDir: () => targetDirectory,
    ...(input.sourceCoverage ? { sourceCoverage: input.sourceCoverage } : {}),
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

function resolveIntegrationSourceFiles(
  sourceFiles: readonly IntegrationSourceFile[] | ((context: IntegrationInstallContext) => readonly IntegrationSourceFile[]),
  context: IntegrationInstallContext
) {
  return typeof sourceFiles === 'function' ? sourceFiles(context) : sourceFiles;
}

function installSourceFiles(input: {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly context: IntegrationInstallContext;
  readonly defaultFileFormat: IntegrationFileFormat;
  readonly sourceFiles: readonly IntegrationSourceFile[];
  readonly targetDirectory: string;
}): IntegrationInstallResult {
  const manifestPath = normalizeManifestPath(input.context.manifestPath ?? '.atm/integrations/manifest.json');
  const merge = input.context.merge === true;
  const manifestAbsolute = merge ? safeInstallPath(input.context.repositoryRoot, manifestPath) : resolveRepositoryPath(input.context.repositoryRoot, manifestPath);
  const previousManifestBytes = merge && existsSync(manifestAbsolute) ? readFileSync(manifestAbsolute) : null;
  const previous = previousManifestBytes ? JSON.parse(losslessUtf8(previousManifestBytes)) as InstallManifest : undefined;
  if (previous && (previous.adapterId !== input.adapterId || !Array.isArray(previous.files))) throw new Error('ATM_INTEGRATION_INVALID_OWNERSHIP: invalid previous manifest');
  const installedAt = previous?.installedAt ?? input.context.now ?? new Date().toISOString();
  const manifestFiles = input.sourceFiles.map((sourceFile) => {
    const manifestPath = combineManifestPath(input.targetDirectory, sourceFile.relativePath);
    return createManifestFileRecord({
      path: manifestPath,
      content: sourceFile.content,
      source: sourceFile.source ?? 'template',
      fileFormat: sourceFile.fileFormat ?? input.defaultFileFormat
    });
  });
  const plans = merge ? input.sourceFiles.map((sourceFile, index) => planSafeFile({
    root: input.context.repositoryRoot, file: manifestFiles[index].path,
    content: sourceFile.content, adapterId: input.adapterId, previous
  })) : [];
  const blocks = Object.fromEntries(plans.flatMap((plan, index) => plan.block ? [[manifestFiles[index].path, input.adapterId]] : []));
  const backupPaths = plans.map((plan, index) => plan.previous && !plan.previous.equals(plan.bytes)
    ? safeInstallPath(input.context.repositoryRoot, `.atm/integrations/backups/${input.adapterId}/${sha256Bytes(plan.previous).slice(7)}/${manifestFiles[index].path}`) : null);
  const manifest = { ...previous, ...createInstallManifest({
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    installedAt,
    installedBy: input.context.actor,
    targetDir: input.targetDirectory,
    files: manifestFiles,
    metadata: {
      sourceFileCount: input.sourceFiles.length,
      ...buildSkillProjectionManifestMetadata(input.sourceFiles, input.defaultFileFormat, input.targetDirectory),
      ...(Object.keys(blocks).length ? { managedBlocks: JSON.stringify(blocks) } : {}),
      ...(previous?.metadata?.nativeBridgeManifest ? { nativeBridgeManifest: previous.metadata.nativeBridgeManifest } : {})
    }
  }) };
  const writtenFiles = manifest.files.filter((_, index) => !merge || !plans[index].previous?.equals(plans[index].bytes)).map((file) => file.path);

  if (input.context.dryRun !== true) {
    if (merge) {
      assertUnchanged(input.context.repositoryRoot, manifestPath, previousManifestBytes);
      plans.forEach((plan, index) => assertUnchanged(input.context.repositoryRoot, manifest.files[index].path, plan.previous));
    }
    input.sourceFiles.forEach((sourceFile, index) => {
      const fileRecord = manifest.files[index];
      if (!fileRecord) {
        return;
      }
      const absolutePath = resolveRepositoryPath(input.context.repositoryRoot, fileRecord.path);
      if (merge && plans[index].previous?.equals(plans[index].bytes)) return;
      if (merge) assertUnchanged(input.context.repositoryRoot, fileRecord.path, plans[index].previous);
      if (merge && plans[index].previous) {
        const backup = backupPaths[index]!;
        mkdirSync(path.dirname(backup), { recursive: true });
        if (!existsSync(backup)) writeFileSync(backup, plans[index].previous!, { flag: 'wx' });
      }
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, merge ? plans[index].bytes : sourceFile.content);
    });
    const absoluteManifestPath = resolveRepositoryPath(input.context.repositoryRoot, manifestPath);
    mkdirSync(path.dirname(absoluteManifestPath), { recursive: true });
    const serialized = formatInstallManifest(manifest);
    if (merge) assertUnchanged(input.context.repositoryRoot, manifestPath, previousManifestBytes);
    if (!previousManifestBytes || previousManifestBytes.toString('utf8') !== serialized) writeFileSync(absoluteManifestPath, serialized);
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

function combineManifestPath(parentPath: string, childPath: string): string {
  return normalizeManifestPath(`${normalizeManifestPath(parentPath)}/${normalizeManifestPath(childPath)}`);
}

function buildSkillProjectionManifestMetadata(
  sourceFiles: readonly IntegrationSourceFile[],
  defaultFileFormat: IntegrationFileFormat,
  targetDirectory: string
): Readonly<Record<string, string | number | boolean | null>> {
  const managedSkillIds = [...new Set(sourceFiles.map((file) => file.skillId).filter((value): value is string => Boolean(value)))].sort();
  const sourceCatalogDigests = [...new Set(sourceFiles.map((file) => file.sourceCatalogDigest).filter((value): value is `sha256:${string}` => Boolean(value)))].sort();
  const installProfileIds = [...new Set(sourceFiles.map((file) => file.installProfileId).filter((value): value is string => Boolean(value)))].sort();
  if (managedSkillIds.length === 0 && sourceCatalogDigests.length === 0 && installProfileIds.length === 0) {
    return {};
  }
  return {
    sourceCatalogDigest: sourceCatalogDigests.length === 1 ? sourceCatalogDigests[0] : null,
    installProfileId: installProfileIds.length === 1 ? installProfileIds[0] : null,
    managedSkillIds: managedSkillIds.join(','),
    managedSkillCount: managedSkillIds.length,
    adapterFormat: defaultFileFormat,
    targetScope: inferTargetScopeFromDirectory(targetDirectory)
  };
}

function inferTargetScopeFromDirectory(targetDirectory: string): string {
  if (targetDirectory.startsWith('integrations/') || targetDirectory.startsWith('.claude/') || targetDirectory.startsWith('.cursor/') || targetDirectory.startsWith('.github/') || targetDirectory.startsWith('.gemini/')) {
    return 'framework';
  }
  return 'adopter';
}
