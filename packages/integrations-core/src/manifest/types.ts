/**
 * manifest/types.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * All integration install manifest interface types, shared adapter
 * ID / format / placeholder aliases, and the IntegrationAdapter interface.
 * Imports verify result types from verify/types.ts to avoid circular deps.
 */
import type { IntegrationVerifyResult, IntegrationUninstallResult } from '../verify/types.ts';

export type { IntegrationVerifyResult, IntegrationUninstallResult };

// ─── Adapter ID and format aliases ────────────────────────────────────────

export type KnownIntegrationAdapterId = 'claude-code' | 'copilot' | 'cursor' | 'gemini' | 'windsurf' | 'goose' | 'codex';
export type IntegrationAdapterId = KnownIntegrationAdapterId | (string & {});
export type IntegrationFileFormat = 'skill' | 'agent-md' | 'prompt-md' | 'instructions-md' | 'toml' | 'yaml' | 'markdown';
export type IntegrationPlaceholderStyle = '$ARGUMENTS' | '{{vars}}' | 'toml-fields' | 'none';
export type InstallManifestFileSource = 'template' | 'generated' | 'copied';
export type Sha256Digest = `sha256:${string}`;

// ─── Manifest types ────────────────────────────────────────────────────────

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
  readonly schemaVersion: 'atm.installManifest.v0.1';
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

export interface IntegrationInstallResult {
  readonly ok: boolean;
  readonly dryRun: boolean;
  readonly adapterId: string;
  readonly manifestPath: string;
  readonly writtenFiles: readonly string[];
  readonly manifest: InstallManifest;
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
  readonly sourceFiles: readonly IntegrationSourceFile[] | ((context: IntegrationInstallContext) => readonly IntegrationSourceFile[]);
}

export interface CodexSkillsAdapterOptions {
  readonly adapterVersion?: string;
  readonly targetDir?: string;
}
