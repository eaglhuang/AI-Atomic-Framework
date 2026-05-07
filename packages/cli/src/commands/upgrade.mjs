import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { proposeAtomicUpgrade } from '../../../core/src/upgrade/propose.mjs';
import { CliError, makeResult, message, readJsonFile } from './shared.mjs';

export function runUpgrade(argv) {
  const options = parseUpgradeOptions(argv);
  const inputDocuments = options.inputPaths.length > 0
    ? loadExplicitInputDocuments(options.cwd, options.inputPaths)
    : discoverInputDocuments(options.cwd);

  const proposal = proposeAtomicUpgrade({
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
    inputs: inputDocuments
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
      dryRun: options.dryRun,
      target: proposal.target,
      behaviorId: proposal.behaviorId,
      inputCount: proposal.inputs.length,
      inputKinds: proposal.inputs.map((entry) => entry.kind)
    }
  });
}

function parseUpgradeOptions(argv) {
  const options = {
    cwd: process.cwd(),
    propose: false,
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

  if (!options.propose) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade requires --propose', { exitCode: 2 });
  }
  if (!options.atomId) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade requires --atom', { exitCode: 2 });
  }
  if (!options.toVersion) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade requires --to', { exitCode: 2 });
  }
  if (options.target.kind === 'map' && !options.target.mapId) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade --target map requires --map', { exitCode: 2 });
  }
  if (options.fork && (!options.fork.sourceAtomId || !options.fork.newAtomId)) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade fork mode requires both --fork-source and --new-atom-id', { exitCode: 2 });
  }

  return {
    ...options,
    cwd: path.resolve(options.cwd),
    proposedAt: options.proposedAt ?? new Date().toISOString()
  };
}

function loadExplicitInputDocuments(cwd, inputPaths) {
  return inputPaths.map((inputPath) => {
    const resolvedPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
    return {
      path: path.relative(cwd, resolvedPath).replace(/\\/g, '/'),
      document: readJsonFile(resolvedPath, 'ATM_UPGRADE_INPUT_NOT_FOUND')
    };
  });
}

function discoverInputDocuments(cwd) {
  const reportsRoot = path.join(cwd, '.atm', 'reports');
  if (!existsSync(reportsRoot)) {
    throw new CliError('ATM_UPGRADE_INPUTS_NOT_FOUND', 'Upgrade requires input reports. Provide --input paths or stage reports under .atm/reports.', {
      exitCode: 2,
      details: { reportsRoot }
    });
  }

  const discoveredFiles = collectJsonFiles(reportsRoot).sort((left, right) => left.localeCompare(right));
  const discoveredDocuments = discoveredFiles.map((filePath) => ({
    path: path.relative(cwd, filePath).replace(/\\/g, '/'),
    document: readJsonFile(filePath, 'ATM_UPGRADE_INPUT_NOT_FOUND')
  }));

  const inputDocuments = [];
  for (const kind of ['hash-diff', 'execution-evidence', 'non-regression', 'quality-comparison', 'registry-candidate']) {
    const match = discoveredDocuments.find((entry) => inferInputKind(entry.document.schemaId) === kind);
    if (match) {
      inputDocuments.push(match);
    }
  }

  if (inputDocuments.length === 0) {
    throw new CliError('ATM_UPGRADE_INPUTS_NOT_FOUND', 'Upgrade could not discover any recognized input reports under .atm/reports.', {
      exitCode: 2,
      details: { reportsRoot }
    });
  }

  return inputDocuments;
}

function collectJsonFiles(rootDir) {
  const entries = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...collectJsonFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      entries.push(entryPath);
    }
  }
  return entries;
}

function inferInputKind(schemaId) {
  switch (schemaId) {
    case 'atm.hashDiffReport':
      return 'hash-diff';
    case 'atm.executionEvidence':
      return 'execution-evidence';
    case 'atm.police.nonRegressionReport':
      return 'non-regression';
    case 'atm.police.qualityComparisonReport':
      return 'quality-comparison';
    case 'atm.police.registryCandidateReport':
      return 'registry-candidate';
    default:
      return null;
  }
}

function requireOptionValue(argv, optionIndex, optionName) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `upgrade requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}