import type { EvidenceRecord, EvidenceSignalKind, EvidenceSignalScope } from '@ai-atomic-framework/core';

export type EvidencePatternTargetKind = 'atom' | 'atom-map' | 'host-local' | 'repo' | 'global' | 'unscoped';

export type EvidencePatternRecommendation = 'proposal-candidate' | 'observation-only';

export interface EvidencePatternDetectorThresholds {
  readonly minUsageCount: number;
  readonly minFrictionEvidence: number;
  readonly minConfidence: number;
}

export interface EvidencePatternDetectorInput {
  readonly evidence: readonly EvidenceRecord[];
  readonly window?: string;
  readonly thresholds?: Partial<EvidencePatternDetectorThresholds>;
  readonly generatedAt?: string;
  readonly detectorName?: string;
}

export interface EvidencePatternGroup {
  readonly groupId: string;
  readonly targetKind: EvidencePatternTargetKind;
  readonly targetId?: string;
  readonly signalKind: EvidenceSignalKind;
  readonly signalScope?: EvidenceSignalScope;
  readonly window: string;
  readonly usageCount: number;
  readonly frictionEvidenceCount: number;
  readonly positiveEvidenceCount: number;
  readonly neutralEvidenceCount: number;
  readonly matchedEvidenceIds: readonly string[];
  readonly rejectedEvidenceIds: readonly string[];
  readonly patternTags: readonly string[];
  readonly confidence: number;
  readonly recommendation: EvidencePatternRecommendation;
  readonly reasons: readonly string[];
}

export interface EvidencePatternDetectorReport {
  readonly schemaId: 'atm.evidencePatternDetectorReport';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly generatedAt: string;
  readonly detectorName: string;
  readonly window?: string;
  readonly thresholds: EvidencePatternDetectorThresholds;
  readonly summary: {
    readonly totalEvidence: number;
    readonly acceptedEvidence: number;
    readonly rejectedEvidence: number;
    readonly candidateGroups: number;
  };
  readonly groups: readonly EvidencePatternGroup[];
  readonly proposalCandidateGroupIds: readonly string[];
  readonly rejectedEvidenceIds: readonly string[];
  readonly empty: boolean;
}

type MutablePatternGroup = {
  targetKind: EvidencePatternTargetKind;
  targetId?: string;
  signalKind: EvidenceSignalKind;
  signalScope?: EvidenceSignalScope;
  window: string;
  usageCount: number;
  frictionEvidenceCount: number;
  positiveEvidenceCount: number;
  neutralEvidenceCount: number;
  matchedEvidenceIds: string[];
  rejectedEvidenceIds: string[];
  patternTags: Set<string>;
  confidenceValues: number[];
};

const frictionSignalKinds = new Set<EvidenceSignalKind>([
  'user-correction',
  'recurring-failure',
  'loaded-but-wrong',
  'metric-regression'
]);

const positiveSignalKinds = new Set<EvidenceSignalKind>([
  'workflow-success',
  'rollback-success'
]);

export const defaultEvidencePatternDetectorThresholds: EvidencePatternDetectorThresholds = {
  minUsageCount: 10,
  minFrictionEvidence: 1,
  minConfidence: 0.5
};

export function detectEvidencePatterns(input: EvidencePatternDetectorInput): EvidencePatternDetectorReport {
  const thresholds = {
    ...defaultEvidencePatternDetectorThresholds,
    ...(input.thresholds ?? {})
  };
  const groups = new Map<string, MutablePatternGroup>();
  const rejectedEvidenceIds: string[] = [];
  let acceptedEvidence = 0;

  input.evidence.forEach((evidence, index) => {
    const evidenceId = evidence.evidenceId ?? `inline-evidence-${index + 1}`;
    const signalKind = evidence.signalKind;
    if (!signalKind) {
      rejectedEvidenceIds.push(evidenceId);
      return;
    }
    const evidenceWindow = evidence.recurrence?.window ?? input.window ?? 'unspecified';
    if (input.window && evidenceWindow !== input.window) {
      rejectedEvidenceIds.push(evidenceId);
      return;
    }

    const target = resolveTarget(evidence);
    const groupKey = createGroupKey(target.targetKind, target.targetId, evidenceWindow, signalKind);
    const group = groups.get(groupKey) ?? createMutableGroup(target.targetKind, target.targetId, signalKind, evidence.signalScope, evidenceWindow);
    groups.set(groupKey, group);

    const confidence = evidence.confidence ?? 1;
    if (confidence < thresholds.minConfidence) {
      group.rejectedEvidenceIds.push(evidenceId);
      rejectedEvidenceIds.push(evidenceId);
      return;
    }

    acceptedEvidence += 1;
    group.usageCount += evidence.recurrence?.count ?? 1;
    group.matchedEvidenceIds.push(evidenceId);
    group.confidenceValues.push(confidence);
    for (const tag of evidence.patternTags ?? []) {
      group.patternTags.add(tag);
    }

    if (frictionSignalKinds.has(signalKind)) {
      group.frictionEvidenceCount += 1;
    } else if (positiveSignalKinds.has(signalKind)) {
      group.positiveEvidenceCount += 1;
    } else {
      group.neutralEvidenceCount += 1;
    }
  });

  const finalizedGroups = [...groups.values()]
    .map((group) => finalizeGroup(group, thresholds))
    .sort(compareGroups);
  const proposalCandidateGroupIds = finalizedGroups
    .filter((group) => group.recommendation === 'proposal-candidate')
    .map((group) => group.groupId);

  return {
    schemaId: 'atm.evidencePatternDetectorReport',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Initial deterministic evidence pattern detector report.'
    },
    generatedAt: input.generatedAt ?? '1970-01-01T00:00:00.000Z',
    detectorName: input.detectorName ?? 'deterministic-evidence-pattern-detector',
    ...(input.window ? { window: input.window } : {}),
    thresholds,
    summary: {
      totalEvidence: input.evidence.length,
      acceptedEvidence,
      rejectedEvidence: rejectedEvidenceIds.length,
      candidateGroups: proposalCandidateGroupIds.length
    },
    groups: finalizedGroups,
    proposalCandidateGroupIds,
    rejectedEvidenceIds,
    empty: finalizedGroups.length === 0
  };
}

