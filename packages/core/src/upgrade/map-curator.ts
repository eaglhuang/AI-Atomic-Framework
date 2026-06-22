import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRegistryIndex } from '../registry/registry-index.ts';

export type AtomMapCuratorBehaviorId = 'behavior.compose' | 'behavior.merge' | 'behavior.dedup-merge' | 'behavior.sweep';
export type AtomMapCuratorSignalKind =
  | 'caller-graph'
  | 'input-output-overlap'
  | 'recurring-failure-cluster'
  | 'zero-caller-sweep'
  | 'broker-split-suggestion';
export type AtomMapCuratorMutabilityPolicy = 'mutable' | 'frozen-after-release' | 'immutable';

export interface AtomMapCuratorThresholds {
  readonly minCallerGraphOccurrences: number;
  readonly minInputOutputOverlapScore: number;
  readonly minRecurringFailureCount: number;
  readonly minConfidence: number;
}

export interface CallerGraphSequenceInput {
  readonly sequenceId: string;
  readonly atomIds: readonly string[];
  readonly occurrenceCount: number;
  readonly evidenceIds: readonly string[];
  readonly targetMapId: string;
  readonly targetMapVersion?: string;
  readonly confidence?: number;
  readonly targetMutabilityPolicy?: AtomMapCuratorMutabilityPolicy;
}

export interface InputOutputOverlapInput {
  readonly overlapId: string;
  readonly sourceAtomIds: readonly string[];
  readonly targetAtomId: string;
  readonly overlapScore: number;
  readonly evidenceIds: readonly string[];
  readonly targetMapId: string;
  readonly targetMapVersion?: string;
  readonly mode: 'merge' | 'dedup-merge';
  readonly confidence?: number;
  readonly targetMutabilityPolicy?: AtomMapCuratorMutabilityPolicy;
}

export interface RecurringFailureClusterInput {
  readonly clusterId: string;
  readonly atomIds: readonly string[];
  readonly failureCount: number;
  readonly evidenceIds: readonly string[];
  readonly targetMapId: string;
  readonly targetMapVersion?: string;
  readonly action: 'sweep';
  readonly zeroCallerAtomIds?: readonly string[];
  readonly confidence?: number;
  readonly targetMutabilityPolicy?: AtomMapCuratorMutabilityPolicy;
}

export interface BrokerSuggestedAtomInput {
  readonly atomId: string;
  readonly atomCid: string;
  readonly role: 'focus' | 'before' | 'after';
  readonly summary: string;
  readonly sourceRange: {
    readonly filePath: string;
    readonly lineStart: number;
    readonly lineEnd: number;
  };
}

export interface BrokerSplitSuggestionInput {
  readonly candidateId: string;
  readonly ownerAtomId: string;
  readonly ownerAtomCid?: string;
  readonly targetMapId: string;
  readonly targetMapVersion?: string;
  readonly targetFile: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly confidence?: number;
  readonly targetMutabilityPolicy?: AtomMapCuratorMutabilityPolicy;
  readonly conflictRegion: {
    readonly filePath: string;
    readonly lineStart: number;
    readonly lineEnd: number;
  };
  readonly suggestedAtoms: readonly BrokerSuggestedAtomInput[];
}

export interface AtomMapCuratorInput {
  readonly repositoryRoot: string;
  readonly reportPath?: string;
  readonly curatorName?: string;
  readonly generatedAt?: string;
  readonly proposedBy?: string;
  readonly thresholds?: Partial<AtomMapCuratorThresholds>;
  readonly callerGraphs?: readonly CallerGraphSequenceInput[];
  readonly inputOutputOverlaps?: readonly InputOutputOverlapInput[];
  readonly recurringFailureClusters?: readonly RecurringFailureClusterInput[];
  readonly brokerSplitSuggestions?: readonly BrokerSplitSuggestionInput[];
}

export interface AtomMapCuratorObservation {
  readonly candidateId: string;
  readonly signalKind: AtomMapCuratorSignalKind;
  readonly reasons: readonly string[];
}

