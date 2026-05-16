import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const integrationsCorePackage = {
  packageName: '@ai-atomic-framework/integrations-core',
  packageRole: 'integration-adapter-contracts',
  packageVersion: '0.0.0'
} as const;

export type KnownIntegrationAdapterId = 'claude-code' | 'copilot' | 'cursor' | 'gemini' | 'windsurf' | 'goose' | 'codex';
export type IntegrationAdapterId = KnownIntegrationAdapterId | (string & {});
export type IntegrationFileFormat = 'skill' | 'agent-md' | 'prompt-md' | 'instructions-md' | 'toml' | 'yaml' | 'markdown';
export type IntegrationPlaceholderStyle = '$ARGUMENTS' | '{{vars}}' | 'toml-fields' | 'none';
export type InstallManifestFileSource = 'template' | 'generated' | 'copied';
export type Sha256Digest = `sha256:${string}`;

export const atmFirstCommand = 'node atm.mjs next --json';
export const charterInvariantsPlaceholder = '{{CHARTER_INVARIANTS}}';

export const minimumAtmEntrySkillDefinitions = [
  {
    id: 'atm-next',
    title: 'ATM Next',
    summary: 'Recommend the next official ATM guidance action from current state.',
    command: 'node atm.mjs next --json'
  },
  {
    id: 'atm-orient',
    title: 'ATM Orient',
    summary: 'Inspect a repository and emit a guidance orientation report.',
    command: 'node atm.mjs orient --cwd . --json'
  },
  {
    id: 'atm-create',
    title: 'ATM Create',
    summary: 'Create and register an atom through the provisioning facade.',
    command: 'node atm.mjs create --bucket CORE --title "$ARGUMENTS" --dry-run --json'
  },
  {
    id: 'atm-lock',
    title: 'ATM Lock',
    summary: 'Check, acquire, or release a governed scope lock.',
    command: 'node atm.mjs lock check --json'
  },
  {
    id: 'atm-evidence',
    title: 'ATM Evidence',
    summary: 'Explain missing evidence or blocked guidance before proceeding.',
    command: 'node atm.mjs explain --why blocked --json'
  },
  {
    id: 'atm-upgrade-scan',
    title: 'ATM Upgrade Scan',
    summary: 'Scan evidence reports and draft governed upgrade proposals.',
    command: 'node atm.mjs upgrade --scan --input "$ARGUMENTS" --json'
  },
  {
    id: 'atm-handoff',
    title: 'ATM Handoff',
    summary: 'Write a continuation summary for governed work.',
    command: 'node atm.mjs handoff summarize --task "$ARGUMENTS" --json'
  }
] as const;

export interface IntegrationInstallContext {
  readonly repositoryRoot: string;
  readonly actor?: string;
  readonly now?: string;
  readonly dryRun?: boolean;
  readonly manifestPath?: string;
}

export interface IntegrationSourceFile {
  readonly relativePath: string;
  readonly content: string | Uint8Array;
  readonly fileFormat?: IntegrationFileFormat;
  readonly source?: InstallManifestFileSource;
}

export interface InstallManifestFile {
  readonly path: string;
  readonly sha256: Sha256Digest;
  readonly sizeBytes: number;
  readonly source: InstallManifestFileSource;
  readonly fileFormat: IntegrationFileFormat;
}

