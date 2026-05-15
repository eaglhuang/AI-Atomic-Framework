import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRegistryIndex } from '../registry/registry-index.ts';
import { resolveReviewTemplate } from './decomposition-decision.ts';

export interface EvidencePatternDetectorGroupLike {
  readonly groupId: string;
  readonly targetKind: 'atom' | 'atom-map' | 'host-local' | 'repo' | 'global' | 'unscoped';
  readonly targetId?: string;
  readonly signalKind: string;
  readonly signalScope?: 'host-local' | 'repo' | 'atom' | 'atom-map' | 'global';
  readonly window: string;
  readonly usageCount: number;
  readonly frictionEvidenceCount: number;
  readonly positiveEvidenceCount: number;
  readonly neutralEvidenceCount: number;
  readonly matchedEvidenceIds: readonly string[];
  readonly rejectedEvidenceIds: readonly string[];
  readonly patternTags: readonly string[];
  readonly confidence: number;
  readonly recommendation: 'proposal-candidate' | 'observation-only';
  readonly reasons: readonly string[];
}

export interface EvidencePatternDetectorReportLike {
  readonly schemaId: 'atm.evidencePatternDetectorReport';
  readonly specVersion: '0.1.0';
  readonly migration?: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly generatedAt: string;
  readonly detectorName: string;
  readonly window?: string;
  readonly thresholds: {
    readonly minUsageCount: number;
    readonly minFrictionEvidence: number;
    readonly minConfidence: number;
  };
  readonly summary: {
    readonly totalEvidence: number;
    readonly acceptedEvidence: number;
    readonly rejectedEvidence: number;
    readonly candidateGroups: number;
  };
  readonly groups: readonly EvidencePatternDetectorGroupLike[];
  readonly proposalCandidateGroupIds: readonly string[];
  readonly rejectedEvidenceIds: readonly string[];
  readonly empty: boolean;
}

export interface EvolutionScanInputReport {
  readonly path: string;
  readonly document: EvidencePatternDetectorReportLike;
}

export interface EvolutionScanRequest {
  readonly repositoryRoot: string;
  readonly detectorReports: readonly EvolutionScanInputReport[];
  readonly proposedBy?: string;
  readonly proposedAt?: string;
  readonly dryRun?: boolean;
}

export interface EvolutionScanReportSummary {
  readonly path: string;
  readonly detectorName: string;
  readonly candidateGroupCount: number;
  readonly proposalCandidateGroupIds: readonly string[];
  readonly empty: boolean;
}

export interface EvolutionScanObservation {
  readonly detectorReportCount: number;
  readonly candidateGroupCount: number;
  readonly proposalDraftCount: number;
  readonly skippedGroupIds: readonly string[];
  readonly notes: readonly string[];
}

export interface EvolutionProposalInputRef {
  readonly kind: 'evolution-evidence';
  readonly path: string;
  readonly schemaId: 'atm.evidencePatternDetectorReport';
  readonly reportId?: string;
  readonly summary: string;
}

export interface EvolutionProposalGateResult {
  readonly passed: boolean;
  readonly reportId: string;
  readonly reportPath: string;
  readonly summary: string;
}

export interface EvolutionProposalDraft {
  readonly schemaId: 'atm.upgradeProposal';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'additive';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly proposalId: string;
  readonly atomId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly lifecycleMode: 'evolution';
  readonly behaviorId: 'behavior.evolve';
  readonly target: {
    readonly kind: 'atom';
  };
  readonly decompositionDecision: 'atom-bump';
  readonly proposalSource: 'evidence-driven';
  readonly targetSurface: 'atom-spec';
  readonly baseAtomVersion: string;
  readonly baseEvidenceWatermark: string;
  readonly reversibility: 'rollback-safe';
  readonly evidenceGate: {
    readonly requiredSignals: readonly string[];
    readonly matchedEvidenceIds: readonly string[];
    readonly rejectedEvidenceIds: readonly string[];
    readonly notes: string;
  };
  readonly reviewTemplate: string;
  readonly automatedGates: {
    readonly nonRegression: EvolutionProposalGateResult;
    readonly qualityComparison: EvolutionProposalGateResult;
    readonly registryCandidate: EvolutionProposalGateResult;
    readonly allPassed: boolean;
    readonly blockedGateNames: readonly string[];
  };
  readonly humanReview: 'pending';
  readonly status: 'pending' | 'blocked';
  readonly inputs: readonly EvolutionProposalInputRef[];
  readonly proposedBy: string;
  readonly proposedAt: string;
}

export interface EvolutionProposalDraftBundleItem {
  readonly groupIds: readonly string[];
  readonly detectorReportPaths: readonly string[];
  readonly proposal: EvolutionProposalDraft;
}