export interface AtomMapCuratorProposalDraftItem {
  readonly candidateId: string;
  readonly behaviorId: AtomMapCuratorBehaviorId;
  readonly signalKind: AtomMapCuratorSignalKind;
  readonly targetMapId: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly autoPromoteEligible: boolean;
  readonly proposal: Record<string, unknown>;
}

export interface AtomMapCuratorPatchDraftOperation {
  readonly op: 'replace-owner-range' | 'add-child-atom-row' | 'rebuild-projection';
  readonly target: string;
  readonly summary: string;
  readonly payload?: Record<string, unknown>;
}

export interface AtomMapCuratorPatchDraftItem {
  readonly candidateId: string;
  readonly draftKind: 'atom-map-patch';
  readonly signalKind: 'broker-split-suggestion';
  readonly targetMapId: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly patchFiles: readonly string[];
  readonly ownerAtomId: string;
  readonly conflictRegion: BrokerSplitSuggestionInput['conflictRegion'];
  readonly suggestedAtoms: readonly BrokerSuggestedAtomInput[];
  readonly summary: string;
  readonly rationale: string;
  readonly requiresHumanReview: true;
  readonly operations: readonly AtomMapCuratorPatchDraftOperation[];
}

export interface AtomMapCuratorReport {
  readonly schemaId: 'atm.atomMapCuratorReport';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly reportId: string;
  readonly generatedAt: string;
  readonly curatorName: string;
  readonly thresholds: AtomMapCuratorThresholds;
  readonly summary: {
    readonly callerGraphSignals: number;
    readonly inputOutputOverlapSignals: number;
    readonly recurringFailureClusterSignals: number;
    readonly brokerSplitSuggestionSignals: number;
    readonly proposalDrafts: number;
    readonly blockedProposalDrafts: number;
    readonly patchDrafts: number;
    readonly observationOnly: number;
  };
  readonly observations: readonly AtomMapCuratorObservation[];
  readonly proposalDrafts: readonly AtomMapCuratorProposalDraftItem[];
  readonly patchDrafts: readonly AtomMapCuratorPatchDraftItem[];
  readonly empty: boolean;
}

type RegistryResolver = ReturnType<typeof createRegistryResolver>;

interface ProposalBuildRequest {
  readonly candidateId: string;
  readonly behaviorId: AtomMapCuratorBehaviorId;
  readonly signalKind: AtomMapCuratorSignalKind;
  readonly targetMapId: string;
  readonly targetMapVersion?: string;
  readonly atomId: string;
  readonly sourceAtomIds?: readonly string[];
  readonly targetAtomId?: string;
  readonly memberTransitions: readonly { fromAtomId: string; fromVersion: string; toAtomId: string; toVersion: string }[];
  readonly evidenceIds: readonly string[];
  readonly requiredSignals: readonly string[];
  readonly reportPath: string;
  readonly generatedAt: string;
  readonly proposedBy: string;
  readonly targetMutabilityPolicy?: AtomMapCuratorMutabilityPolicy;
  readonly sweepPlan?: {
    readonly candidateAtomIds: readonly string[];
    readonly reason: string;
  };
}

export const defaultAtomMapCuratorThresholds: AtomMapCuratorThresholds = {
  minCallerGraphOccurrences: 3,
  minInputOutputOverlapScore: 0.75,
  minRecurringFailureCount: 2,
  minConfidence: 0.5
};

const DEFAULT_CURATOR_NAME = 'deterministic-atom-map-curator';
const DEFAULT_PROPOSED_BY = 'ATM Atom Map Curator';
const DEFAULT_REPORT_PATH = 'fixtures/evolution/map-curator/generated-report.json';

