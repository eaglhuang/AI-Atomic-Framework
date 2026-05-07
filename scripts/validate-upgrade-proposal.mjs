import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { proposeAtomicUpgrade } from '../packages/core/src/upgrade/propose.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const schemaPath = 'schemas/upgrade/upgrade-proposal.schema.json';
const passFixturePath = 'fixtures/upgrade/proposal-pass.json';
const blockedFixturePath = 'fixtures/upgrade/proposal-blocked.json';
const inputPaths = {
  hashDiff: 'fixtures/upgrade/hash-diff-report.json',
  executionEvidence: 'tests/schema-fixtures/positive/minimal-execution-evidence.json',
  nonRegression: 'tests/police-fixtures/positive/non-regression-report.json',
  qualityPass: 'fixtures/upgrade/quality-comparison-pass.json',
  qualityBlocked: 'fixtures/upgrade/quality-comparison-blocked.json',
  registryCandidate: 'tests/police-fixtures/positive/registry-candidate-report.json'
};

function check(condition, message) {
  if (!condition) {
    throw new Error(`[upgrade-proposal:${mode}] ${message}`);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function input(kind, relativePath) {
  return {
    kind,
    path: relativePath,
    document: readJson(relativePath)
  };
}

function createProposalInputs(qualityPath) {
  return [
    input('hash-diff', inputPaths.hashDiff),
    input('execution-evidence', inputPaths.executionEvidence),
    input('non-regression', inputPaths.nonRegression),
    input('quality-comparison', qualityPath),
    input('registry-candidate', inputPaths.registryCandidate)
  ];
}

function validateWithSchema(document, validate, label) {
  const valid = validate(document) === true;
  check(valid, `${label} failed schema validation: ${JSON.stringify(validate.errors)}`);
}

function assertInvariants(proposal, expectedStatus) {
  check(proposal.schemaId === 'atm.upgradeProposal', 'proposal schemaId mismatch');
  check(proposal.lifecycleMode === 'evolution', 'proposal lifecycleMode must be evolution');
  check(proposal.humanReview === 'pending', 'humanReview must remain pending');
  check(proposal.status === expectedStatus, `expected status=${expectedStatus}`);
  check(proposal.behaviorId.startsWith('behavior.'), 'behaviorId must be behavior.*');
  check(Array.isArray(proposal.inputs) && proposal.inputs.length >= 4, 'proposal must keep input references');
  if (proposal.status === 'blocked') {
    check(proposal.automatedGates.allPassed === false, 'blocked proposal must have allPassed=false');
    check(proposal.automatedGates.blockedGateNames.length > 0, 'blocked proposal must name blocked gates');
  } else {
    check(proposal.automatedGates.allPassed === true, 'pending proposal must have allPassed=true');
    check(proposal.automatedGates.blockedGateNames.length === 0, 'pending proposal must not name blocked gates');
  }
  if (proposal.decompositionDecision === 'atom-extract') {
    check(proposal.fork?.sourceAtomId && proposal.fork?.newAtomId, 'atom-extract proposal must include fork source and new atomId');
  }
  if (proposal.target.kind === 'map') {
    check(proposal.target.mapId, 'map target must include mapId');
    check(proposal.decompositionDecision === 'map-bump', 'map target must use map-bump decision');
    check(proposal.mapImpactScope, 'map target must include mapImpactScope');
  }
}

function runCliUpgrade(qualityPath) {
  const args = [
    path.join(root, 'packages/cli/src/atm.mjs'),
    'upgrade',
    '--propose',
    '--atom', 'ATM-CORE-0001',
    '--from', '1.0.0',
    '--to', '1.1.0',
    '--dry-run',
    '--json',
    '--proposed-at', '2026-01-01T00:00:00.000Z',
    '--input', inputPaths.hashDiff,
    '--input', inputPaths.executionEvidence,
    '--input', inputPaths.nonRegression,
    '--input', qualityPath,
    '--input', inputPaths.registryCandidate
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8'
  });
  check(result.status === 0, `CLI upgrade exited ${result.status}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout.trim()).evidence.proposal;
}

for (const relativePath of [schemaPath, passFixturePath, blockedFixturePath, ...Object.values(inputPaths), 'packages/core/src/upgrade/propose.mjs', 'packages/cli/src/commands/upgrade.mjs']) {
  check(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
}

const schema = readJson(schemaPath);
check(schema.required.includes('atomId'), 'schema must require atomId');
check(schema.required.includes('fromVersion'), 'schema must require fromVersion');
check(schema.required.includes('toVersion'), 'schema must require toVersion');
check(schema.required.includes('automatedGates'), 'schema must require automatedGates');
check(schema.required.includes('humanReview'), 'schema must require humanReview');
check(schema.required.includes('behaviorId'), 'schema must require behaviorId');
check(schema.properties.decompositionDecision.enum.includes('atom-extract'), 'schema must include atom-extract decomposition decision');
check(schema.properties.decompositionDecision.enum.includes('map-bump'), 'schema must include map-bump decomposition decision');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const expectedPass = readJson(passFixturePath);
const expectedBlocked = readJson(blockedFixturePath);
validateWithSchema(expectedPass, validate, 'proposal-pass fixture');
validateWithSchema(expectedBlocked, validate, 'proposal-blocked fixture');
assertInvariants(expectedPass, 'pending');
assertInvariants(expectedBlocked, 'blocked');

const generatedPass = proposeAtomicUpgrade({
  atomId: 'ATM-CORE-0001',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  proposedAt: '2026-01-01T00:00:00.000Z',
  inputs: createProposalInputs(inputPaths.qualityPass)
});
assert.deepEqual(generatedPass, expectedPass, 'generated pass proposal must match fixture');

const generatedBlocked = proposeAtomicUpgrade({
  atomId: 'ATM-CORE-0001',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  proposedAt: '2026-01-01T00:00:00.000Z',
  inputs: createProposalInputs(inputPaths.qualityBlocked)
});
assert.deepEqual(generatedBlocked, expectedBlocked, 'generated blocked proposal must match fixture');

const cliPass = runCliUpgrade(inputPaths.qualityPass);
assert.deepEqual(cliPass, expectedPass, 'CLI pass proposal must match fixture');

const cliBlocked = runCliUpgrade(inputPaths.qualityBlocked);
assert.deepEqual(cliBlocked, expectedBlocked, 'CLI blocked proposal must match fixture');

const mapProposal = proposeAtomicUpgrade({
  atomId: 'ATM-CORE-0001',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  target: { kind: 'map', mapId: 'ATM-MAP-0001' },
  proposedAt: '2026-01-01T00:00:00.000Z',
  inputs: createProposalInputs(inputPaths.qualityPass)
});
assertInvariants(mapProposal, 'pending');
validateWithSchema(mapProposal, validate, 'map proposal');

const extractProposal = proposeAtomicUpgrade({
  atomId: 'ATM-CORE-0001',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  behaviorId: 'behavior.atomize',
  fork: { sourceAtomId: 'ATM-CORE-0001', newAtomId: 'ATM-CORE-0002' },
  proposedAt: '2026-01-01T00:00:00.000Z',
  inputs: createProposalInputs(inputPaths.qualityPass)
});
assertInvariants(extractProposal, 'pending');
validateWithSchema(extractProposal, validate, 'atom-extract proposal');

console.log(`[upgrade-proposal:${mode}] ok (schema, invariants, core proposer, and CLI replay verified)`);