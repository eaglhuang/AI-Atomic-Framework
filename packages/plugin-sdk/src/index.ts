import type { EvidenceRecord, WorkItemRef } from '@ai-atomic-framework/core';

export const pluginSdkPackage = {
  packageName: '@ai-atomic-framework/plugin-sdk',
  packageRole: 'plugin-capability-interfaces',
  packageVersion: '0.0.0'
} as const;

export interface GovernancePluginContext {
  readonly workItem: WorkItemRef;
  readonly repositoryRoot: string;
}

export interface GovernancePluginResult {
  readonly ok: boolean;
  readonly evidence: readonly EvidenceRecord[];
  readonly messages: readonly string[];
}

export interface GovernancePlugin {
  readonly pluginName: string;
  run(context: GovernancePluginContext): Promise<GovernancePluginResult>;
}