function resolveTarget(evidence: EvidenceRecord): { targetKind: EvidencePatternTargetKind; targetId?: string } {
  if (evidence.atomId) {
    return { targetKind: 'atom', targetId: evidence.atomId };
  }
  if (evidence.atomMapId) {
    return { targetKind: 'atom-map', targetId: evidence.atomMapId };
  }
  if (evidence.signalScope === 'host-local') {
    return { targetKind: 'host-local' };
  }
  if (evidence.signalScope === 'repo') {
    return { targetKind: 'repo' };
  }
  if (evidence.signalScope === 'global') {
    return { targetKind: 'global' };
  }
  return { targetKind: 'unscoped' };
}

function createMutableGroup(
  targetKind: EvidencePatternTargetKind,
  targetId: string | undefined,
  signalKind: EvidenceSignalKind,
  signalScope: EvidenceSignalScope | undefined,
  window: string
): MutablePatternGroup {
  return {
    targetKind,
    ...(targetId ? { targetId } : {}),
    signalKind,
    ...(signalScope ? { signalScope } : {}),
    window,
    usageCount: 0,
    frictionEvidenceCount: 0,
    positiveEvidenceCount: 0,
    neutralEvidenceCount: 0,
    matchedEvidenceIds: [],
    rejectedEvidenceIds: [],
    patternTags: new Set<string>(),
    confidenceValues: []
  };
}

function finalizeGroup(group: MutablePatternGroup, thresholds: EvidencePatternDetectorThresholds): EvidencePatternGroup {
  const reasons: string[] = [];
  if (group.matchedEvidenceIds.length === 0) {
    reasons.push('no-evidence-above-confidence-threshold');
  }
  if (!frictionSignalKinds.has(group.signalKind)) {
    reasons.push('non-friction-signal');
  }
  if (group.usageCount < thresholds.minUsageCount) {
    reasons.push('usage-threshold-not-met');
  }
  if (group.frictionEvidenceCount < thresholds.minFrictionEvidence) {
    reasons.push('friction-threshold-not-met');
  }
  if (group.targetKind !== 'atom' && group.targetKind !== 'atom-map') {
    reasons.push('target-not-proposal-surface');
  }

  const recommendation: EvidencePatternRecommendation = reasons.length === 0
    ? 'proposal-candidate'
    : 'observation-only';
  const confidence = group.confidenceValues.length === 0
    ? 0
    : Number((group.confidenceValues.reduce((sum, value) => sum + value, 0) / group.confidenceValues.length).toFixed(4));

  return {
    groupId: createGroupKey(group.targetKind, group.targetId, group.window, group.signalKind),
    targetKind: group.targetKind,
    ...(group.targetId ? { targetId: group.targetId } : {}),
    signalKind: group.signalKind,
    ...(group.signalScope ? { signalScope: group.signalScope } : {}),
    window: group.window,
    usageCount: group.usageCount,
    frictionEvidenceCount: group.frictionEvidenceCount,
    positiveEvidenceCount: group.positiveEvidenceCount,
    neutralEvidenceCount: group.neutralEvidenceCount,
    matchedEvidenceIds: [...group.matchedEvidenceIds].sort(),
    rejectedEvidenceIds: [...group.rejectedEvidenceIds].sort(),
    patternTags: [...group.patternTags].sort(),
    confidence,
    recommendation,
    reasons
  };
}

function createGroupKey(
  targetKind: EvidencePatternTargetKind,
  targetId: string | undefined,
  window: string,
  signalKind: EvidenceSignalKind
): string {
  return [
    'evidence-pattern',
    targetKind,
    sanitizeIdentifier(targetId ?? 'unscoped'),
    sanitizeIdentifier(window),
    signalKind
  ].join('.');
}

function sanitizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'unspecified';
}

function compareGroups(left: EvidencePatternGroup, right: EvidencePatternGroup): number {
  return left.groupId.localeCompare(right.groupId);
}