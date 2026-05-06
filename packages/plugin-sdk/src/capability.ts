import type { ArtifactRecord, EvidenceRecord } from '@ai-atomic-framework/core';
import type { AtomLifecycleModeValue } from './lifecycle';

export type CapabilityKind =
  | 'project-adapter'
  | 'language-adapter'
  | 'task-store'
  | 'lock-store'
  | 'document-index'
  | 'shard-store'
  | 'artifact-store'
  | 'log-store'
  | 'state-store'
  | 'rule-guard'
  | 'evidence-store'
  | 'injector-plugin'
  | 'version-resolver'
  | 'quality-metrics-comparator'
  | 'upgrade-proposal-adapter';

export interface CapabilityDescriptor {
  readonly capabilityId: string;
  readonly kind: CapabilityKind;
  readonly required: boolean;
  readonly lifecycleModes: readonly AtomLifecycleModeValue[];
  readonly description: string;
}

export interface CapabilityContext {
  readonly repositoryRoot: string;
  readonly lifecycleMode: AtomLifecycleModeValue;
  readonly actor?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CapabilityResult {
  readonly ok: boolean;
  readonly messages: readonly string[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly evidence: readonly EvidenceRecord[];
}

export interface CapabilityProvider {
  readonly capability: CapabilityDescriptor;
  runCapability(context: CapabilityContext): Promise<CapabilityResult> | CapabilityResult;
}

export interface CapabilityRegistry {
  readonly capabilities: readonly CapabilityDescriptor[];
  getCapability(capabilityId: string): CapabilityDescriptor | null;
}