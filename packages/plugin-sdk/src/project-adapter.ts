import type { HostGate, MutationPolicy, NoTouchZone, WorkItemRef } from '@ai-atomic-framework/core';
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

export interface ProjectAdapterLegacyUriResolution {
  readonly uri: string;
  readonly scheme: 'legacy';
  readonly repositoryAlias: string;
  readonly relativePath: string;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
  readonly fragment: string | null;
  readonly absolutePath?: string;
  readonly exists?: boolean;
}

export interface ProjectAdapterDryRunPatchContract {
  readonly contractId: string;
  readonly behaviorId: 'behavior.atomize' | 'behavior.infect';
  readonly dryRun: true;
  readonly applyToHostProject: false;
  readonly hostMutationAllowed: false;
  readonly patchMode: 'dry-run';
  readonly proposalSource: 'ATM-2-0020';
  readonly decompositionDecision: 'atom-extract';
  readonly patchFiles: readonly string[];
}

export interface ProjectAdapterNeutralitySummary {
  readonly ok: boolean;
  readonly violationCount: number;
  readonly bannedTerms: readonly string[];
  readonly scannedPath: string;
}

export type { HostGate, MutationPolicy, NoTouchZone };

export interface AtomizeAdapterRequest {
  readonly behaviorId: 'behavior.atomize';
  readonly legacySource: string;
  readonly dryRun: true;
  readonly inlineSource?: string;
  readonly patchFiles?: readonly string[];
}

export interface InfectAdapterRequest {
  readonly behaviorId: 'behavior.infect';
  readonly legacySource: string;
  readonly dryRun: true;
  readonly inlineSource?: string;
  readonly patchFiles?: readonly string[];
}

export interface ProjectAdapterDryRunResult extends ProjectAdapterResult {
  readonly resolvedLegacyUri: ProjectAdapterLegacyUriResolution;
  readonly dryRunPatch: ProjectAdapterDryRunPatchContract;
  readonly neutrality: ProjectAdapterNeutralitySummary;
}

export interface ProjectAdapter<Config = unknown> {
  readonly adapterName: string;
  readonly adapterVersion: string;
  readonly capabilities: readonly CapabilityDescriptor[];
  readonly defaultConfig: Config;
  readonly lifecycle: AtomLifecycleHooks;
  readonly stores: GovernanceStores;
  resolveLegacyUri(context: ProjectAdapterContext<Config>, legacyUri: string): Promise<ProjectAdapterLegacyUriResolution> | ProjectAdapterLegacyUriResolution;
  runAtomizeAdapter(context: ProjectAdapterContext<Config>, request: AtomizeAdapterRequest): Promise<ProjectAdapterDryRunResult> | ProjectAdapterDryRunResult;
  runInfectAdapter(context: ProjectAdapterContext<Config>, request: InfectAdapterRequest): Promise<ProjectAdapterDryRunResult> | ProjectAdapterDryRunResult;
  initialize(context: ProjectAdapterContext<Config>): Promise<ProjectAdapterResult> | ProjectAdapterResult;
  prepareWorkItem(context: ProjectAdapterContext<Config>, workItem: WorkItemRef): Promise<ProjectAdapterResult> | ProjectAdapterResult;
  finalizeWorkItem(context: ProjectAdapterContext<Config>, workItem: WorkItemRef): Promise<ProjectAdapterResult> | ProjectAdapterResult;
  listHostGates?(context: ProjectAdapterContext<Config>): Promise<readonly HostGate[]> | readonly HostGate[];
  listNoTouchZones?(context: ProjectAdapterContext<Config>): Promise<readonly NoTouchZone[]> | readonly NoTouchZone[];
  resolveMutationPolicy?(context: ProjectAdapterContext<Config>): Promise<MutationPolicy> | MutationPolicy;
  dispose?(context: ProjectAdapterContext<Config>): Promise<ProjectAdapterResult> | ProjectAdapterResult;
}