import type { WorkItemRef } from '@ai-atomic-framework/core';
import type { CapabilityDescriptor, CapabilityResult } from './capability';
import type { GovernanceStores } from './governance';
import type { AtomLifecycleHooks, AtomLifecycleModeValue } from './lifecycle';

export interface ProjectAdapterContext<Config = unknown> {
  readonly repositoryRoot: string;
  readonly lifecycleMode: AtomLifecycleModeValue;
  readonly actor?: string;
  readonly config?: Config;
}

export interface ProjectAdapterResult extends CapabilityResult {
  readonly adapterName: string;
  readonly lifecycleMode: AtomLifecycleModeValue;
}

export interface ProjectAdapter<Config = unknown> {
  readonly adapterName: string;
  readonly adapterVersion: string;
  readonly capabilities: readonly CapabilityDescriptor[];
  readonly defaultConfig: Config;
  readonly lifecycle: AtomLifecycleHooks;
  readonly stores: GovernanceStores;
  initialize(context: ProjectAdapterContext<Config>): Promise<ProjectAdapterResult> | ProjectAdapterResult;
  prepareWorkItem(context: ProjectAdapterContext<Config>, workItem: WorkItemRef): Promise<ProjectAdapterResult> | ProjectAdapterResult;
  finalizeWorkItem(context: ProjectAdapterContext<Config>, workItem: WorkItemRef): Promise<ProjectAdapterResult> | ProjectAdapterResult;
  dispose?(context: ProjectAdapterContext<Config>): Promise<ProjectAdapterResult> | ProjectAdapterResult;
}