import type { ArtifactRecord, EvidenceRecord, ScopeLockRecord, WorkItemRef } from '@ai-atomic-framework/core';
import type {
  AtomizeAdapterRequest,
  InfectAdapterRequest,
  GovernancePluginResult,
  ProjectAdapter as SdkProjectAdapter,
  ProjectAdapterContext as SdkProjectAdapterContext,
  ProjectAdapterDryRunResult as SdkProjectAdapterDryRunResult,
  ProjectAdapterLegacyUriResolution,
  ProjectAdapterResult as SdkProjectAdapterResult
} from '@ai-atomic-framework/plugin-sdk';

export const adapterLocalGitPackage = {
  packageName: '@ai-atomic-framework/adapter-local-git',
  packageRole: 'local-git-adapter',
  packageVersion: '0.0.0'
} as const;

export type LocalGitAdapterOperation = 'scaffold' | 'lock' | 'gate' | 'doc' | 'registry' | 'adapter';
export type LocalGitAdapterMode = 'filesystem' | 'dry-run' | 'noop';

export interface LocalGitAdapterConfig {
  readonly registryPath: string;
  readonly reportsPath: string;
  readonly dryRun: boolean;
  readonly lockMode: 'noop';
  readonly gateMode: 'noop';
  readonly docMode: 'noop';
}

export interface LocalGitAdapterContext extends SdkProjectAdapterContext<Partial<LocalGitAdapterConfig>> {
  readonly repositoryRoot: string;
  readonly actor?: string;
  readonly config?: Partial<LocalGitAdapterConfig>;
  readonly now?: string;
}

export interface LocalGitAdapterResult extends SdkProjectAdapterResult {
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

export interface LocalGitAdapterDryRunResult extends LocalGitAdapterResult, SdkProjectAdapterDryRunResult {}

export interface LocalGitRegistryEntry {
  readonly id: string;
  readonly kind: 'atom' | 'work-item' | 'evidence' | 'adapter-record';
  readonly payload: unknown;
}

export interface ProjectAdapter extends SdkProjectAdapter<LocalGitAdapterConfig> {
  readonly adapterName: '@ai-atomic-framework/adapter-local-git';
  readonly defaultConfig: LocalGitAdapterConfig;
  resolveLegacyUri(context: LocalGitAdapterContext, legacyUri: string): Promise<ProjectAdapterLegacyUriResolution> | ProjectAdapterLegacyUriResolution;
  scaffold(context: LocalGitAdapterContext): Promise<LocalGitAdapterResult> | LocalGitAdapterResult;
  lockScope(context: LocalGitAdapterContext, workItem: WorkItemRef, files: readonly string[]): Promise<LocalGitAdapterResult> | LocalGitAdapterResult;
  runGate(context: LocalGitAdapterContext, workItem: WorkItemRef): Promise<LocalGitAdapterResult> | LocalGitAdapterResult;
  writeDocRecord(context: LocalGitAdapterContext, workItem: WorkItemRef, summary: string): Promise<LocalGitAdapterResult> | LocalGitAdapterResult;
  runAtomizeAdapter(context: LocalGitAdapterContext, request: AtomizeAdapterRequest): Promise<LocalGitAdapterDryRunResult> | LocalGitAdapterDryRunResult;
  runInfectAdapter(context: LocalGitAdapterContext, request: InfectAdapterRequest): Promise<LocalGitAdapterDryRunResult> | LocalGitAdapterDryRunResult;
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
  reportsPath: '.atm/history/reports',
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
