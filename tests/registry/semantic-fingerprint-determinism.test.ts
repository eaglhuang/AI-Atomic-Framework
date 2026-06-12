import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAtomicMapSemanticFingerprint,
  createAtomicSpecSemanticFingerprint,
  normalizeSemanticFingerprint
} from '../../packages/core/src/registry/semantic-fingerprint.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = path.join(root, 'fixtures', 'semantic-fingerprint', 'determinism');
const scriptPath = path.join(root, 'scripts', 'validate-semantic-fingerprint.ts');

const permutation = readJson(path.join(fixtureRoot, 'spec-permutation.json'));
const recompute = readJson(path.join(fixtureRoot, 'spec-recompute.json'));
const identityNoise = readJson(path.join(fixtureRoot, 'identity-noise.json'));

assert.equal(
  normalizeSemanticFingerprint(createAtomicSpecSemanticFingerprint(permutation.contractA)),
  normalizeSemanticFingerprint(createAtomicSpecSemanticFingerprint(permutation.contractB)),
  'permuted contract fixtures must produce the same semantic fingerprint'
);

const recomputeFingerprints = recompute.samples.map((sample: any) =>
  normalizeSemanticFingerprint(createAtomicSpecSemanticFingerprint(sample))
);
assert.equal(new Set(recomputeFingerprints).size, 1, 'recompute samples must stay byte-identical');

assert.equal(
  containsNonDeterministicIdentitySignal(identityNoise.identityHashInput),
  true,
  'negative fixture must carry forbidden identity noise'
);

assert.doesNotThrow(() => {
  execFileSync(process.execPath, ['--strip-types', scriptPath, '--mode', 'validate'], {
    cwd: root,
    stdio: 'pipe'
  });
});

assert.throws(
  () =>
    execFileSync(process.execPath, ['--strip-types', scriptPath, '--mode', 'determinism-negative'], {
      cwd: root,
      stdio: 'pipe'
    }),
  /negative determinism fixture failed closed/i
);

assert.equal(
  normalizeSemanticFingerprint(createAtomicMapSemanticFingerprint({
    entrypoints: ['ATM-FIXTURE-0002', 'ATM-FIXTURE-0001'],
    qualityTargets: { promoteGateRequired: true, requiredChecks: 1 }
  })),
  normalizeSemanticFingerprint(createAtomicMapSemanticFingerprint({
    entrypoints: ['ATM-FIXTURE-0001', 'ATM-FIXTURE-0002'],
    qualityTargets: { requiredChecks: 1, promoteGateRequired: true }
  })),
  'map fingerprint permutation should remain stable'
);

console.log('[registry:semantic-fingerprint-determinism] ok');

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function containsNonDeterministicIdentitySignal(input: any) {
  return Boolean(input)
    && (Object.prototype.hasOwnProperty.call(input, 'timestamp')
      || Object.prototype.hasOwnProperty.call(input, 'pid')
      || Object.prototype.hasOwnProperty.call(input, 'randomNonce')
      || Object.prototype.hasOwnProperty.call(input, 'nonce')
      || Object.prototype.hasOwnProperty.call(input, 'seed'));
}
