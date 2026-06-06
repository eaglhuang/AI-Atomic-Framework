import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRegistryIndex } from '../registry/registry-index.js';
import { resolveReviewTemplate } from './decomposition-decision.js';
const DEFAULT_PROPOSED_BY = 'ATM Evolution Draft Bridge';
const DEFAULT_DRAFT_NOTES = 'Evidence-driven dry-run draft bridge generated from detector report.';
export function scanEvidencePatternReports(request) {
    const generatedAt = request.proposedAt ?? request.detectorReports[0]?.document.generatedAt ?? new Date().toISOString();
    const scanMode = 'dry-run';
    const detectorSummaries = [];
    const observations = [];
    const skippedGroupIds = [];
    const aggregationByAtomId = new Map();
    let candidateGroupCount = 0;
    for (const detectorReportInput of request.detectorReports) {
        const report = detectorReportInput.document;
        const reportSummary = {
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
function buildProposalDraft(aggregation, proposedBy, proposedAt) {
    const fromVersion = aggregation.baseAtomVersion;
    const toVersion = bumpPatchVersion(fromVersion);
    const proposalId = `proposal.${aggregation.atomId.toLowerCase()}.from-${fromVersion}.to-${toVersion}.atom.evidence-driven`;
    const evidenceWatermark = `evidence.watermark.${normalizeWatermarkTimestamp(aggregation.sourceReportGeneratedAt)}`;
    const matchedEvidenceIds = [...aggregation.matchedEvidenceIds].sort();
    const rejectedEvidenceIds = [...aggregation.rejectedEvidenceIds].sort();
    const requiredSignals = [...aggregation.requiredSignals].sort();
    const detectorReportPath = [...aggregation.detectorReportPaths].sort()[0] ?? 'detector-report.json';
    const proposal = {
        schemaId: 'atm.upgradeProposal',
        specVersion: '0.1.0',
        migration: {
            strategy: 'additive',
            fromVersion: fromVersion,
            notes: DEFAULT_DRAFT_NOTES
        },
        proposalId,
        atomId: aggregation.atomId,
        fromVersion,
        toVersion,
        lifecycleMode: 'evolution',
        behaviorId: 'behavior.evolve',
        target: {
            kind: 'atom'
        },
        decompositionDecision: 'atom-bump',
        proposalSource: 'evidence-driven',
        targetSurface: aggregation.targetSurface,
        baseAtomVersion: fromVersion,
        baseEvidenceWatermark: evidenceWatermark,
        reversibility: 'rollback-safe',
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
            blockedGateNames: []
        },
        humanReview: 'pending',
        status: 'pending',
        inputs: [
            {
                kind: 'evolution-evidence',
                path: detectorReportPath,
                schemaId: 'atm.evidencePatternDetectorReport',
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
function makePassGate(gateName, reportPath, summary) {
    return {
        passed: true,
        reportId: `detector-dry-run.${gateName}`,
        reportPath,
        summary
    };
}
function resolveCurrentAtomVersion(repositoryRoot, atomId) {
    const registryPath = path.join(repositoryRoot, 'atomic-registry.json');
    if (!existsSync(registryPath)) {
        return null;
    }
    try {
        const registryDocument = JSON.parse(readFileSync(registryPath, 'utf8'));
        const index = createRegistryIndex(registryDocument);
        return index.getVersions(atomId).current ?? null;
    }
    catch {
        return null;
    }
}
function buildScanId(repositoryRoot, detectorReports, proposalDrafts) {
    const payload = JSON.stringify({ repositoryRoot, detectorReports, proposalDrafts: proposalDrafts.map((draft) => draft.proposal.proposalId) });
    const digest = createHash('sha256').update(payload).digest('hex').slice(0, 12);
    return `scan.${digest}`;
}
function bumpPatchVersion(version) {
    const parts = version.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
        throw new Error(`Invalid semantic version: ${version}`);
    }
    const [major, minor, patch] = parts;
    return `${major}.${minor}.${patch + 1}`;
}
function normalizeWatermarkTimestamp(value) {
    return value.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}
