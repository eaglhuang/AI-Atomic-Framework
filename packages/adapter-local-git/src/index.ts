import type { ArtifactRecord, EvidenceRecord, ScopeLockRecord, WorkItemRef } from '@ai-atomic-framework/core';
import type { GovernancePluginResult } from '@ai-atomic-framework/plugin-sdk';

export const adapterLocalGitPackage = {
  packageName: '@ai-atomic-framework/adapter-local-git',
  packageRole: 'local-git-adapter',
  packageVersion: '0.0.0'
} as const;

export type LocalGitAdapterOperation = 'scaffold' | 'lock' | 'gate' | 'doc' | 'registry';
export type LocalGitAdapterMode = 'filesystem' | 'dry-run' | 'noop';

export interface LocalGitAdapterConfig {
  readonly registryPath: string;
  readonly reportsPath: string;
  readonly dryRun: boolean;
  readonly lockMode: 'noop';
  readonly gateMode: 'noop';
  readonly docMode: 'noop';
}

export interface LocalGitAdapterContext {
  readonly repositoryRoot: string;
  readonly actor?: string;
  readonly config?: Partial<LocalGitAdapterConfig>;
  readonly now?: string;
}

export interface LocalGitAdapterResult {
  readonly ok: boolean;
  readonly operation: LocalGitAdapterOperation;
  readonly mode: LocalGitAdapterMode;
  readonly dryRun: boolean;
  readonly noop: boolean;
  readonly messages: readonly string[];
  readonly evidence: readonly EvidenceRecord[];
  readonly lockRecords: readonly ScopeLockRecord[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly registryPath: string;
}

export interface LocalGitRegistryEntry {
  readonly id: string;
  readonly kind: 'atom' | 'work-item' | 'evidence' | 'adapter-record';
  readonly payload: unknown;
}

export interface ProjectAdapter {
  readonly adapterName: '@ai-atomic-framework/adapter-local-git';
  readonly defaultConfig: LocalGitAdapterConfig;
  scaffold(context: LocalGitAdapterContext): Promise<LocalGitAdapterResult> | LocalGitAdapterResult;
  lockScope(context: LocalGitAdapterContext, workItem: WorkItemRef, files: readonly string[]): Promise<LocalGitAdapterResult> | LocalGitAdapterResult;
  runGate(context: LocalGitAdapterContext, workItem: WorkItemRef): Promise<LocalGitAdapterResult> | LocalGitAdapterResult;
  writeDocRecord(context: LocalGitAdapterContext, workItem: WorkItemRef, summary: string): Promise<LocalGitAdapterResult> | LocalGitAdapterResult;
  writeRegistryEntry(context: LocalGitAdapterContext, entry: LocalGitRegistryEntry): Promise<LocalGitAdapterResult> | LocalGitAdapterResult;
  readRegistryEntry(context: LocalGitAdapterContext, entryId: string): Promise<LocalGitRegistryEntry | null> | LocalGitRegistryEntry | null;
  resolveRegistryPath(context: LocalGitAdapterContext): string;
}

export interface LocalGitAdapterReport {
  readonly clean: boolean;
  readonly lockRecords: readonly ScopeLockRecord[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly pluginResults: readonly GovernancePluginResult[];
}

export const defaultLocalGitAdapterConfig: LocalGitAdapterConfig = {
  registryPath: '.atm/registry',
  reportsPath: '.atm/reports',
  dryRun: false,
  lockMode: 'noop',
  gateMode: 'noop',
  docMode: 'noop'
};

export const localGitAdapterRuntime = {
  entrypoint: './local-git-adapter.mjs',
  supportsFilesystemRegistryPath: true,
  hostGovernanceRequired: false,
  noopOperations: ['lock', 'gate', 'doc'] as const,
  resultFormat: 'LocalGitAdapterResult'
} as const;