import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  applyRegistryRollback,
  resolveMapWorkbenchPath,
  resolveRollbackBehavior,
  validateRollbackProof
} from '../packages/core/src/registry/rollback.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const schemaPath = 'schemas/registry/rollback-proof.schema.json';
const registryFixturePath = 'fixtures/registry/v1-with-versions.json';
const passProofPath = 'fixtures/rollback/proof-pass.json';
const hashMismatchProofPath = 'fixtures/rollback/proof-fail-hash-mismatch.json';
const statusFailProofPath = 'fixtures/rollback/proof-fail-status-not-reverted.json';
const semanticFailProofPath = 'fixtures/rollback/proof-fail-semantic-fingerprint-not-reverted.json';

function check(condition, message) {
  if (!condition) {
    throw new Error(`[rollback-proof:${mode}] ${message}`);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

for (const relativePath of [
  schemaPath,
  registryFixturePath,
  passProofPath,
  hashMismatchProofPath,
  statusFailProofPath,
  semanticFailProofPath,
  'packages/core/src/registry/rollback.ts',
  'packages/cli/src/commands/rollback.mjs'
]) {
  check(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
}

const schema = readJson(schemaPath);
check(schema.required.includes('behaviorId'), 'rollback-proof schema must require behaviorId');
check(schema.required.includes('statusReverted'), 'rollback-proof schema must require statusReverted');
check(schema.required.includes('semanticFingerprintReverted'), 'rollback-proof schema must require semanticFingerprintReverted');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const passProof = readJson(passProofPath);
const hashMismatchProof = readJson(hashMismatchProofPath);
const statusFailProof = readJson(statusFailProofPath);
const semanticFailProof = readJson(semanticFailProofPath);

for (const [label, proof] of [
  ['proof-pass', passProof],
  ['proof-fail-hash-mismatch', hashMismatchProof],
  ['proof-fail-status-not-reverted', statusFailProof],
  ['proof-fail-semantic-fingerprint-not-reverted', semanticFailProof]
]) {
  check(validate(proof) === true, `${label} failed schema validation: ${JSON.stringify(validate.errors)}`);
}

const passValidation = validateRollbackProof(passProof);
check(passValidation.ok, `proof-pass must pass semantic validator: ${passValidation.issues.join(' | ')}`);

const hashMismatchValidation = validateRollbackProof(hashMismatchProof);
check(!hashMismatchValidation.ok, 'proof-fail-hash-mismatch must fail semantic validator');
check(hashMismatchValidation.issues.some((issue) => issue.includes('hash verification')), 'hash mismatch proof must fail because of hashesVerified');

const statusFailValidation = validateRollbackProof(statusFailProof);
check(!statusFailValidation.ok, 'proof-fail-status-not-reverted must fail semantic validator');
check(statusFailValidation.issues.some((issue) => issue.includes('status')), 'status fail proof must fail because of statusReverted');

const semanticFailValidation = validateRollbackProof(semanticFailProof);
check(!semanticFailValidation.ok, 'proof-fail-semantic-fingerprint-not-reverted must fail semantic validator');
check(semanticFailValidation.issues.some((issue) => issue.includes('semanticFingerprint')), 'semantic fail proof must fail because of semanticFingerprintReverted');

check(resolveRollbackBehavior('behavior.evolve') === 'behavior.rollback-evolve', 'behavior.evolve must map to rollback reverse action');
check(resolveRollbackBehavior('behavior.merge') === 'behavior.rollback-merge', 'behavior.merge must map to rollback reverse action');
check(resolveRollbackBehavior('behavior.unknown') === null, 'unknown behavior must not resolve rollback reverse action');

const registryFixture = readJson(registryFixturePath);
const rollbackResult = applyRegistryRollback({
  registryDocument: registryFixture,
  targetKind: 'atom',
  atomId: 'ATM-FIXTURE-0001',
  toVersion: '1.0.0',
  behaviorId: 'behavior.evolve',
  repositoryRoot: root,
  verifiedAt: '2026-01-03T00:00:00.000Z'
});

check(rollbackResult.proof.verificationStatus === 'passed', 'atom rollback proof should pass for fixture registry');
check(rollbackResult.proof.hashesVerified.allVerified, 'atom rollback proof should verify spec/code/test hash triplet');
check(rollbackResult.proof.statusReverted, 'atom rollback proof should revert status in fixture flow');
check(rollbackResult.proof.semanticFingerprintReverted, 'atom rollback proof should revert semantic fingerprint in fixture flow');

const rolledEntry = rollbackResult.updatedRegistryDocument.entries.find((entry) => entry.atomId === 'ATM-FIXTURE-0001');
check(rolledEntry.currentVersion === '1.0.0', 'atom rollback should set currentVersion to requested target');
check(rolledEntry.selfVerification.specHash === 'sha256:1111111111111111111111111111111111111111111111111111111111111111', 'atom rollback should restore target version specHash');

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-rollback-map-paths-'));
try {
  const canonicalRoot = path.join(tempRoot, 'canonical');
  mkdirSync(path.join(canonicalRoot, 'atomic_workbench', 'maps', 'ATM-MAP-9001'), { recursive: true });
  const canonicalResolved = resolveMapWorkbenchPath({
    repositoryRoot: canonicalRoot,
    mapId: 'ATM-MAP-9001',
    mapOwner: 'team-a'
  });
  assert.equal(canonicalResolved.selectedSource, 'canonical');

  const legacyRoot = path.join(tempRoot, 'legacy');
  mkdirSync(path.join(legacyRoot, 'atoms', 'team-a', 'map', 'ATM-MAP-9001'), { recursive: true });
  const legacyResolved = resolveMapWorkbenchPath({
    repositoryRoot: legacyRoot,
    mapId: 'ATM-MAP-9001',
    mapOwner: 'team-a'
  });
  assert.equal(legacyResolved.selectedSource, 'legacy');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[rollback-proof:' + mode + '] ok (schema, behavior symmetry, rollback proof matrix, and map path resolution verified)');