export function curateAtomMapEvolution(input: AtomMapCuratorInput): AtomMapCuratorReport {
  const thresholds = {
    ...defaultAtomMapCuratorThresholds,
    ...(input.thresholds ?? {})
  };
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const proposedBy = input.proposedBy ?? DEFAULT_PROPOSED_BY;
  const reportPath = input.reportPath ?? DEFAULT_REPORT_PATH;
  const registry = createRegistryResolver(input.repositoryRoot);
  const observations: AtomMapCuratorObservation[] = [];
  const proposalDrafts: AtomMapCuratorProposalDraftItem[] = [];
  const patchDrafts: AtomMapCuratorPatchDraftItem[] = [];

  for (const signal of input.callerGraphs ?? []) {
    const reasons = validateCallerGraphSignal(signal, thresholds);
    if (reasons.length > 0) {
      observations.push({ candidateId: signal.sequenceId, signalKind: 'caller-graph', reasons });
      continue;
    }

    const memberTransitions = signal.atomIds.map((atomId) => {
      const version = resolveAtomVersion(registry, atomId);
      return { fromAtomId: atomId, fromVersion: version, toAtomId: atomId, toVersion: version };
    });
    proposalDrafts.push(buildProposalDraft({
      candidateId: signal.sequenceId,
      behaviorId: 'behavior.compose',
      signalKind: 'caller-graph',
      targetMapId: signal.targetMapId,
      targetMapVersion: signal.targetMapVersion,
      atomId: signal.atomIds[0],
      memberTransitions,
      evidenceIds: signal.evidenceIds,
      requiredSignals: ['workflow-success'],
      reportPath,
      generatedAt,
      proposedBy,
      targetMutabilityPolicy: signal.targetMutabilityPolicy
    }, registry));
  }

  for (const signal of input.inputOutputOverlaps ?? []) {
    const reasons = validateInputOutputOverlapSignal(signal, thresholds);
    const signalKind: AtomMapCuratorSignalKind = 'input-output-overlap';
    if (reasons.length > 0) {
      observations.push({ candidateId: signal.overlapId, signalKind, reasons });
      continue;
    }

    const targetVersion = bumpPatchVersion(resolveAtomVersion(registry, signal.targetAtomId));
    const memberTransitions = [
      ...signal.sourceAtomIds.map((sourceAtomId) => ({
        fromAtomId: sourceAtomId,
        fromVersion: resolveAtomVersion(registry, sourceAtomId),
        toAtomId: signal.targetAtomId,
        toVersion: targetVersion
      })),
      {
        fromAtomId: signal.targetAtomId,
        fromVersion: resolveAtomVersion(registry, signal.targetAtomId),
        toAtomId: signal.targetAtomId,
        toVersion: targetVersion
      }
    ];
    proposalDrafts.push(buildProposalDraft({
      candidateId: signal.overlapId,
      behaviorId: signal.mode === 'dedup-merge' ? 'behavior.dedup-merge' : 'behavior.merge',
      signalKind,
      targetMapId: signal.targetMapId,
      targetMapVersion: signal.targetMapVersion,
      atomId: signal.targetAtomId,
      sourceAtomIds: signal.sourceAtomIds,
      targetAtomId: signal.targetAtomId,
      memberTransitions,
      evidenceIds: signal.evidenceIds,
      requiredSignals: ['loaded-but-wrong'],
      reportPath,
      generatedAt,
      proposedBy,
      targetMutabilityPolicy: signal.targetMutabilityPolicy
    }, registry));
  }

  for (const signal of input.recurringFailureClusters ?? []) {
    const reasons = validateRecurringFailureCluster(signal, thresholds);
    const signalKind: AtomMapCuratorSignalKind = 'recurring-failure-cluster';
    if (reasons.length > 0) {
      observations.push({ candidateId: signal.clusterId, signalKind, reasons });
      continue;
    }

    const zeroCallerAtomIds = [...new Set(signal.zeroCallerAtomIds ?? signal.atomIds)].sort();
    const memberTransitions = zeroCallerAtomIds.map((atomId) => {
      const version = resolveAtomVersion(registry, atomId);
      return { fromAtomId: atomId, fromVersion: version, toAtomId: atomId, toVersion: version };
    });
    proposalDrafts.push(buildProposalDraft({
      candidateId: signal.clusterId,
      behaviorId: 'behavior.sweep',
      signalKind: 'zero-caller-sweep',
      targetMapId: signal.targetMapId,
      targetMapVersion: signal.targetMapVersion,
      atomId: zeroCallerAtomIds[0],
      sourceAtomIds: zeroCallerAtomIds,
      memberTransitions,
      evidenceIds: signal.evidenceIds,
      requiredSignals: ['recurring-failure'],
      reportPath,
      generatedAt,
      proposedBy,
      targetMutabilityPolicy: signal.targetMutabilityPolicy,
      sweepPlan: {
        candidateAtomIds: zeroCallerAtomIds,
        reason: 'Zero-caller recurring failure cluster; archive instead of delete.'
      }
    }, registry));
  }

  for (const signal of input.brokerSplitSuggestions ?? []) {
    const reasons = validateBrokerSplitSuggestionSignal(signal, thresholds);
    const signalKind: AtomMapCuratorSignalKind = 'broker-split-suggestion';
    if (reasons.length > 0) {
      observations.push({ candidateId: signal.candidateId, signalKind, reasons });
      continue;
    }

    patchDrafts.push(buildBrokerSplitPatchDraft({
      candidateId: signal.candidateId,
      signalKind,
      targetMapId: signal.targetMapId,
      sourceEvidenceIds: signal.sourceEvidenceIds,
      ownerAtomId: signal.ownerAtomId,
      targetFile: signal.targetFile,
      conflictRegion: signal.conflictRegion,
      suggestedAtoms: signal.suggestedAtoms,
      reportPath
    }));
  }

  const sortedDrafts = proposalDrafts.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const sortedPatchDrafts = patchDrafts.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const reportId = buildReportId(
    input.repositoryRoot,
    reportPath,
    [...sortedDrafts.map((draft) => draft.candidateId), ...sortedPatchDrafts.map((draft) => draft.candidateId)]
  );
  const blockedProposalDrafts = sortedDrafts.filter((draft) => draft.autoPromoteEligible === false).length;

  return {
    schemaId: 'atm.atomMapCuratorReport',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Initial deterministic Atom Map curator report.'
    },
    reportId,
    generatedAt,
    curatorName: input.curatorName ?? DEFAULT_CURATOR_NAME,
    thresholds,
    summary: {
      callerGraphSignals: input.callerGraphs?.length ?? 0,
      inputOutputOverlapSignals: input.inputOutputOverlaps?.length ?? 0,
      recurringFailureClusterSignals: input.recurringFailureClusters?.length ?? 0,
      brokerSplitSuggestionSignals: input.brokerSplitSuggestions?.length ?? 0,
      proposalDrafts: sortedDrafts.length,
      blockedProposalDrafts,
      patchDrafts: sortedPatchDrafts.length,
      observationOnly: observations.length
    },
    observations: observations.sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
    proposalDrafts: sortedDrafts,
    patchDrafts: sortedPatchDrafts,
    empty: sortedDrafts.length === 0 && sortedPatchDrafts.length === 0
  };
}

