import { proposeAtomicUpgrade } from '../../../core/src/upgrade/propose.ts';

export function runUpgradeMapPropose(options: any) {
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
    contextBudgetGate: options.contextBudgetGate,
    repositoryRoot: options.cwd,
    inputs: options.inputs
  });
}
