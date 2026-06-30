import { proposeAtomicUpgrade } from '../../../core/dist/upgrade/propose.js';
import { runUpgradeMapPropose } from './upgrade-map-propose.js';
import { makeResult, message } from './shared.js';
import { buildUpgradeNextActionHint } from './upgrade/next-action-hint.js';
import { firstExperimentalUpgradeAction, runUpgradeExperimentalApi } from './upgrade/experimental.js';
import { firstSafeUpgradeAction, parseSafeUpgradeOptions, runSafeUpgradeApply, runSafeUpgradePlan, runSafeUpgradeRollback } from './upgrade/safe-upgrade.js';
import { runUpgradeScan } from './upgrade/scan.js';
import { discoverInputDocuments, evaluateUpgradeContextBudget, inferInputKind, isGuidedLegacyDryRun, loadExplicitInputDocuments, parseUpgradeOptions, runGuidedLegacyDryRunProposal } from './upgrade/proposal.js';
export async function runUpgrade(argv) {
    const experimentalAction = firstExperimentalUpgradeAction(argv);
    if (experimentalAction === 'experimental-api') {
        return runUpgradeExperimentalApi(argv);
    }
    const safeAction = firstSafeUpgradeAction(argv);
    if (safeAction === 'plan') {
        return runSafeUpgradePlan(parseSafeUpgradeOptions(argv, 'plan'));
    }
    if (safeAction === 'apply') {
        return runSafeUpgradeApply(parseSafeUpgradeOptions(argv, 'apply'));
    }
    if (safeAction === 'rollback') {
        return runSafeUpgradeRollback(parseSafeUpgradeOptions(argv, 'rollback'));
    }
    const options = parseUpgradeOptions(argv);
    if (options.scan) {
        return runUpgradeScan(options);
    }
    if (isGuidedLegacyDryRun(options)) {
        return runGuidedLegacyDryRunProposal(options);
    }
    const inputDocuments = options.inputPaths.length > 0
        ? loadExplicitInputDocuments(options.cwd, options.inputPaths)
        : discoverInputDocuments(options.cwd);
    const contextBudget = await evaluateUpgradeContextBudget(options, inputDocuments);
    const proposerOptions = {
        cwd: options.cwd,
        atomId: options.atomId,
        fromVersion: options.fromVersion,
        toVersion: options.toVersion,
        behaviorId: options.behaviorId,
        decompositionDecision: options.decompositionDecision,
        target: options.target,
        fork: options.fork,
        mapImpactScope: options.mapImpactScope,
        proposalId: options.proposalId,
        proposedBy: options.proposedBy,
        proposedAt: options.proposedAt,
        migration: options.migration,
        requestedReplacementMode: options.requestedReplacementMode,
        equivalenceReport: options.equivalenceReport,
        polymorphImpactReport: options.polymorphImpactReport,
        propagationReport: options.propagationReport,
        reviewAdvisory: options.reviewAdvisory,
        humanReview: options.humanReview,
        rollbackProof: options.rollbackProof,
        retirementProof: options.retirementProof,
        contextBudgetGate: contextBudget.gate,
        inputs: inputDocuments.map((entry) => ({
            kind: inferInputKind(entry.document.schemaId) ?? 'unknown',
            path: entry.path,
            document: entry.document
        }))
    };
    const proposal = options.target.kind === 'map'
        ? runUpgradeMapPropose({
            ...proposerOptions,
            target: proposerOptions.target,
            fork: proposerOptions.fork,
            mapImpactScope: proposerOptions.mapImpactScope,
            migration: proposerOptions.migration
        })
        : proposeAtomicUpgrade({
            ...proposerOptions,
            fork: proposerOptions.fork,
            repositoryRoot: options.cwd
        });
    const proposalObj = proposal;
    return makeResult({
        ok: true,
        command: 'upgrade',
        cwd: options.cwd,
        messages: [
            proposalObj.status === 'blocked'
                ? message('warning', 'ATM_UPGRADE_PROPOSAL_BLOCKED', 'Upgrade proposal blocked by automated gates.', {
                    proposalId: proposalObj.proposalId,
                    blockedGateNames: proposalObj.automatedGates.blockedGateNames
                })
                : message('info', 'ATM_UPGRADE_PROPOSAL_READY', 'Upgrade proposal prepared and ready for review.', {
                    proposalId: proposalObj.proposalId
                })
        ],
        evidence: {
            proposal: proposalObj,
            proposalId: proposalObj.proposalId,
            status: proposalObj.status,
            blockedGateNames: proposalObj.automatedGates.blockedGateNames,
            contextBudget,
            dryRun: options.dryRun,
            target: proposalObj.target,
            nextActionHint: buildUpgradeNextActionHint(options.cwd, proposalObj),
            behaviorId: proposalObj.behaviorId,
            inputCount: proposalObj.inputs.length,
            inputKinds: proposalObj.inputs.map((entry) => entry.kind)
        }
    });
}