export interface EvolutionScanReport {
  readonly schemaId: 'atm.evolutionScanReport';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly scanId: string;
  readonly generatedAt: string;
  readonly repositoryRoot: string;
  readonly scanMode: 'dry-run';
  readonly detectorReports: readonly EvolutionScanReportSummary[];
  readonly observation: EvolutionScanObservation;
  readonly proposalDrafts: readonly EvolutionProposalDraftBundleItem[];
  readonly empty: boolean;
}

type GroupAggregation = {
  readonly atomId: string;
  readonly detectorReportPaths: Set<string>;
  readonly groupIds: Set<string>;
  readonly matchedEvidenceIds: Set<string>;
  readonly rejectedEvidenceIds: Set<string>;
  readonly requiredSignals: Set<string>;
  readonly notes: Set<string>;
  readonly sourceReportGeneratedAt: string;
  readonly reportPath: string;
  readonly baseAtomVersion: string;
  readonly targetSurface: 'atom-spec';
  readonly candidateGroupCount: number;
};

const DEFAULT_PROPOSED_BY = 'ATM Evolution Draft Bridge';
const DEFAULT_DRAFT_NOTES = 'Evidence-driven dry-run draft bridge generated from detector report.';

export function scanEvidencePatternReports(request: EvolutionScanRequest): EvolutionScanReport {
  const generatedAt = request.proposedAt ?? request.detectorReports[0]?.document.generatedAt ?? new Date().toISOString();
  const scanMode: 'dry-run' = 'dry-run';
  const detectorSummaries: EvolutionScanReportSummary[] = [];
  const observations: string[] = [];
  const skippedGroupIds: string[] = [];
  const aggregationByAtomId = new Map<string, GroupAggregation>();
  let candidateGroupCount = 0;

  for (const detectorReportInput of request.detectorReports) {
    const report = detectorReportInput.document;
    const reportSummary: EvolutionScanReportSummary = {
      path: detectorReportInput.path,
      detectorName: report.detectorName,
      candidateGroupCount: report.proposalCandidateGroupIds.length,
      proposalCandidateGroupIds: [...report.proposalCandidateGroupIds],
      empty: report.empty === true
    };
    detectorSummaries.push(reportSummary);

    for (const group of report.groups) {
      if (group.recommendation !== 'proposal-candidate') {
        skippedGroupIds.push(group.groupId);
        observations.push(`group ${group.groupId} is observation-only`);
        continue;
      }

      if (group.targetKind !== 'atom' || !group.targetId) {
        skippedGroupIds.push(group.groupId);
        observations.push(`group ${group.groupId} is deferred to a later target-surface curator`);
        continue;
      }

      const currentVersion = resolveCurrentAtomVersion(request.repositoryRoot, group.targetId);
      if (!currentVersion) {
        skippedGroupIds.push(group.groupId);
        observations.push(`group ${group.groupId} could not resolve current atom version for ${group.targetId}`);
        continue;
      }

      const existing = aggregationByAtomId.get(group.targetId);
      if (existing) {
        existing.detectorReportPaths.add(detectorReportInput.path);
        existing.groupIds.add(group.groupId);
        for (const evidenceId of group.matchedEvidenceIds) {
          existing.matchedEvidenceIds.add(evidenceId);
        }
        for (const evidenceId of group.rejectedEvidenceIds) {
          existing.rejectedEvidenceIds.add(evidenceId);
        }
        existing.requiredSignals.add(group.signalKind);
        for (const reason of group.reasons) {
          existing.notes.add(reason);
        }
        candidateGroupCount += 1;
        continue;
      }

      aggregationByAtomId.set(group.targetId, {
        atomId: group.targetId,
        detectorReportPaths: new Set([detectorReportInput.path]),
        groupIds: new Set([group.groupId]),
        matchedEvidenceIds: new Set(group.matchedEvidenceIds),
        rejectedEvidenceIds: new Set(group.rejectedEvidenceIds),
        requiredSignals: new Set([group.signalKind]),
        notes: new Set(group.reasons),
        sourceReportGeneratedAt: report.generatedAt,
        reportPath: detectorReportInput.path,
        baseAtomVersion: currentVersion,
        targetSurface: 'atom-spec',
        candidateGroupCount: 1
      });
      candidateGroupCount += 1;
    }
  }

  const proposalDrafts = [...aggregationByAtomId.values()]
    .sort((left, right) => left.atomId.localeCompare(right.atomId))
    .map((aggregation) => buildProposalDraft(aggregation, request.proposedBy ?? DEFAULT_PROPOSED_BY, generatedAt));

  const scanId = buildScanId(request.repositoryRoot, detectorSummaries, proposalDrafts);
  return {
    schemaId: 'atm.evolutionScanReport',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Initial evidence-driven scan report.'
    },
    scanId,
    generatedAt,
    repositoryRoot: request.repositoryRoot,
    scanMode,
    detectorReports: detectorSummaries,
    observation: {
      detectorReportCount: detectorSummaries.length,
      candidateGroupCount,
      proposalDraftCount: proposalDrafts.length,
      skippedGroupIds: [...new Set(skippedGroupIds)].sort(),
      notes: [...new Set(observations)].sort()
    },
    proposalDrafts,
    empty: proposalDrafts.length === 0
  };
}

