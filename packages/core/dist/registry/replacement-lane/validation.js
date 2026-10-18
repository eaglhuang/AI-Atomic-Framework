import { ReplacementMode, evidenceRequirementByTarget, orderedReplacementModes } from './constants.js';
import { findHumanReviewEvidence, findMapEquivalenceEvidence, findPropagationEvidence, findRetirementProofEvidence, findReviewAdvisoryEvidence, findRollbackProofEvidence, loadEvidenceDocuments } from './evidence.js';
import { createReplacementLaneError, requiresEvidence } from './support.js';
export function validateTransition(input) {
    const currentIndex = orderedReplacementModes.indexOf(input.from);
    const nextIndex = orderedReplacementModes.indexOf(input.to);
    const isForwardSingleStep = currentIndex >= 0 && nextIndex === currentIndex + 1;
    if (!isForwardSingleStep) {
        throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', `Illegal replacement lane transition: ${input.from} -> ${input.to}.`, {
            from: input.from,
            to: input.to,
            allowedNextMode: orderedReplacementModes[currentIndex + 1] ?? null,
            mapId: input.canonicalMapId
        });
    }
    if (input.evidenceRefs.length === 0 && requiresEvidence(input.to)) {
        const requiredEvidence = evidenceRequirementByTarget[input.to];
        throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', `Transition to ${input.to} requires ${requiredEvidence}.`, {
            from: input.from,
            to: input.to,
            requiredEvidence,
            mapId: input.canonicalMapId
        });
    }
    if (input.to === ReplacementMode.Active) {
        validateActiveTransitionEvidence({ ...input, to: ReplacementMode.Active });
    }
    if (input.to === ReplacementMode.LegacyRetired) {
        validateLegacyRetiredEvidence({ ...input, to: ReplacementMode.LegacyRetired });
    }
}
function validateActiveTransitionEvidence(input) {
    const evidenceDocuments = loadEvidenceDocuments(input.repositoryRoot, input.evidenceRefs);
    const gateResults = {
        mapEquivalence: findMapEquivalenceEvidence(input.canonicalMapId, evidenceDocuments),
        propagationReport: findPropagationEvidence(input.canonicalMapId, evidenceDocuments),
        reviewAdvisory: findReviewAdvisoryEvidence(input.canonicalMapId, evidenceDocuments),
        humanReview: findHumanReviewEvidence(input.canonicalMapId, evidenceDocuments)
    };
    const blockedGateNames = Object.entries(gateResults)
        .filter(([, gate]) => gate.passed !== true)
        .map(([gateName]) => gateName);
    if (blockedGateNames.length === 0) {
        return;
    }
    const requiredEvidenceKinds = blockedGateNames.map(mapGateNameToEvidenceKind);
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', `Transition to ${input.to} requires ${evidenceRequirementByTarget[input.to]}.`, {
        from: input.from,
        to: input.to,
        requiredEvidence: evidenceRequirementByTarget[input.to],
        mapId: input.canonicalMapId,
        blockedGateNames,
        missingEvidenceKinds: requiredEvidenceKinds,
        invalidEvidenceRefs: evidenceDocuments.filter((entry) => entry.error).map((entry) => ({
            path: entry.path,
            error: entry.error
        })),
        requiredJustification: {
            requestedReplacementMode: ReplacementMode.Active,
            requiredGateNames: blockedGateNames,
            requiredEvidenceKinds,
            humanReviewRequired: true,
            rationale: 'Canary promotion to active requires passing map equivalence, propagation, review advisory, and approved human review evidence.'
        },
        nextActionHint: buildReplacementLaneNextActionHint(input, requiredEvidenceKinds)
    });
}
function validateLegacyRetiredEvidence(input) {
    const evidenceDocuments = loadEvidenceDocuments(input.repositoryRoot, input.evidenceRefs);
    const rollbackProof = findRollbackProofEvidence(input.canonicalMapId, evidenceDocuments);
    const retirementProof = findRetirementProofEvidence(input.canonicalMapId, evidenceDocuments);
    if (rollbackProof.passed === true || retirementProof.passed === true) {
        return;
    }
    const blockedGateNames = ['rollbackProof', 'retirementProof'];
    const requiredEvidenceKinds = blockedGateNames.map(mapGateNameToEvidenceKind);
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', `Transition to ${input.to} requires ${evidenceRequirementByTarget[input.to]}.`, {
        from: input.from,
        to: input.to,
        requiredEvidence: evidenceRequirementByTarget[input.to],
        mapId: input.canonicalMapId,
        blockedGateNames,
        missingEvidenceKinds: requiredEvidenceKinds,
        invalidEvidenceRefs: evidenceDocuments.filter((entry) => entry.error).map((entry) => ({
            path: entry.path,
            error: entry.error
        })),
        requiredJustification: {
            requestedReplacementMode: ReplacementMode.LegacyRetired,
            requiredGateNames: blockedGateNames,
            requiredEvidenceKinds,
            humanReviewRequired: true,
            rationale: 'Active promotion to legacy-retired requires a passing rollback proof or retirement proof, and retirement proof must clear caller and entrypoint risk.'
        },
        nextActionHint: buildReplacementLaneNextActionHint(input, requiredEvidenceKinds)
    });
}
function mapGateNameToEvidenceKind(gateName) {
    switch (gateName) {
        case 'mapEquivalence':
            return 'map-equivalence';
        case 'propagationReport':
            return 'propagation-report';
        case 'reviewAdvisory':
            return 'review-advisory';
        case 'humanReview':
            return 'human-review';
        case 'rollbackProof':
            return 'rollback-proof';
        case 'retirementProof':
            return 'retirement-proof';
        default:
            return gateName;
    }
}
function buildReplacementLaneNextActionHint(input, requiredEvidenceKinds) {
    const evidenceArgs = requiredEvidenceKinds
        .map((kind) => `--evidence <${kind}.json>`)
        .join(' ');
    return {
        status: 'blocked',
        route: 'replacement-evidence-required',
        reason: `Replacement lane transition to ${input.to} requires additional machine-readable evidence.`,
        command: `node atm.mjs replacement-lane transition --cwd <repository-root> --map ${input.canonicalMapId} --to ${input.to} ${evidenceArgs} --json`,
        commandTemplate: true,
        requiredEvidenceKinds
    };
}