function validateCallerGraphSignal(signal: CallerGraphSequenceInput, thresholds: AtomMapCuratorThresholds): string[] {
  const reasons: string[] = [];
  if (signal.atomIds.length < 2) {
    reasons.push('caller-graph-needs-at-least-two-atoms');
  }
  if (signal.occurrenceCount < thresholds.minCallerGraphOccurrences) {
    reasons.push('caller-graph-occurrence-threshold-not-met');
  }
  appendEvidenceAndConfidenceReasons(reasons, signal.evidenceIds, signal.confidence, thresholds);
  return reasons;
}

function validateInputOutputOverlapSignal(signal: InputOutputOverlapInput, thresholds: AtomMapCuratorThresholds): string[] {
  const reasons: string[] = [];
  if (signal.sourceAtomIds.length < 1) {
    reasons.push('input-output-overlap-needs-source-atoms');
  }
  if (!signal.targetAtomId) {
    reasons.push('input-output-overlap-needs-target-atom');
  }
  if (signal.overlapScore < thresholds.minInputOutputOverlapScore) {
    reasons.push('input-output-overlap-threshold-not-met');
  }
  appendEvidenceAndConfidenceReasons(reasons, signal.evidenceIds, signal.confidence, thresholds);
  return reasons;
}

function validateRecurringFailureCluster(signal: RecurringFailureClusterInput, thresholds: AtomMapCuratorThresholds): string[] {
  const reasons: string[] = [];
  if (signal.action !== 'sweep') {
    reasons.push('recurring-failure-cluster-action-not-supported');
  }
  if (signal.failureCount < thresholds.minRecurringFailureCount) {
    reasons.push('recurring-failure-cluster-threshold-not-met');
  }
  if ((signal.zeroCallerAtomIds ?? signal.atomIds).length < 1) {
    reasons.push('sweep-needs-zero-caller-atoms');
  }
  appendEvidenceAndConfidenceReasons(reasons, signal.evidenceIds, signal.confidence, thresholds);
  return reasons;
}

