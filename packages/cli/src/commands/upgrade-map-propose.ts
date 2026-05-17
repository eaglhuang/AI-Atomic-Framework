import path from 'node:path';
import { proposeAtomicUpgrade } from '../../../core/src/upgrade/propose.ts';
import { readJsonFile, relativePathFrom } from './shared.ts';

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
    requestedReplacementMode: options.requestedReplacementMode,
    contextBudgetGate: options.contextBudgetGate,
    repositoryRoot: options.cwd,
    inputs: buildMapProposalInputs(options)
  });
}

function buildMapProposalInputs(options: any) {
  const inputs = [...(Array.isArray(options.inputs) ? options.inputs : [])];
  if (options.equivalenceReport) {
    inputs.push(loadSpecialInput(options.cwd, options.equivalenceReport, 'map-equivalence'));
  }
  if (options.rollbackProof) {
    inputs.push(loadSpecialInput(options.cwd, options.rollbackProof, 'rollback-proof'));
  }

  const deduped = new Map();
  for (const input of inputs) {
    const key = `${input.kind}:${input.path}`;
    deduped.set(key, input);
  }
  return [...deduped.values()];
}

function loadSpecialInput(cwd: string, inputPath: string, kind: string) {
  const resolvedPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
  return {
    kind,
    path: relativePathFrom(cwd, resolvedPath),
    document: readJsonFile(resolvedPath, 'ATM_UPGRADE_INPUT_NOT_FOUND')
  };
}
