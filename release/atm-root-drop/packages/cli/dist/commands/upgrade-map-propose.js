import path from 'node:path';
import { proposeAtomicUpgrade } from '../../../core/dist/upgrade/propose.js';
import { readJsonFile, relativePathFrom } from './shared.js';
export function runUpgradeMapPropose(options) {
    return proposeAtomicUpgrade({
        atomId: options.atomId,
        fromVersion: options.fromVersion,
        toVersion: options.toVersion,
        behaviorId: options.behaviorId,
        decompositionDecision: options.decompositionDecision,
        target: {
            kind: 'map',
            mapId: options.target.mapId
        },
        fork: options.fork,
        mapImpactScope: options.mapImpactScope,
        proposalId: options.proposalId,
        proposedBy: options.proposedBy,
        proposedAt: options.proposedAt,
        migration: options.migration,
        requestedReplacementMode: options.requestedReplacementMode,
        contextBudgetGate: options.contextBudgetGate,
        repositoryRoot: options.cwd,
        inputs: buildMapProposalInputs(options)
    });
}
function buildMapProposalInputs(options) {
    const inputs = [...(Array.isArray(options.inputs) ? options.inputs : [])];
    if (options.equivalenceReport) {
        inputs.push(loadSpecialInput(options.cwd, options.equivalenceReport, 'map-equivalence'));
    }
    if (options.polymorphImpactReport) {
        inputs.push(loadSpecialInput(options.cwd, options.polymorphImpactReport, 'polymorph-impact'));
    }
    if (options.propagationReport) {
        inputs.push(loadSpecialInput(options.cwd, options.propagationReport, 'propagation-report'));
    }
    if (options.reviewAdvisory) {
        inputs.push(loadSpecialInput(options.cwd, options.reviewAdvisory, 'review-advisory'));
    }
    if (options.humanReview) {
        inputs.push(loadSpecialInput(options.cwd, options.humanReview, 'human-review'));
    }
    if (options.rollbackProof) {
        inputs.push(loadSpecialInput(options.cwd, options.rollbackProof, 'rollback-proof'));
    }
    if (options.retirementProof) {
        inputs.push(loadSpecialInput(options.cwd, options.retirementProof, 'retirement-proof'));
    }
    const deduped = new Map();
    for (const input of inputs) {
        const key = `${input.kind}:${input.path}`;
        deduped.set(key, input);
    }
    return [...deduped.values()];
}
function loadSpecialInput(cwd, inputPath, kind) {
    const resolvedPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
    return {
        kind,
        path: relativePathFrom(cwd, resolvedPath),
        document: readJsonFile(resolvedPath, 'ATM_UPGRADE_INPUT_NOT_FOUND')
    };
}
