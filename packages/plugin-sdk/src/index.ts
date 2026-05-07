import type { EvidenceRecord, WorkItemRef } from '@ai-atomic-framework/core';
export { AtomLifecycleMode } from './lifecycle';
export type {
  AtomLifecycleHookContext,
  AtomLifecycleHookResult,
  AtomLifecycleHooks,
  AtomLifecycleModeValue,
  QualityMetricsComparator,
  QualityMetricsComparison,
  QualityMetricsSnapshot,
  UpgradeProposal,
  UpgradeProposalAdapter,
  UpgradeProposalRequest,
  VersionResolution,
  VersionResolver,
  VersionResolverRequest
} from './lifecycle';
export type {
  EffectNode,
  EffectNodeContext,
  EffectNodeMode,
  EffectNodeResult,
  ExecuteAgentTaskEffectNode,
  ExecuteAgentTaskInput
} from './effect-node';
export type {
  CapabilityContext,
  CapabilityDescriptor,
  CapabilityKind,
  CapabilityProvider,
  CapabilityRegistry,
  CapabilityResult
} from './capability';
export type { ProjectAdapter, ProjectAdapterContext, ProjectAdapterResult } from './project-adapter';
export type {
  LanguageAdapter,
  LanguageAdapterMessage,
  LanguageAdapterReport,
  LanguageAdapterValidationRequest,
  LanguageProjectProfile,
  LanguageSourceFile
} from './language-adapter';
export type { InjectorPlugin, InjectorPluginContext } from './injector-plugin';
export type {
  ArtifactStore,
  GovernanceAdapter,
  GovernanceLayout,
  ContextSummaryStore,
  DocumentIndex,
  EvidenceStore,
  GovernanceStores,
  LockStore,
  LogStore,
  MarkdownJsonStateStore,
  RegistryStore,
  RuleGuard,
  RunReportStore,
  ShardStore,
  StoreLifecycle,
  TaskStore
} from './governance';
export { defaultGovernanceLayout } from './governance';
export type {
  PoliceCheckContract,
  PoliceCheckKind,
  PoliceCheckResult,
  PoliceLifecycleMode,
  PoliceReport,
  PoliceSeverity,
  PoliceViolation
} from './police';

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