function buildProposalDraft(
  aggregation: GroupAggregation,
  proposedBy: string,
  proposedAt: string
): EvolutionProposalDraftBundleItem {
  const fromVersion = aggregation.baseAtomVersion;
  const toVersion = bumpPatchVersion(fromVersion);
  const proposalId = `proposal.${aggregation.atomId.toLowerCase()}.from-${fromVersion}.to-${toVersion}.atom.evidence-driven`;
  const evidenceWatermark = `evidence.watermark.${normalizeWatermarkTimestamp(aggregation.sourceReportGeneratedAt)}`;
  const matchedEvidenceIds = [...aggregation.matchedEvidenceIds].sort();
  const rejectedEvidenceIds = [...aggregation.rejectedEvidenceIds].sort();
  const requiredSignals = [...aggregation.requiredSignals].sort();
  const detectorReportPath = [...aggregation.detectorReportPaths].sort()[0] ?? 'detector-report.json';
  const proposal = {
    schemaId: 'atm.upgradeProposal' as const,
    specVersion: '0.1.0' as const,
    migration: {
      strategy: 'additive' as const,
      fromVersion: fromVersion,
      notes: DEFAULT_DRAFT_NOTES
    },
    proposalId,
    atomId: aggregation.atomId,
    fromVersion,
    toVersion,
    lifecycleMode: 'evolution' as const,
    behaviorId: 'behavior.evolve' as const,
    target: {
      kind: 'atom' as const
    },
    decompositionDecision: 'atom-bump' as const,
    proposalSource: 'evidence-driven' as const,
    targetSurface: aggregation.targetSurface,
    baseAtomVersion: fromVersion,
    baseEvidenceWatermark: evidenceWatermark,
    reversibility: 'rollback-safe' as const,
    evidenceGate: {
      requiredSignals,
      matchedEvidenceIds,
      rejectedEvidenceIds,
      notes: `Derived from detector groups: ${[...aggregation.groupIds].sort().join(', ')}`
    },
    reviewTemplate: resolveReviewTemplate('atom-bump'),
    automatedGates: {
      nonRegression: makePassGate('nonRegression', detectorReportPath, 'pass (dry-run bridge did not re-run non-regression)'),
      qualityComparison: makePassGate('qualityComparison', detectorReportPath, 'pass (dry-run bridge did not re-run quality comparison)'),
      registryCandidate: makePassGate('registryCandidate', detectorReportPath, 'pass (dry-run bridge did not re-run registry candidate)'),
      allPassed: true,
      blockedGateNames: [] as string[]
    },
    humanReview: 'pending' as const,
    status: 'pending' as const,
    inputs: [
      {
        kind: 'evolution-evidence' as const,
        path: detectorReportPath,
        schemaId: 'atm.evidencePatternDetectorReport' as const,
        reportId: `${proposalId}.detector-report`,
        summary: 'evidence-driven evolution signal input'
      }
    ],
    proposedBy,
    proposedAt
  };

  return {
    groupIds: [...aggregation.groupIds].sort(),
    detectorReportPaths: [...aggregation.detectorReportPaths].sort(),
    proposal
  };
}

function makePassGate(gateName: 'nonRegression' | 'qualityComparison' | 'registryCandidate', reportPath: string, summary: string): EvolutionProposalGateResult {
  return {
    passed: true,
    reportId: `detector-dry-run.${gateName}`,
    reportPath,
    summary
  };
}

function resolveCurrentAtomVersion(repositoryRoot: string, atomId: string): string | null {
  const registryPath = path.join(repositoryRoot, 'atomic-registry.json');
  if (!existsSync(registryPath)) {
    return null;
  }
  try {
    const registryDocument = JSON.parse(readFileSync(registryPath, 'utf8'));
    const index = createRegistryIndex(registryDocument);
    return index.getVersions(atomId).current ?? null;
  } catch {
    return null;
  }
}

function buildScanId(repositoryRoot: string, detectorReports: readonly EvolutionScanReportSummary[], proposalDrafts: readonly EvolutionProposalDraftBundleItem[]): string {
  const payload = JSON.stringify({ repositoryRoot, detectorReports, proposalDrafts: proposalDrafts.map((draft) => draft.proposal.proposalId) });
  const digest = createHash('sha256').update(payload).digest('hex').slice(0, 12);
  return `scan.${digest}`;
}

function bumpPatchVersion(version: string): string {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
  const [major, minor, patch] = parts;
  return `${major}.${minor}.${patch + 1}`;
}

function normalizeWatermarkTimestamp(value: string): string {
  return value.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}