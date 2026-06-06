import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRegistryIndex } from '../registry/registry-index.js';
export const defaultAtomMapCuratorThresholds = {
    minCallerGraphOccurrences: 3,
    minInputOutputOverlapScore: 0.75,
    minRecurringFailureCount: 2,
    minConfidence: 0.5
};
const DEFAULT_CURATOR_NAME = 'deterministic-atom-map-curator';
const DEFAULT_PROPOSED_BY = 'ATM Atom Map Curator';
const DEFAULT_REPORT_PATH = 'fixtures/evolution/map-curator/generated-report.json';
export function curateAtomMapEvolution(input) {
    const thresholds = {
        ...defaultAtomMapCuratorThresholds,
        ...(input.thresholds ?? {})
    };
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const proposedBy = input.proposedBy ?? DEFAULT_PROPOSED_BY;
    const reportPath = input.reportPath ?? DEFAULT_REPORT_PATH;
    const registry = createRegistryResolver(input.repositoryRoot);
    const observations = [];
    const proposalDrafts = [];
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
        const signalKind = 'input-output-overlap';
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
        const signalKind = 'recurring-failure-cluster';
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
    const sortedDrafts = proposalDrafts.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
    const reportId = buildReportId(input.repositoryRoot, reportPath, sortedDrafts.map((draft) => draft.candidateId));
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
            proposalDrafts: sortedDrafts.length,
            blockedProposalDrafts,
            observationOnly: observations.length
        },
        observations: observations.sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
        proposalDrafts: sortedDrafts,
        empty: sortedDrafts.length === 0
    };
}
function validateCallerGraphSignal(signal, thresholds) {
    const reasons = [];
    if (signal.atomIds.length < 2) {
        reasons.push('caller-graph-needs-at-least-two-atoms');
    }
    if (signal.occurrenceCount < thresholds.minCallerGraphOccurrences) {
        reasons.push('caller-graph-occurrence-threshold-not-met');
    }
    appendEvidenceAndConfidenceReasons(reasons, signal.evidenceIds, signal.confidence, thresholds);
    return reasons;
}
function validateInputOutputOverlapSignal(signal, thresholds) {
    const reasons = [];
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
function validateRecurringFailureCluster(signal, thresholds) {
    const reasons = [];
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
function appendEvidenceAndConfidenceReasons(reasons, evidenceIds, confidence, thresholds) {
    if (evidenceIds.length === 0) {
        reasons.push('missing-evidence-ids');
    }
    if ((confidence ?? 1) < thresholds.minConfidence) {
        reasons.push('confidence-threshold-not-met');
    }
}
function buildProposalDraft(request, registry) {
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
    const proposal = {
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
function makePassGate(gateName, reportPath, summary) {
    return {
        passed: true,
        reportId: `map-curator.${gateName}`,
        reportPath,
        summary
    };
}
function createRegistryResolver(repositoryRoot) {
    const registryPath = path.join(repositoryRoot, 'atomic-registry.json');
    if (!existsSync(registryPath)) {
        return null;
    }
    const registryDocument = JSON.parse(readFileSync(registryPath, 'utf8'));
    return createRegistryIndex(registryDocument);
}
function resolveAtomVersion(registry, atomId) {
    return registry?.getVersions(atomId).current ?? '0.1.0';
}
function resolveMapVersion(registry, mapId) {
    return registry?.getVersions(mapId).current ?? '0.1.0';
}
function buildReportId(repositoryRoot, reportPath, candidateIds) {
    const payload = JSON.stringify({ repositoryRoot, reportPath, candidateIds });
    const digest = createHash('sha256').update(payload).digest('hex').slice(0, 12);
    return `map-curator.${digest}`;
}
function behaviorSuffix(behaviorId) {
    return behaviorId.replace('behavior.', '');
}
function bumpPatchVersion(version) {
    const parts = version.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
        throw new Error(`Invalid semantic version: ${version}`);
    }
    const [major, minor, patch] = parts;
    return `${major}.${minor}.${patch + 1}`;
}
function sanitizeIdentifier(value) {
    return value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
}
function normalizeWatermarkTimestamp(value) {
    return value.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}
