import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createLocalGovernanceAdapter } from '../../../plugin-governance-local/src/index.ts';
import { applyRegistryRollback, validateRollbackProof } from '../../../core/src/registry/rollback.ts';
import { CliError, makeResult, message, relativePathFrom } from './shared.mjs';

export function runRollback(argv) {
  const options = parseRollbackOptions(argv);
  const registryPath = resolvePath(options.cwd, options.registryPath);
  const proofPath = resolvePath(options.cwd, options.proofPath);
  const failureProofPath = resolvePath(options.cwd, options.failureProofPath);

  const registry = readJsonFile(registryPath);
  const rollbackResult = applyRegistryRollback({
    registryDocument: registry,
    targetKind: options.targetKind,
    atomId: options.atomId,
    mapId: options.mapId,
    toVersion: options.toVersion,
    behaviorId: options.behaviorId,
    repositoryRoot: options.cwd,
    mapOwner: options.mapOwner,
    verifiedAt: options.verifiedAt
  });

  if (options.mode === 'plan') {
    return makeResult({
      ok: true,
      command: 'rollback',
      cwd: options.cwd,
      messages: [message('info', 'ATM_ROLLBACK_PLAN_READY', `Rollback plan prepared for ${options.targetKind} target.`)],
      evidence: {
        targetKind: options.targetKind,
        atomId: options.atomId,
        mapId: options.mapId,
        toVersion: options.toVersion,
        behaviorId: options.behaviorId,
        proofPreview: rollbackResult.proof,
        applyRequired: true,
        registryPath: relativePathFrom(options.cwd, registryPath)
      }
    });
  }

  const proofValidation = validateRollbackProof(rollbackResult.proof);
  if (!proofValidation.ok) {
    const failedProof = {
      ...rollbackResult.proof,
      verificationStatus: 'failed',
      failureReason: proofValidation.issues.join(' | ')
    };
    writeJsonFile(failureProofPath, failedProof);
    throw new CliError('ATM_ROLLBACK_HARD_FAIL', 'Rollback hard-failed. Generated rollback-proof.failure.json.', {
      exitCode: 1,
      details: {
        issues: proofValidation.issues,
        failureProofPath: relativePathFrom(options.cwd, failureProofPath)
      }
    });
  }

  writeJsonFile(registryPath, rollbackResult.updatedRegistryDocument);
  writeJsonFile(proofPath, rollbackResult.proof);

  const governance = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
  const evidence = {
    schemaId: 'atm.evidence.rollbackProof',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Rollback proof evidence contract.'
    },
    evidenceId: rollbackResult.proof.proofId,
    workItemId: options.targetKind === 'atom' ? options.atomId : options.mapId,
    evidenceKind: 'validation',
    evidenceType: 'rollback-proof',
    summary: `Rollback ${rollbackResult.proof.verificationStatus} for ${options.targetKind} ${options.targetKind === 'atom' ? options.atomId : options.mapId}.`,
    artifactPaths: [
      relativePathFrom(options.cwd, registryPath),
      relativePathFrom(options.cwd, proofPath)
    ],
    createdAt: rollbackResult.proof.verifiedAt,
    producedBy: options.decidedBy,
    reproducibility: {
      replayable: true,
      replayCommand: ['node', 'scripts/validate-rollback-proof.mjs'],
      inputs: [relativePathFrom(options.cwd, registryPath)],
      expectedArtifacts: [relativePathFrom(options.cwd, proofPath)],
      notes: 'Replay verifies rollback proof hash/status/semantic fingerprint symmetry.'
    },
    details: {
      targetKind: options.targetKind,
      atomId: options.atomId,
      mapId: options.mapId,
      fromVersion: rollbackResult.proof.fromVersion,
      toVersion: rollbackResult.proof.toVersion,
      behaviorId: rollbackResult.proof.behaviorId,
      reverseBehaviorId: rollbackResult.proof.reverseBehaviorId,
      rollbackContractSymmetric: rollbackResult.proof.rollbackContractSymmetric,
      statusReverted: rollbackResult.proof.statusReverted,
      semanticFingerprintReverted: rollbackResult.proof.semanticFingerprintReverted,
      hashesVerified: rollbackResult.proof.hashesVerified
    }
  };
  governance.stores.evidenceStore.writeEvidence(options.targetKind === 'atom' ? options.atomId : options.mapId, evidence);

  return makeResult({
    ok: true,
    command: 'rollback',
    cwd: options.cwd,
    messages: [message('info', 'ATM_ROLLBACK_APPLIED', `Rollback applied for ${options.targetKind} target.`)],
    evidence: {
      targetKind: options.targetKind,
      atomId: options.atomId,
      mapId: options.mapId,
      toVersion: options.toVersion,
      behaviorId: options.behaviorId,
      reverseBehaviorId: rollbackResult.proof.reverseBehaviorId,
      rollbackContractSymmetric: rollbackResult.proof.rollbackContractSymmetric,
      registryPath: relativePathFrom(options.cwd, registryPath),
      proofPath: relativePathFrom(options.cwd, proofPath),
      proof: rollbackResult.proof,
      evidence
    }
  });
}

