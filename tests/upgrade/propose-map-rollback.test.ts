import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { proposeAtomicUpgrade } from '../../packages/core/src/upgrade/propose.ts';
import { createRollbackProof } from '../../packages/core/src/registry/rollback-proof.ts';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-upgrade-map-rollback-');
const mapId = 'ATM-MAP-0001';
const proposedAt = '2026-01-01T00:00:00.000Z';

try {
  const validate = compileUpgradeProposalValidator();
  const rollbackProofPath = path.join(tempRoot, 'rollback-proof.pass.json');
  writeJson(rollbackProofPath, createPassingRollbackProof(mapId));

  const blockedProposal = proposeAtomicUpgrade({
    atomId: 'ATM-CORE-0001',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    target: { kind: 'map', mapId },
    requestedReplacementMode: 'legacy-retired',
    repositoryRoot: root,
    proposedAt,
    inputs: createBaseInputs()
  });
  validateProposal(blockedProposal, validate, 'core blocked legacy-retired proposal');
  assert.equal(blockedProposal.status, 'blocked');
  assert.equal(blockedProposal.automatedGates.rollbackProof.passed, false);
  assert.equal(blockedProposal.automatedGates.blockedGateNames.includes('rollbackProof'), true);
  assert.deepEqual(blockedProposal.requiredJustification.requiredEvidenceKinds, ['rollback-proof']);
  assert.deepEqual(blockedProposal.requiredJustification.requiredCliOptions, ['--rollback-proof']);

  const readyProposal = proposeAtomicUpgrade({
    atomId: 'ATM-CORE-0001',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    target: { kind: 'map', mapId },
    requestedReplacementMode: 'legacy-retired',
    repositoryRoot: root,
    proposedAt,
    inputs: [
      ...createBaseInputs(),
      {
        kind: 'rollback-proof',
        path: path.relative(root, rollbackProofPath).replace(/\\/g, '/'),
        document: readJson(rollbackProofPath)
      }
    ]
  });
  validateProposal(readyProposal, validate, 'core legacy-retired proposal with rollback proof');
  assert.equal(readyProposal.status, 'pending');
  assert.equal(readyProposal.automatedGates.rollbackProof.passed, true);
  assert.equal(readyProposal.requestedReplacementMode, 'legacy-retired');
  assert.equal(readyProposal.inputs.some((entry: any) => entry.kind === 'rollback-proof'), true);

  const cliBlocked = runUpgradeCli({ mapId, replacementMode: 'legacy-retired' });
  assert.equal(cliBlocked.exitCode, 0);
  validateProposal(cliBlocked.parsed.evidence.proposal, validate, 'CLI blocked legacy-retired proposal');
  assert.equal(cliBlocked.parsed.evidence.proposal.status, 'blocked');
  assert.equal(cliBlocked.parsed.evidence.blockedGateNames.includes('rollbackProof'), true);
  assert.deepEqual(cliBlocked.parsed.evidence.proposal.requiredJustification.requiredEvidenceKinds, ['rollback-proof']);

  const cliReady = runUpgradeCli({
    mapId,
    replacementMode: 'legacy-retired',
    extraArgs: ['--rollback-proof', rollbackProofPath]
  });
  assert.equal(cliReady.exitCode, 0);
  validateProposal(cliReady.parsed.evidence.proposal, validate, 'CLI legacy-retired proposal with rollback proof');
  assert.equal(cliReady.parsed.evidence.proposal.status, 'pending');
  assert.equal(cliReady.parsed.evidence.proposal.automatedGates.rollbackProof.passed, true);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[upgrade:map-rollback] ok');

function compileUpgradeProposalValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(readJson(path.join(root, 'schemas', 'upgrade', 'upgrade-proposal.schema.json')));
}

function validateProposal(document: unknown, validate: any, label: string) {
  const valid = validate(document) === true;
  assert.equal(valid, true, `${label} failed schema validation: ${JSON.stringify(validate.errors)}`);
}

function createBaseInputs() {
  return [
    createInput('hash-diff', 'fixtures/upgrade/hash-diff-report.json'),
    createInput('execution-evidence', 'tests/schema-fixtures/positive/minimal-execution-evidence.json'),
    createInput('non-regression', 'tests/police-fixtures/positive/non-regression-report.json'),
    createInput('quality-comparison', 'fixtures/upgrade/quality-comparison-pass.json'),
    createInput('registry-candidate', 'tests/police-fixtures/positive/registry-candidate-report.json')
  ];
}

function createInput(kind: string, relativePath: string) {
  return {
    kind,
    path: relativePath,
    document: readJson(path.join(root, relativePath))
  };
}

function createPassingRollbackProof(targetMapId: string) {
  return createRollbackProof({
    targetKind: 'map',
    mapId: targetMapId,
    fromVersion: '1.1.0',
    toVersion: '1.0.0',
    behaviorId: 'behavior.evolve',
    reverseBehaviorId: 'behavior.rollback-evolve',
    hashesVerified: {
      spec: true,
      code: true,
      test: true,
      allVerified: true
    },
    verifiedAt: proposedAt,
    statusReverted: true,
    semanticFingerprintReverted: true,
    memberAtomProofs: [
      {
        atomId: 'ATM-CORE-0001',
        version: '1.0.0',
        expected: createHashTriplet('a'),
        actual: createHashTriplet('a'),
        matched: true
      }
    ],
    mapGeneratorProvenance: true,
    mapWorkbenchResolution: {
      canonicalPath: `atomic_workbench/maps/${targetMapId}`,
      legacyPath: `legacy/maps/${targetMapId}`,
      selectedPath: `atomic_workbench/maps/${targetMapId}`,
      selectedSource: 'canonical'
    }
  });
}

function createHashTriplet(hexDigit: string) {
  const payload = `sha256:${hexDigit.repeat(64)}`;
  return {
    specHash: payload,
    codeHash: payload,
    testHash: payload
  };
}

function runUpgradeCli(options: { mapId: string; replacementMode: string; extraArgs?: string[] }) {
  const args = [
    path.join(root, 'atm.mjs'),
    'upgrade',
    '--propose',
    '--atom', 'ATM-CORE-0001',
    '--from', '1.0.0',
    '--to', '1.1.0',
    '--target', 'map',
    '--map', options.mapId,
    '--replacement-mode', options.replacementMode,
    '--dry-run',
    '--json',
    '--proposed-at', proposedAt,
    '--input', path.join(root, 'fixtures', 'upgrade', 'hash-diff-report.json'),
    '--input', path.join(root, 'tests', 'schema-fixtures', 'positive', 'minimal-execution-evidence.json'),
    '--input', path.join(root, 'tests', 'police-fixtures', 'positive', 'non-regression-report.json'),
    '--input', path.join(root, 'fixtures', 'upgrade', 'quality-comparison-pass.json'),
    '--input', path.join(root, 'tests', 'police-fixtures', 'positive', 'registry-candidate-report.json'),
    ...(options.extraArgs ?? [])
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8'
  });
  return {
    exitCode: result.status ?? 0,
    parsed: JSON.parse((result.stdout || result.stderr || '').trim())
  };
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, document: unknown) {
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}