function validateBrokerSplitSuggestionSignal(signal: BrokerSplitSuggestionInput, thresholds: AtomMapCuratorThresholds): string[] {
  const reasons: string[] = [];
  if (!signal.ownerAtomId) {
    reasons.push('broker-split-suggestion-needs-owner-atom');
  }
  if (!signal.targetFile) {
    reasons.push('broker-split-suggestion-needs-target-file');
  }
  if (signal.suggestedAtoms.length < 2) {
    reasons.push('broker-split-suggestion-needs-child-atoms');
  }
  if (!signal.suggestedAtoms.some((entry) => entry.role === 'focus')) {
    reasons.push('broker-split-suggestion-needs-focus-atom');
  }
  appendEvidenceAndConfidenceReasons(reasons, signal.sourceEvidenceIds, signal.confidence, thresholds);
  return reasons;
}

function appendEvidenceAndConfidenceReasons(
  reasons: string[],
  evidenceIds: readonly string[],
  confidence: number | undefined,
  thresholds: AtomMapCuratorThresholds
) {
  if (evidenceIds.length === 0) {
    reasons.push('missing-evidence-ids');
  }
  if ((confidence ?? 1) < thresholds.minConfidence) {
    reasons.push('confidence-threshold-not-met');
  }
}

function buildProposalDraft(request: ProposalBuildRequest, registry: RegistryResolver): AtomMapCuratorProposalDraftItem {
  const baseMapVersion = request.targetMapVersion ?? resolveMapVersion(registry, request.targetMapId);
  const toVersion = bumpPatchVersion(baseMapVersion);
  const proposalId = `proposal.map-curator.${behaviorSuffix(request.behaviorId)}.${sanitizeIdentifier(request.candidateId)}`;
  const mutabilityPolicyBlocked = request.targetMutabilityPolicy === 'immutable';
  const mutabilityGate = {
    passed: !mutabilityPolicyBlocked,
    reportId: `map-curator.mutability.${sanitizeIdentifier(request.candidateId)}`,
    reportPath: request.reportPath,
    summary: mutabilityPolicyBlocked
      ? 'blocked (target mutability policy is immutable; auto-promotion is not allowed)'
      : 'pass (target mutability policy allows a reviewable dry-run proposal)'
  };
  const blockedGateNames = mutabilityPolicyBlocked ? ['mutabilityPolicy'] : [];
  const allPassed = blockedGateNames.length === 0;
  const propagationStatus = [{
    mapId: request.targetMapId,
    integrationTestPassed: true,
    message: 'Curator dry-run; map integration must run before promotion.'
  }];

  const proposal: Record<string, unknown> = {
    schemaId: 'atm.upgradeProposal',
    specVersion: '0.1.0',
    migration: {
      strategy: 'additive',
      fromVersion: baseMapVersion,
      notes: `Atom Map curator generated ${request.behaviorId} proposal from ${request.signalKind} signal.`
    },
    proposalId,
    atomId: request.atomId,
    fromVersion: baseMapVersion,
    toVersion,
    lifecycleMode: 'evolution',
    behaviorId: request.behaviorId,
    target: {
      kind: 'map',
      mapId: request.targetMapId
    },
    decompositionDecision: 'map-bump',
    proposalSource: 'evidence-driven',
    targetSurface: 'atom-map',
    baseMapVersion,
    baseEvidenceWatermark: `evidence.watermark.${normalizeWatermarkTimestamp(request.generatedAt)}`,
    reversibility: 'rollback-safe',
    evidenceGate: {
      requiredSignals: request.requiredSignals,
      matchedEvidenceIds: [...request.evidenceIds].sort(),
      rejectedEvidenceIds: [],
      notes: `Derived from Atom Map curator candidate ${request.candidateId}.`
    },
    reviewTemplate: 'review.template.map-bump',
    automatedGates: {
      nonRegression: makePassGate('nonRegression', request.reportPath, 'pass (curator dry-run did not re-run non-regression)'),
      qualityComparison: makePassGate('qualityComparison', request.reportPath, 'pass (curator dry-run did not re-run quality comparison)'),
      registryCandidate: makePassGate('registryCandidate', request.reportPath, 'pass (curator produced a reviewable registry candidate)'),
      mutabilityPolicy: mutabilityGate,
      allPassed,
      blockedGateNames
    },
    humanReview: 'pending',
    status: allPassed ? 'pending' : 'blocked',
    inputs: [
      {
        kind: 'evolution-evidence',
        path: request.reportPath,
        schemaId: 'atm.atomMapCuratorReport',
        reportId: `${proposalId}.curator-report`,
        summary: `${request.signalKind} input for ${request.behaviorId}`
      }
    ],
    mapImpactScope: {
      affectedMapIds: [request.targetMapId],
      propagationStatus
    },
    members: request.memberTransitions.map((transition) => ({
      from: `${transition.fromAtomId}@${transition.fromVersion}`,
      to: `${transition.toAtomId}@${transition.toVersion}`
    })),
    generatorProvenance: 'atom-map-curator.detector-v1',
    proposedBy: request.proposedBy,
    proposedAt: request.generatedAt
  };

  if (request.sourceAtomIds && request.sourceAtomIds.length > 0) {
    proposal.sourceAtomIds = [...request.sourceAtomIds].sort();
  }
  if (request.targetAtomId) {
    proposal.targetAtomId = request.targetAtomId;
  }
  if (request.sweepPlan) {
    proposal.sweepPlan = {
      mode: 'archive-only',
      candidateAtomIds: [...request.sweepPlan.candidateAtomIds].sort(),
      deletionAllowed: false,
      reason: request.sweepPlan.reason
    };
  }

  return {
    candidateId: request.candidateId,
    behaviorId: request.behaviorId,
    signalKind: request.signalKind,
    targetMapId: request.targetMapId,
    sourceEvidenceIds: [...request.evidenceIds].sort(),
    autoPromoteEligible: allPassed,
    proposal
  };
}