function parseRollbackOptions(argv) {
  const options = {
    cwd: process.cwd(),
    mode: null,
    targetKind: 'atom',
    atomId: null,
    mapId: null,
    mapOwner: null,
    toVersion: '',
    behaviorId: 'behavior.evolve',
    registryPath: 'atomic-registry.json',
    proofPath: '.atm/history/reports/rollback-proof.json',
    failureProofPath: '.atm/history/reports/rollback-proof.failure.json',
    decidedBy: process.env.AGENT_IDENTITY || 'ATM rollback engine',
    verifiedAt: new Date().toISOString()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireOptionValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--plan') {
      options.mode = 'plan';
      continue;
    }
    if (arg === '--apply') {
      options.mode = 'apply';
      continue;
    }
    if (arg === '--target') {
      const value = requireOptionValue(argv, index, '--target');
      if (value !== 'atom' && value !== 'map') {
        throw new CliError('ATM_CLI_USAGE', '--target must be atom or map', { exitCode: 2 });
      }
      options.targetKind = value;
      index += 1;
      continue;
    }
    if (arg === '--atom') {
      options.atomId = requireOptionValue(argv, index, '--atom');
      options.targetKind = 'atom';
      index += 1;
      continue;
    }
    if (arg === '--map') {
      options.mapId = requireOptionValue(argv, index, '--map');
      options.targetKind = 'map';
      index += 1;
      continue;
    }
    if (arg === '--map-owner') {
      options.mapOwner = requireOptionValue(argv, index, '--map-owner');
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
    if (arg === '--registry') {
      options.registryPath = requireOptionValue(argv, index, '--registry');
      index += 1;
      continue;
    }
    if (arg === '--proof') {
      options.proofPath = requireOptionValue(argv, index, '--proof');
      index += 1;
      continue;
    }
    if (arg === '--failure-proof') {
      options.failureProofPath = requireOptionValue(argv, index, '--failure-proof');
      index += 1;
      continue;
    }
    if (arg === '--by') {
      options.decidedBy = requireOptionValue(argv, index, '--by');
      index += 1;
      continue;
    }
    if (arg === '--at') {
      options.verifiedAt = requireOptionValue(argv, index, '--at');
      index += 1;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `rollback does not support option ${arg}`, { exitCode: 2 });
    }
  }

  if (!options.mode) {
    throw new CliError('ATM_CLI_USAGE', 'rollback requires --plan or --apply', { exitCode: 2 });
  }
  if (!options.toVersion) {
    throw new CliError('ATM_CLI_USAGE', 'rollback requires --to <version>', { exitCode: 2 });
  }
  if (options.targetKind === 'atom' && !options.atomId) {
    throw new CliError('ATM_CLI_USAGE', 'rollback --target atom requires --atom <id>', { exitCode: 2 });
  }
  if (options.targetKind === 'map' && !options.mapId) {
    throw new CliError('ATM_CLI_USAGE', 'rollback --target map requires --map <id>', { exitCode: 2 });
  }

  return {
    ...options,
    cwd: path.resolve(options.cwd)
  };
}

function requireOptionValue(argv, optionIndex, optionName) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `rollback requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

function resolvePath(cwd, maybeRelativePath) {
  return path.isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : path.resolve(cwd, maybeRelativePath);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new CliError('ATM_JSON_INVALID', `Invalid JSON file: ${filePath}`, {
      details: {
        filePath,
        reason: error instanceof Error ? error.message : String(error)
      }
    });
  }
}

function writeJsonFile(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
