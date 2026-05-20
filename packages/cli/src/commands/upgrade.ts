import path from 'node:path';
import { proposeAtomicUpgrade } from '../../../core/src/upgrade/propose.ts';
import { runUpgradeMapPropose } from './upgrade-map-propose.ts';
import { makeResult, message, resolveValue } from './shared.ts';
import { buildUpgradeNextActionHint } from './upgrade/next-action-hint.ts';
import { firstExperimentalUpgradeAction, runUpgradeExperimentalApi } from './upgrade/experimental.ts';
import {
  firstSafeUpgradeAction,
  parseSafeUpgradeOptions,
  runSafeUpgradeApply,
  runSafeUpgradePlan,
  runSafeUpgradeRollback
} from './upgrade/safe-upgrade.ts';
import { runUpgradeScan } from './upgrade/scan.ts';
import {
  discoverInputDocuments,
  evaluateUpgradeContextBudget,
  isGuidedLegacyDryRun,
  loadExplicitInputDocuments,
  parseUpgradeOptions,
  runGuidedLegacyDryRunProposal
} from './upgrade/proposal.ts';

export async function runUpgrade(argv: any) {
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
    inputs: inputDocuments
  };

  const proposal = options.target.kind === 'map'
    ? runUpgradeMapPropose(proposerOptions)
    : proposeAtomicUpgrade({
      ...proposerOptions,
      repositoryRoot: options.cwd
    });

  return makeResult({
    ok: true,
    command: 'upgrade',
    cwd: options.cwd,
    messages: [
      proposal.status === 'blocked'
        ? message('warning', 'ATM_UPGRADE_PROPOSAL_BLOCKED', 'Upgrade proposal blocked by automated gates.', {
          proposalId: proposal.proposalId,
          blockedGateNames: proposal.automatedGates.blockedGateNames
        })
        : message('info', 'ATM_UPGRADE_PROPOSAL_READY', 'Upgrade proposal prepared and ready for review.', {
          proposalId: proposal.proposalId
        })
    ],
    evidence: {
      proposal,
      proposalId: proposal.proposalId,
      status: proposal.status,
      blockedGateNames: proposal.automatedGates.blockedGateNames,
      contextBudget,
      dryRun: options.dryRun,
      target: proposal.target,
      nextActionHint: buildUpgradeNextActionHint(options.cwd, proposal),
      behaviorId: proposal.behaviorId,
      inputCount: proposal.inputs.length,
      inputKinds: proposal.inputs.map((entry: any) => entry.kind)
    }
  });
}