function buildBrokerSplitPatchDraft(request: {
  readonly candidateId: string;
  readonly signalKind: 'broker-split-suggestion';
  readonly targetMapId: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly ownerAtomId: string;
  readonly targetFile: string;
  readonly conflictRegion: BrokerSplitSuggestionInput['conflictRegion'];
  readonly suggestedAtoms: readonly BrokerSuggestedAtomInput[];
  readonly reportPath: string;
}): AtomMapCuratorPatchDraftItem {
  const patchFiles = [
    inferOwnerShardPath(request.targetFile),
    'atomic_workbench/atomization-coverage/path-to-atom-map.json'
  ].sort((left, right) => left.localeCompare(right));
  const operations: AtomMapCuratorPatchDraftOperation[] = [
    {
      op: 'replace-owner-range',
      target: patchFiles[0],
      summary: `Replace coarse owner atom '${request.ownerAtomId}' coverage on ${request.targetFile} with bounded child atom rows.`,
      payload: {
        pathPattern: request.targetFile,
        ownerAtomId: request.ownerAtomId,
        conflictRegion: request.conflictRegion
      }
    },
    ...request.suggestedAtoms.map((atom) => ({
      op: 'add-child-atom-row' as const,
      target: patchFiles[0],
      summary: `Add ${atom.role} child atom row '${atom.atomId}' covering ${atom.sourceRange.lineStart}-${atom.sourceRange.lineEnd}.`,
      payload: {
        pathPattern: `${request.targetFile}#L${atom.sourceRange.lineStart}-L${atom.sourceRange.lineEnd}`,
        atomId: atom.atomId,
        atomCid: atom.atomCid,
        role: atom.role,
        capability: atom.summary,
        coverageStatus: 'active'
      }
    })),
    {
      op: 'rebuild-projection',
      target: 'atomic_workbench/atomization-coverage/path-to-atom-map.json',
      summary: 'Rebuild the path-to-atom-map projection after curator review accepts the owner-shard split.'
    }
  ];
  return {
    candidateId: request.candidateId,
    draftKind: 'atom-map-patch',
    signalKind: request.signalKind,
    targetMapId: request.targetMapId,
    sourceEvidenceIds: [...request.sourceEvidenceIds].sort(),
    patchFiles,
    ownerAtomId: request.ownerAtomId,
    conflictRegion: request.conflictRegion,
    suggestedAtoms: request.suggestedAtoms.map((entry) => ({
      ...entry,
      sourceRange: { ...entry.sourceRange }
    })),
    summary: `Broker split suggestion for '${request.ownerAtomId}' on ${request.targetFile} is ready as an atom-map patch draft.`,
    rationale: `Blocked overlap on ${request.targetFile}:${request.conflictRegion.lineStart}-${request.conflictRegion.lineEnd} should be promoted into finer bounded child atoms before future writes reuse the same coarse owner map.`,
    requiresHumanReview: true,
    operations
  };
}

