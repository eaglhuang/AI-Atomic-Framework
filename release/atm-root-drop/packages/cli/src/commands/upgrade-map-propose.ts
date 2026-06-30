import path from 'node:path';
import { proposeAtomicUpgrade } from '../../../core/src/upgrade/propose.ts';
import { readJsonFile, relativePathFrom } from './shared.ts';

interface UpgradeMapProposeOptions {
  cwd: string;
  atomId?: string | null;
  fromVersion?: string | null;
  toVersion?: string | null;
  behaviorId?: string | null;
  decompositionDecision?: string | null;
  target: {
    mapId: string;
  };
  fork?: { sourceAtomId: string; newAtomId: string } | null;
  mapImpactScope?: string | null;
  proposalId?: string | null;
  proposedBy?: string | null;
  proposedAt?: string | null;
  migration?: { strategy: string; fromVersion?: string | null; notes?: string } | null;
  requestedReplacementMode?: string | null;
  contextBudgetGate?: object | null;
  inputs?: Array<{ kind: string; path: string; document: Record<string, unknown> }> | null;
  equivalenceReport?: string | null;
  polymorphImpactReport?: string | null;
  propagationReport?: string | null;
  reviewAdvisory?: string | null;
  humanReview?: string | null;
  rollbackProof?: string | null;
  retirementProof?: string | null;
}

export function runUpgradeMapPropose(options: UpgradeMapProposeOptions) {
  return proposeAtomicUpgrade({
    atomId: options.atomId ?? null,
    fromVersion: options.fromVersion ?? null,
    toVersion: options.toVersion ?? null,
    behaviorId: options.behaviorId ?? null,
    decompositionDecision: options.decompositionDecision ?? null,
    target: {
      kind: 'map',
      mapId: options.target.mapId
    },
    fork: options.fork ?? null,
    mapImpactScope: options.mapImpactScope as unknown as { affectedMapIds?: string[]; propagationStatus?: unknown[] } | null,
    proposalId: options.proposalId ?? null,
    proposedBy: options.proposedBy ?? undefined,
    proposedAt: options.proposedAt ?? undefined,
    migration: options.migration ?? null,
    requestedReplacementMode: options.requestedReplacementMode ?? null,
    contextBudgetGate: options.contextBudgetGate ?? null,
    repositoryRoot: options.cwd,
    inputs: buildMapProposalInputs(options)
  });
}

function buildMapProposalInputs(options: UpgradeMapProposeOptions) {
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

function loadSpecialInput(cwd: string, inputPath: string, kind: string) {
  const resolvedPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
  return {
    kind,
    path: relativePathFrom(cwd, resolvedPath),
    document: readJsonFile(resolvedPath, 'ATM_UPGRADE_INPUT_NOT_FOUND')
  };
}
