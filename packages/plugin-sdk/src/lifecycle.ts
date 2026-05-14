import type { EvidenceRecord } from '@ai-atomic-framework/core';

export enum AtomLifecycleMode {
  Birth = 'birth',
  Evolution = 'evolution'
}

export type AtomLifecycleModeValue = `${AtomLifecycleMode}`;

export interface AtomLifecycleHookContext {
  readonly repositoryRoot: string;
  readonly atomId: string;
  readonly lifecycleMode: AtomLifecycleModeValue;
  readonly actor?: string;
  readonly startedAt?: string;
}

export interface AtomLifecycleHookResult {
  readonly ok: boolean;
  readonly messages: readonly string[];
  readonly evidence: readonly EvidenceRecord[];
}

export interface AtomLifecycleHooks {
  beforeBirth?(context: AtomLifecycleHookContext): Promise<AtomLifecycleHookResult> | AtomLifecycleHookResult;
  afterBirth?(context: AtomLifecycleHookContext): Promise<AtomLifecycleHookResult> | AtomLifecycleHookResult;
  beforeEvolution?(context: AtomLifecycleHookContext): Promise<AtomLifecycleHookResult> | AtomLifecycleHookResult;
  afterEvolution?(context: AtomLifecycleHookContext): Promise<AtomLifecycleHookResult> | AtomLifecycleHookResult;
}

export interface VersionResolverRequest {
  readonly atomId: string;
  readonly requestedVersion?: string;
  readonly lifecycleMode: AtomLifecycleModeValue;
  readonly registryVersion?: string;
}

export interface VersionResolution {
  readonly atomId: string;
  readonly selectedVersion: string;
  readonly lifecycleMode: AtomLifecycleModeValue;
  readonly reason: string;
}

export interface VersionResolver {
  readonly resolverName: string;
  resolveVersion(request: VersionResolverRequest): Promise<VersionResolution> | VersionResolution;
}

export interface QualityMetricsSnapshot {
  readonly atomId: string;
  readonly lifecycleMode: AtomLifecycleModeValue;
  readonly score: number;
  readonly metrics: Readonly<Record<string, number>>;
  readonly evidence: readonly EvidenceRecord[];
}

export interface QualityMetricsComparison {
  readonly ok: boolean;
  readonly regressed: boolean;
  readonly baseline: QualityMetricsSnapshot;
  readonly current: QualityMetricsSnapshot;
  readonly messages: readonly string[];
}

export interface QualityMetricsComparator {
  readonly comparatorName: string;
  compareMetrics(baseline: QualityMetricsSnapshot, current: QualityMetricsSnapshot): Promise<QualityMetricsComparison> | QualityMetricsComparison;
}

export interface UpgradeProposalRequest {
  readonly atomId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly lifecycleMode: AtomLifecycleModeValue;
  readonly rationale: string;
}

export type UpgradeProposalSource = 'evidence-driven' | 'metric-driven' | 'manual' | 'spec-diff';

export type UpgradeProposalTargetSurface = 'host-local-overlay' | 'workflow-recipe' | 'atom-spec' | 'atom-map';

export type UpgradeProposalReversibility = 'rollback-safe' | 'breaking';

export interface UpgradeProposalEvidenceGate {
  readonly requiredSignals?: readonly string[];
  readonly matchedEvidenceIds: readonly string[];
  readonly rejectedEvidenceIds?: readonly string[];
  readonly notes?: string;
}

export interface UpgradeProposal {
  readonly proposalId: string;
  readonly atomId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly lifecycleMode: AtomLifecycleModeValue;
  readonly proposalSource?: UpgradeProposalSource;
  readonly targetSurface?: UpgradeProposalTargetSurface;
  readonly baseAtomVersion?: string;
  readonly baseMapVersion?: string;
  readonly baseEvidenceWatermark?: string;
  readonly reversibility?: UpgradeProposalReversibility;
  readonly evidenceGate?: UpgradeProposalEvidenceGate;
  readonly accepted: boolean;
  readonly evidence: readonly EvidenceRecord[];
}

export interface UpgradeProposalAdapter {
  readonly adapterName: string;
  proposeUpgrade(request: UpgradeProposalRequest): Promise<UpgradeProposal> | UpgradeProposal;
}