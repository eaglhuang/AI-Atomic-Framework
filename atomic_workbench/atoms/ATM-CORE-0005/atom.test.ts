import assert from 'node:assert/strict';

// @ts-expect-error atom.source.mjs is the runtime JS atom entrypoint under test.
import { atomMetadata, runAtom, selfCheck } from './atom.source.mjs';

export const atomSpecPath = 'atom.spec.json';

const result = runAtom({
  inputs: [{ name: 'request', kind: 'json', required: true }],
  outputs: [{ name: 'result', kind: 'json', required: true }],
  language: { primary: 'javascript' },
  validation: { evidenceRequired: true },
  performanceBudget: {
    hotPath: false,
    inputMutation: 'forbidden',
    maxDurationMs: 10000
  }
});

assert.equal(atomMetadata.atomId, 'ATM-CORE-0005');
assert.equal(result.ok, true);
assert.equal(result.sourceSymbol, 'packages/core/src/registry/semantic-fingerprint.ts#createAtomicSpecSemanticFingerprint');
assert.match(result.semanticFingerprint, /^sf:sha256:[a-f0-9]{64}$/);
assert.equal(selfCheck(), true);

console.log('[ATM-CORE-0005] ok');
