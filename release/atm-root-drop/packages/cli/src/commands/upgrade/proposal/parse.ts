import path from 'node:path';
import { CliError } from '../../shared.ts';
import { requireOptionValue } from '../path-helpers.ts';
import type { ParsedUpgradeCommandOptions, UpgradeCommandOptions } from './types.ts';

export function parseUpgradeOptions(argv: readonly string[]): ParsedUpgradeCommandOptions {
  const options: UpgradeCommandOptions = {
    cwd: process.cwd(),
    propose: false,
    scan: false,
    dryRun: false,
    atomId: null,
    fromVersion: null,
    toVersion: null,
    behaviorId: 'behavior.evolve',
    decompositionDecision: null,
    inputPaths: [],
    target: { kind: 'atom' },
    fork: null,
    mapImpactScope: null,
    legacyTarget: null,
    guidanceSession: null,
    requestedReplacementMode: null,
    equivalenceReport: null,
    polymorphImpactReport: null,
    propagationReport: null,
    reviewAdvisory: null,
    humanReview: null,
    rollbackProof: null,
    retirementProof: null,
    proposalId: null,
    proposedBy: 'ATM CLI',
    proposedAt: null,
    migration: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireOptionValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--propose') {
      options.propose = true;
      continue;
    }
    if (arg === '--scan') {
      options.scan = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--atom') {
      options.atomId = requireOptionValue(argv, index, '--atom');
      index += 1;
      continue;
    }
    if (arg === '--from') {
      options.fromVersion = requireOptionValue(argv, index, '--from');
      index += 1;
      continue;
    }
    if (arg === '--to') {
      options.toVersion = requireOptionValue(argv, index, '--to');
      index += 1;
      continue;
    }
    if (arg === '--behavior') {
      options.behaviorId = requireOptionValue(argv, index, '--behavior');
      index += 1;
      continue;
    }
    if (arg === '--legacy-target') {
      options.legacyTarget = requireOptionValue(argv, index, '--legacy-target');
      index += 1;
      continue;
    }
    if (arg === '--guidance-session') {
      options.guidanceSession = requireOptionValue(argv, index, '--guidance-session');
      index += 1;
      continue;
    }
    if (arg === '--decomposition-decision') {
      options.decompositionDecision = requireOptionValue(argv, index, '--decomposition-decision');
      index += 1;
      continue;
    }
    if (arg === '--target') {
      const targetKind = requireOptionValue(argv, index, '--target');
      if (targetKind !== 'atom' && targetKind !== 'map') {
        throw new CliError('ATM_CLI_USAGE', '--target must be atom or map', { exitCode: 2 });
      }
      options.target = { kind: targetKind };
      index += 1;
      continue;
    }
    if (arg === '--map') {
      options.target = { kind: 'map', mapId: requireOptionValue(argv, index, '--map') };
      index += 1;
      continue;
    }
    if (arg === '--replacement-mode') {
      options.requestedReplacementMode = requireOptionValue(argv, index, '--replacement-mode');
      index += 1;
      continue;
    }
    if (arg === '--equivalence-report') {
      options.equivalenceReport = requireOptionValue(argv, index, '--equivalence-report');
      index += 1;
      continue;
    }
    if (arg === '--polymorph-impact-report') {
      options.polymorphImpactReport = requireOptionValue(argv, index, '--polymorph-impact-report');
      index += 1;
      continue;
    }
    if (arg === '--propagation-report') {
      options.propagationReport = requireOptionValue(argv, index, '--propagation-report');
      index += 1;
      continue;
    }
    if (arg === '--review-advisory') {
      options.reviewAdvisory = requireOptionValue(argv, index, '--review-advisory');
      index += 1;
      continue;
    }
    if (arg === '--human-review') {
      options.humanReview = requireOptionValue(argv, index, '--human-review');
      index += 1;
      continue;
    }
    if (arg === '--rollback-proof') {
      options.rollbackProof = requireOptionValue(argv, index, '--rollback-proof');
      index += 1;
      continue;
    }
    if (arg === '--retirement-proof') {
      options.retirementProof = requireOptionValue(argv, index, '--retirement-proof');
      index += 1;
      continue;
    }
    if (arg === '--fork-source') {
      options.fork = options.fork ?? {};
      options.fork.sourceAtomId = requireOptionValue(argv, index, '--fork-source');
      index += 1;
      continue;
    }
    if (arg === '--new-atom-id') {
      options.fork = options.fork ?? {};
      options.fork.newAtomId = requireOptionValue(argv, index, '--new-atom-id');
      index += 1;
      continue;
    }
    if (arg === '--input') {
      options.inputPaths.push(requireOptionValue(argv, index, '--input'));
      index += 1;
      continue;
    }
    if (arg === '--proposed-by') {
      options.proposedBy = requireOptionValue(argv, index, '--proposed-by');
      index += 1;
      continue;
    }
    if (arg === '--proposed-at') {
      options.proposedAt = requireOptionValue(argv, index, '--proposed-at');
      index += 1;
      continue;
    }
    if (arg === '--proposal-id') {
      options.proposalId = requireOptionValue(argv, index, '--proposal-id');
      index += 1;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `upgrade does not support option ${arg}`, { exitCode: 2 });
    }
  }

  assertUpgradeOptions(options);
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    proposedAt: options.proposedAt ?? new Date().toISOString()
  };
}

function assertUpgradeOptions(options: UpgradeCommandOptions): void {
  if (!options.propose && !options.scan) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade requires --propose or --scan', { exitCode: 2 });
  }
  if (!options.propose) return;

  const guidedLegacy = Boolean(options.legacyTarget || options.guidanceSession);
  if (guidedLegacy) {
    if (!options.dryRun) {
      throw new CliError('ATM_CLI_USAGE', 'guided legacy upgrade proposals require --dry-run', { exitCode: 2 });
    }
    if (!options.legacyTarget || !options.guidanceSession) {
      throw new CliError('ATM_CLI_USAGE', 'guided legacy upgrade proposals require --legacy-target and --guidance-session', { exitCode: 2 });
    }
    if (!['behavior.atomize', 'behavior.infect', 'behavior.split'].includes(options.behaviorId)) {
      throw new CliError('ATM_CLI_USAGE', 'guided legacy upgrade proposals require behavior.atomize, behavior.infect, or behavior.split', { exitCode: 2 });
    }
  } else if (!options.atomId) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade requires --atom', { exitCode: 2 });
  }
  if (!guidedLegacy && !options.toVersion) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade requires --to', { exitCode: 2 });
  }
  if (options.target.kind === 'map' && !options.target.mapId) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade --target map requires --map', { exitCode: 2 });
  }
  if (options.target.kind !== 'map' && (options.requestedReplacementMode || options.equivalenceReport || options.polymorphImpactReport || options.propagationReport || options.reviewAdvisory || options.humanReview || options.rollbackProof || options.retirementProof)) {
    throw new CliError('ATM_CLI_USAGE', '--replacement-mode, --equivalence-report, --polymorph-impact-report, --propagation-report, --review-advisory, --human-review, --rollback-proof, and --retirement-proof require --target map with --map', { exitCode: 2 });
  }
  if (options.fork && (!options.fork.sourceAtomId || !options.fork.newAtomId)) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade fork mode requires both --fork-source and --new-atom-id', { exitCode: 2 });
  }
}
