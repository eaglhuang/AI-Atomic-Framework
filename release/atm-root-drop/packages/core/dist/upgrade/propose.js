import { buildMapProposalContext } from './map-propose.js';
import { deriveDecompositionDecision, resolveReviewTemplate, validateDecisionBehaviorPair, VALID_DECOMPOSITION_DECISIONS } from './decomposition-decision.js';
// TASK-ASR-0012: 拆出 normalize-input 和 gates 兩個子模組
import { normalizeInputDocument, findInput, requireInput, buildInputRefs } from './propose/normalize-input.js';
import { normalizeGateResult, buildGateResult, buildQualityComparisonGate, buildRegistryCandidateGate, buildMapEquivalenceGate, buildPolymorphImpactGate, buildRollbackProofGate, buildPropagationReportGate, buildReviewAdvisoryGate, buildHumanReviewGate, buildRetirementProofGate } from './propose/gates.js';
const VALID_BEHAVIOR_IDS = [
    'behavior.evolve',
    'behavior.split',
    'behavior.merge',
    'behavior.dedup-merge',
    'behavior.sweep',
    'behavior.expire',
    'behavior.polymorphize',
    'behavior.compose',
    'behavior.infect',
    'behavior.atomize'
];
const VALID_REPLACEMENT_MODES = ['draft', 'shadow', 'canary', 'active', 'legacy-retired'];
export function proposeAtomicUpgrade(request) {
    const normalizedRequest = normalizeRequest(request);
    const hashDiffInput = requireInput(normalizedRequest.inputs, 'hash-diff');
    const hashDiffReport = hashDiffInput.document;
    const fromVersion = normalizedRequest.fromVersion ?? hashDiffReport.fromVersion;
    const toVersion = normalizedRequest.toVersion ?? hashDiffReport.toVersion;
    if (!fromVersion) {
        throw new Error('Upgrade proposal requires fromVersion or a hash-diff report with fromVersion.');
    }
    if (!toVersion) {
        throw new Error('Upgrade proposal requires toVersion or a hash-diff report with toVersion.');
    }
    const atomId = normalizedRequest.atomId ?? hashDiffReport.atomId;
    if (!atomId) {
        throw new Error('Upgrade proposal requires atomId or a hash-diff report with atomId.');
    }
    if (normalizedRequest.atomId && hashDiffReport.atomId && normalizedRequest.atomId !== hashDiffReport.atomId) {
        throw new Error(`Upgrade proposal atomId mismatch: ${normalizedRequest.atomId} !== ${hashDiffReport.atomId}`);
    }
    if (normalizedRequest.fromVersion && hashDiffReport.fromVersion && normalizedRequest.fromVersion !== hashDiffReport.fromVersion) {
        throw new Error(`Upgrade proposal fromVersion mismatch: ${normalizedRequest.fromVersion} !== ${hashDiffReport.fromVersion}`);
    }
    if (normalizedRequest.toVersion && hashDiffReport.toVersion && normalizedRequest.toVersion !== hashDiffReport.toVersion) {
        throw new Error(`Upgrade proposal toVersion mismatch: ${normalizedRequest.toVersion} !== ${hashDiffReport.toVersion}`);
    }
    const behaviorId = normalizedRequest.behaviorId ?? 'behavior.evolve';
    if (!VALID_BEHAVIOR_IDS.includes(behaviorId)) {
        throw new Error(`Unsupported behaviorId: ${behaviorId}`);
    }
    const target = normalizeTarget(normalizedRequest.target);
    const requestedReplacementMode = normalizeRequestedReplacementMode(normalizedRequest.requestedReplacementMode, target);
    const decompositionDecision = normalizedRequest.decompositionDecision ?? deriveDecompositionDecision({
        behaviorId,
        targetKind: target.kind
    });
    if (!VALID_DECOMPOSITION_DECISIONS.includes(decompositionDecision)) {
        throw new Error(`Unsupported decompositionDecision: ${decompositionDecision}`);
    }
    if (decompositionDecision === 'map-bump' && target.kind !== 'map') {
        throw new Error('map-bump proposals require target.kind === "map".');
    }
    if (decompositionDecision !== 'map-bump' && target.kind === 'map' && !target.mapId) {
        throw new Error('map proposals require mapId.');
    }
    if (decompositionDecision === 'atom-extract' && !normalizedRequest.fork) {
        throw new Error('atom-extract proposals require fork information.');
    }
    validateDecisionBehaviorPair({ behaviorId, decompositionDecision });
    const mapProposalContext = target.kind === 'map'
        ? buildMapProposalContext({
            repositoryRoot: normalizedRequest.repositoryRoot,
            mapId: target.mapId,
            atomId: atomId,
            fromVersion: fromVersion,
            toVersion: toVersion
        })
        : null;
    const proposalId = normalizedRequest.proposalId ?? createProposalId(atomId, fromVersion, toVersion, target, behaviorId);
    const inputs = buildInputRefs(normalizedRequest.inputs);
    const nonRegressionInput = requireInput(normalizedRequest.inputs, 'non-regression');
    const qualityComparisonInput = requireInput(normalizedRequest.inputs, 'quality-comparison');
    const registryCandidateInput = requireInput(normalizedRequest.inputs, 'registry-candidate');
    const nonRegressionGate = buildGateResult('nonRegression', nonRegressionInput.document, nonRegressionInput.path, 'baseline fixtures passed');
    const qualityComparisonGate = buildQualityComparisonGate(qualityComparisonInput.document, qualityComparisonInput.path);
    const registryCandidateGate = buildRegistryCandidateGate(registryCandidateInput.document, registryCandidateInput.path);
    const mapEquivalenceGate = buildMapEquivalenceGate(target, requestedReplacementMode, findInput(normalizedRequest.inputs, 'map-equivalence'));
    const polymorphImpactGate = buildPolymorphImpactGate(target, requestedReplacementMode, normalizedRequest.repositoryRoot, toVersion, findInput(normalizedRequest.inputs, 'polymorph-impact'));
    const propagationReportGate = buildPropagationReportGate(target, requestedReplacementMode, atomId, findInput(normalizedRequest.inputs, 'propagation-report'));
    const reviewAdvisoryGate = buildReviewAdvisoryGate(target, requestedReplacementMode, proposalId, findInput(normalizedRequest.inputs, 'review-advisory'));
    const humanReviewGate = buildHumanReviewGate(target, requestedReplacementMode, proposalId, atomId, findInput(normalizedRequest.inputs, 'human-review'));
    const rollbackProofGate = buildRollbackProofGate(target, requestedReplacementMode, findInput(normalizedRequest.inputs, 'rollback-proof'));
    const retirementProofGate = buildRetirementProofGate(target, requestedReplacementMode, findInput(normalizedRequest.inputs, 'retirement-proof'));
    const legacyRetirementSatisfied = requestedReplacementMode !== 'legacy-retired'
        || target.kind !== 'map'
        || rollbackProofGate?.passed === true
        || retirementProofGate?.passed === true;
    const visibleRollbackProofGate = legacyRetirementSatisfied && rollbackProofGate?.passed !== true ? null : rollbackProofGate;
    const visibleRetirementProofGate = legacyRetirementSatisfied && retirementProofGate?.passed !== true ? null : retirementProofGate;
    const contextBudgetGate = normalizedRequest.contextBudgetGate;
    const blockedGateNames = [];
    if (!nonRegressionGate.passed) {
        blockedGateNames.push('nonRegression');
    }
    if (!qualityComparisonGate.passed) {
        blockedGateNames.push('qualityComparison');
    }
    if (!registryCandidateGate.passed) {
        blockedGateNames.push('registryCandidate');
    }
    if (mapEquivalenceGate && !mapEquivalenceGate.passed) {
        blockedGateNames.push('mapEquivalence');
    }
    if (polymorphImpactGate && !polymorphImpactGate.passed) {
        blockedGateNames.push('polymorphImpact');
    }
    if (propagationReportGate && !propagationReportGate.passed) {
        blockedGateNames.push('propagationReport');
    }
    if (reviewAdvisoryGate && !reviewAdvisoryGate.passed) {
        blockedGateNames.push('reviewAdvisory');
    }
    if (humanReviewGate && !humanReviewGate.passed) {
        blockedGateNames.push('humanReview');
    }
    if (requestedReplacementMode === 'legacy-retired' && target.kind === 'map' && !legacyRetirementSatisfied) {
        if (rollbackProofGate && !rollbackProofGate.passed) {
            blockedGateNames.push('rollbackProof');
        }
        if (retirementProofGate && !retirementProofGate.passed) {
            blockedGateNames.push('retirementProof');
        }
    }
    if (contextBudgetGate && !contextBudgetGate.passed) {
        blockedGateNames.push('contextBudget');
    }
    const allPassed = blockedGateNames.length === 0;
    const status = allPassed ? 'pending' : 'blocked';
    const requiredJustification = buildRequiredJustification({
        requestedReplacementMode,
        mapEquivalenceGate,
        polymorphImpactGate,
        propagationReportGate,
        reviewAdvisoryGate,
        humanReviewGate,
        rollbackProofGate,
        retirementProofGate
    });
    const mapImpactScope = normalizedRequest.mapImpactScope
        ?? qualityComparisonInput.document.mapImpactScope
        ?? (target.kind === 'map'
            ? {
                affectedMapIds: [target.mapId],
                propagationStatus: []
            }
            : undefined);
    const proposal = {
        schemaId: 'atm.upgradeProposal',
        specVersion: '0.1.0',
        migration: normalizeMigration(normalizedRequest.migration),
        proposalId,
        atomId,
        fromVersion,
        toVersion,
        lifecycleMode: 'evolution',
        behaviorId,
        target,
        decompositionDecision,
        reviewTemplate: resolveReviewTemplate(decompositionDecision),
        automatedGates: {
            nonRegression: nonRegressionGate,
            qualityComparison: qualityComparisonGate,
            registryCandidate: registryCandidateGate,
            ...(mapEquivalenceGate ? { mapEquivalence: mapEquivalenceGate } : {}),
            ...(polymorphImpactGate ? { polymorphImpact: polymorphImpactGate } : {}),
            ...(propagationReportGate ? { propagationReport: propagationReportGate } : {}),
            ...(reviewAdvisoryGate ? { reviewAdvisory: reviewAdvisoryGate } : {}),
            ...(humanReviewGate ? { humanReview: humanReviewGate } : {}),
            ...(visibleRollbackProofGate ? { rollbackProof: visibleRollbackProofGate } : {}),
            ...(visibleRetirementProofGate ? { retirementProof: visibleRetirementProofGate } : {}),
            ...(contextBudgetGate ? { contextBudget: contextBudgetGate } : {}),
            allPassed,
            blockedGateNames
        },
        humanReview: 'pending',
        status,
        inputs,
        proposedBy: normalizedRequest.proposedBy,
        proposedAt: normalizedRequest.proposedAt
    };
    if (requestedReplacementMode) {
        proposal.requestedReplacementMode = requestedReplacementMode;
    }
    if (requiredJustification) {
        proposal.requiredJustification = requiredJustification;
    }
    if (mapProposalContext) {
        proposal.members = mapProposalContext.members;
        proposal.generatorProvenance = mapProposalContext.generatorProvenance;
    }
    if (mapImpactScope) {
        proposal.mapImpactScope = mapImpactScope;
    }
    if (decompositionDecision === 'atom-extract') {
        proposal.fork = {
            sourceAtomId: normalizedRequest.fork.sourceAtomId,
            newAtomId: normalizedRequest.fork.newAtomId
        };
        proposal.extractPlan = {
            preservedSourceAtom: {
                atomId: normalizedRequest.fork.sourceAtomId,
                retainedAtVersion: fromVersion,
                retentionMode: 'legacy-preserved'
            },
            newAtomSpecStub: {
                atomId: normalizedRequest.fork.newAtomId,
                seededFromAtomId: normalizedRequest.fork.sourceAtomId,
                initialVersion: toVersion,
                lifecycleMode: 'evolution'
            }
        };
    }
    return proposal;
}
function normalizeRequest(request) {
    if (!Array.isArray(request.inputs) || request.inputs.length === 0) {
        throw new Error('Upgrade proposal requires at least one input document.');
    }
    return {
        atomId: request.atomId ?? null,
        fromVersion: request.fromVersion ?? null,
        toVersion: request.toVersion ?? null,
        behaviorId: request.behaviorId ?? null,
        decompositionDecision: request.decompositionDecision ?? null,
        target: request.target ?? { kind: 'atom' },
        fork: request.fork ?? null,
        mapImpactScope: request.mapImpactScope ?? null,
        proposedBy: request.proposedBy ?? 'ATM CLI',
        proposedAt: request.proposedAt ?? new Date().toISOString(),
        proposalId: request.proposalId ?? null,
        migration: request.migration ?? null,
        requestedReplacementMode: request.requestedReplacementMode ?? null,
        repositoryRoot: request.repositoryRoot ?? process.cwd(),
        contextBudgetGate: normalizeGateResult(request.contextBudgetGate ?? null, 'contextBudget'),
        inputs: request.inputs.map(normalizeInputDocument)
    };
}
function normalizeTarget(target) {
    if (!target || typeof target !== 'object') {
        return { kind: 'atom', mapId: '' };
    }
    const kind = target.kind ?? 'atom';
    if (kind !== 'atom' && kind !== 'map') {
        throw new Error(`Unsupported target.kind: ${kind}`);
    }
    const normalized = { kind, mapId: '' };
    if (typeof target.mapId === 'string' && target.mapId.length > 0) {
        normalized.mapId = target.mapId;
    }
    return normalized;
}
function normalizeRequestedReplacementMode(value, target) {
    if (value == null) {
        return null;
    }
    const mode = String(value).trim();
    if (!VALID_REPLACEMENT_MODES.includes(mode)) {
        throw new Error(`Unsupported requestedReplacementMode: ${mode}`);
    }
    if (target.kind !== 'map') {
        throw new Error('requestedReplacementMode requires target.kind === "map".');
    }
    return mode;
}
function buildRequiredJustification({ requestedReplacementMode, mapEquivalenceGate, polymorphImpactGate, propagationReportGate, reviewAdvisoryGate, humanReviewGate, rollbackProofGate, retirementProofGate }) {
    if (requestedReplacementMode === 'active') {
        const requiredGateNames = [];
        const requiredEvidenceKinds = [];
        const requiredCliOptions = [];
        if (mapEquivalenceGate && !mapEquivalenceGate.passed) {
            requiredGateNames.push('mapEquivalence');
            requiredEvidenceKinds.push('map-equivalence');
            requiredCliOptions.push('--equivalence-report');
        }
        if (polymorphImpactGate && !polymorphImpactGate.passed) {
            requiredGateNames.push('polymorphImpact');
            requiredEvidenceKinds.push('polymorph-impact');
            requiredCliOptions.push('--polymorph-impact-report');
        }
        if (propagationReportGate && !propagationReportGate.passed) {
            requiredGateNames.push('propagationReport');
            requiredEvidenceKinds.push('propagation-report');
            requiredCliOptions.push('--propagation-report');
        }
        if (reviewAdvisoryGate && !reviewAdvisoryGate.passed) {
            requiredGateNames.push('reviewAdvisory');
            requiredEvidenceKinds.push('review-advisory');
            requiredCliOptions.push('--review-advisory');
        }
        if (humanReviewGate && !humanReviewGate.passed) {
            requiredGateNames.push('humanReview');
            requiredEvidenceKinds.push('human-review');
            requiredCliOptions.push('--human-review');
        }
        if (requiredGateNames.length > 0) {
            return {
                requestedReplacementMode,
                requiredGateNames,
                requiredEvidenceKinds,
                requiredCliOptions,
                humanReviewRequired: true,
                rationale: buildActiveReplacementRationale(requiredGateNames)
            };
        }
    }
    if (requestedReplacementMode === 'legacy-retired' && rollbackProofGate && retirementProofGate
        && !rollbackProofGate.passed && !retirementProofGate.passed) {
        return {
            requestedReplacementMode,
            requiredGateNames: ['rollbackProof', 'retirementProof'],
            requiredEvidenceKinds: ['rollback-proof', 'retirement-proof'],
            requiredCliOptions: ['--rollback-proof', '--retirement-proof'],
            humanReviewRequired: true,
            rationale: 'Map promotion to legacy-retired requires a passing rollback proof or retirement proof, and retirement proof must clear caller and entrypoint risk.'
        };
    }
    return null;
}
function buildActiveReplacementRationale(requiredGateNames) {
    if (requiredGateNames.length === 1 && requiredGateNames[0] === 'mapEquivalence') {
        return 'Map promotion to active requires a passing map equivalence report before review can proceed.';
    }
    if (requiredGateNames.length === 1 && requiredGateNames[0] === 'polymorphImpact') {
        return 'Map promotion to active requires a passing polymorph impact report when member atoms participate in template propagation.';
    }
    if (requiredGateNames.length === 1 && requiredGateNames[0] === 'propagationReport') {
        return 'Map promotion to active requires a passing propagation report that proves downstream maps remain healthy.';
    }
    if (requiredGateNames.length === 1 && requiredGateNames[0] === 'reviewAdvisory') {
        return 'Map promotion to active requires a review advisory report before human approval can proceed.';
    }
    if (requiredGateNames.length === 1 && requiredGateNames[0] === 'humanReview') {
        return 'Map promotion to active requires an approved human review decision before review can proceed.';
    }
    return 'Map promotion to active requires all replacement evidence gates to pass before review can proceed.';
}
function createProposalId(atomId, fromVersion, toVersion, target, behaviorId) {
    const safeAtomId = String(atomId).toLowerCase();
    const targetSuffix = target.kind === 'map'
        ? `.map-${String(target.mapId ?? 'unknown').toLowerCase()}`
        : '.atom';
    const behaviorSuffix = `.behavior-${behaviorId.replace(/^behavior\./, '')}`;
    return `proposal.${safeAtomId}.from-${fromVersion}.to-${toVersion}${targetSuffix}${behaviorSuffix}`;
}
function normalizeMigration(migration) {
    return {
        strategy: migration?.strategy ?? 'none',
        fromVersion: migration?.fromVersion ?? null,
        notes: migration?.notes ?? 'Initial upgrade proposal contract.'
    };
}
