import type { ArtifactRecord, ScopeLockRecord } from '@ai-atomic-framework/core';
import type { GovernancePluginResult } from '@ai-atomic-framework/plugin-sdk';

export const adapterLocalGitPackage = {
  packageName: '@ai-atomic-framework/adapter-local-git',
  packageRole: 'local-git-adapter',
  packageVersion: '0.0.0'
} as const;

export interface LocalGitAdapterReport {
  readonly clean: boolean;
  readonly lockRecords: readonly ScopeLockRecord[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly pluginResults: readonly GovernancePluginResult[];
}