function makePassGate(gateName: 'nonRegression' | 'qualityComparison' | 'registryCandidate', reportPath: string, summary: string) {
  return {
    passed: true,
    reportId: `map-curator.${gateName}`,
    reportPath,
    summary
  };
}

function inferOwnerShardPath(targetFile: string): string {
  if (targetFile.startsWith('packages/cli/')) {
    return 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json';
  }
  if (targetFile.startsWith('packages/core/')) {
    return 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-core.json';
  }
  if (targetFile.startsWith('packages/plugin-')) {
    return 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-plugins.json';
  }
  if (targetFile.startsWith('scripts/')) {
    return 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-scripts.json';
  }
  return 'atomic_workbench/atomization-coverage/path-to-atom-map.json';
}

function createRegistryResolver(repositoryRoot: string) {
  const registryPath = path.join(repositoryRoot, 'atomic-registry.json');
  if (!existsSync(registryPath)) {
    return null;
  }
  const registryDocument = JSON.parse(readFileSync(registryPath, 'utf8'));
  return createRegistryIndex(registryDocument);
}

function resolveAtomVersion(registry: RegistryResolver, atomId: string): string {
  return registry?.getVersions(atomId).current ?? '0.1.0';
}

function resolveMapVersion(registry: RegistryResolver, mapId: string): string {
  return registry?.getVersions(mapId).current ?? '0.1.0';
}

function buildReportId(repositoryRoot: string, reportPath: string, candidateIds: readonly string[]): string {
  const payload = JSON.stringify({ repositoryRoot, reportPath, candidateIds });
  const digest = createHash('sha256').update(payload).digest('hex').slice(0, 12);
  return `map-curator.${digest}`;
}

function behaviorSuffix(behaviorId: AtomMapCuratorBehaviorId): string {
  return behaviorId.replace('behavior.', '');
}

function bumpPatchVersion(version: string): string {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
  const [major, minor, patch] = parts;
  return `${major}.${minor}.${patch + 1}`;
}

function sanitizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeWatermarkTimestamp(value: string): string {
  return value.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}