export interface InstallManifest {
  readonly schemaId: 'atm.integrationInstallManifest';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly installedAt: string;
  readonly installedBy?: string;
  readonly targetDir: string;
  readonly files: readonly InstallManifestFile[];
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface CreateInstallManifestInput {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly installedAt: string;
  readonly installedBy?: string;
  readonly targetDir: string;
  readonly files: readonly InstallManifestFile[];
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export type IntegrationFindingLevel = 'info' | 'warning' | 'error';
export type IntegrationFindingCode = 'file-ok' | 'file-missing' | 'hash-mismatch' | 'manifest-preserved' | 'manifest-removed';

export interface IntegrationFinding {
  readonly level: IntegrationFindingLevel;
  readonly code: IntegrationFindingCode;
  readonly path: string;
  readonly message: string;
}

export interface IntegrationInstallResult {
  readonly ok: boolean;
  readonly dryRun: boolean;
  readonly adapterId: string;
  readonly manifestPath: string;
  readonly writtenFiles: readonly string[];
  readonly manifest: InstallManifest;
}

export interface IntegrationVerifyResult {
  readonly ok: boolean;
  readonly adapterId: string;
  readonly findings: readonly IntegrationFinding[];
  readonly driftedFiles: readonly string[];
}

export interface IntegrationUninstallResult {
  readonly ok: boolean;
  readonly adapterId: string;
  readonly removedFiles: readonly string[];
  readonly preservedFiles: readonly string[];
  readonly findings: readonly IntegrationFinding[];
}

export interface IntegrationAdapter {
  readonly id: IntegrationAdapterId;
  readonly displayName: string;
  readonly adapterVersion: string;
  readonly fileFormat: IntegrationFileFormat;
  readonly placeholderStyle: IntegrationPlaceholderStyle;
  targetDir(context?: IntegrationInstallContext): string;
  install(context: IntegrationInstallContext): Promise<IntegrationInstallResult> | IntegrationInstallResult;
  verify(context: IntegrationInstallContext, manifest: InstallManifest): Promise<IntegrationVerifyResult> | IntegrationVerifyResult;
  uninstall(context: IntegrationInstallContext, manifest: InstallManifest): Promise<IntegrationUninstallResult> | IntegrationUninstallResult;
}

export interface StaticIntegrationAdapterInput {
  readonly id: IntegrationAdapterId;
  readonly displayName: string;
  readonly adapterVersion: string;
  readonly targetDir: string;
  readonly fileFormat: IntegrationFileFormat;
  readonly placeholderStyle: IntegrationPlaceholderStyle;
  readonly sourceFiles: readonly IntegrationSourceFile[];
}

export interface CodexSkillsAdapterOptions {
  readonly adapterVersion?: string;
  readonly targetDir?: string;
}

export function sha256Bytes(input: string | Uint8Array): Sha256Digest {
  return `sha256:${createHash('sha256').update(input).digest('hex')}`;
}

export function sha256File(absolutePath: string): Sha256Digest {
  return sha256Bytes(readFileSync(absolutePath));
}

export function normalizeManifestPath(candidatePath: string): string {
  const normalized = candidatePath
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes(':') || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`unsafe manifest path: ${candidatePath}`);
  }
  return normalized;
}

export function createInstallManifest(input: CreateInstallManifestInput): InstallManifest {
  return {
    schemaId: 'atm.integrationInstallManifest',
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

export function formatInstallManifest(manifest: InstallManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function createManifestFileRecord(input: {
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly source: InstallManifestFileSource;
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
    adapterVersion: options.adapterVersion ?? integrationsCorePackage.packageVersion,
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
    install: (context) => installSourceFiles({
      adapterId: input.id,
      adapterVersion: input.adapterVersion,
      context,
      defaultFileFormat: input.fileFormat,
      sourceFiles: input.sourceFiles,
      targetDirectory
    }),
    verify: (context, manifest) => verifyManifestFiles(input.id, context, manifest),
    uninstall: (context, manifest) => uninstallManifestFiles(input.id, context, manifest)
  };
}

function installSourceFiles(input: {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly context: IntegrationInstallContext;
  readonly defaultFileFormat: IntegrationFileFormat;
  readonly sourceFiles: readonly IntegrationSourceFile[];
  readonly targetDirectory: string;
}): IntegrationInstallResult {
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

function verifyManifestFiles(adapterId: string, context: IntegrationInstallContext, manifest: InstallManifest): IntegrationVerifyResult {
  const findings: IntegrationFinding[] = [];
  const driftedFiles: string[] = [];
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

function uninstallManifestFiles(adapterId: string, context: IntegrationInstallContext, manifest: InstallManifest): IntegrationUninstallResult {
  const findings: IntegrationFinding[] = [];
  const removedFiles: string[] = [];
  const preservedFiles: string[] = [];
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
    } else {
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

function combineManifestPath(parentPath: string, childPath: string): string {
  return normalizeManifestPath(`${normalizeManifestPath(parentPath)}/${normalizeManifestPath(childPath)}`);
}

function resolveRepositoryPath(repositoryRoot: string, manifestPath: string): string {
  const absoluteRoot = path.resolve(repositoryRoot);
  const resolvedPath = path.resolve(absoluteRoot, normalizeManifestPath(manifestPath));
  const comparableRoot = absoluteRoot.toLowerCase();
  const comparablePath = resolvedPath.toLowerCase();
  if (comparablePath !== comparableRoot && !comparablePath.startsWith(`${comparableRoot}${path.sep}`)) {
    throw new Error(`manifest path escapes repository root: ${manifestPath}`);
  }
  return resolvedPath;
}

function createFinding(level: IntegrationFindingLevel, code: IntegrationFindingCode, filePath: string, message: string): IntegrationFinding {
  return {
    level,
    code,
    path: normalizeManifestPath(filePath),
    message
  };
}
