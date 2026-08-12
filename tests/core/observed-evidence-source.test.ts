import assert from 'node:assert/strict';
import {
  collectObservedEvidence,
  createInMemoryObservedEvidenceSource,
  createReaderObservedEvidenceSource,
  verifyObservedEvidence,
} from '../../packages/core/src/evidence/observed-source-adapters.ts';

const source = {
  sourceId: 'fixture-ledger',
  kind: 'ledger' as const,
  dependencyClass: 'local-substitutable' as const,
};

const memory = createInMemoryObservedEvidenceSource(source, { run: 'run-1', exitCode: 0 });
const reader = createReaderObservedEvidenceSource(source, () => ({ run: 'run-1', exitCode: 0 }));

const fromMemory = collectObservedEvidence([memory]);
const fromReader = collectObservedEvidence([reader]);
assert.equal(fromMemory.status, 'observed');
assert.equal(fromReader.status, 'observed');
assert.equal(fromMemory.valueDigest, fromReader.valueDigest, 'adapter replacement preserves the consumer contract');
assert.ok(fromMemory.valueDigest, 'an observed snapshot has a derived digest');
assert.equal(verifyObservedEvidence(fromMemory, fromMemory.valueDigest).ok, true);

const forgedOutcome = createInMemoryObservedEvidenceSource(source, { passed: true });
const forgedResult = collectObservedEvidence([forgedOutcome]);
assert.equal(forgedResult.status, 'observed');
assert.deepEqual(forgedResult.value, { passed: true }, 'payload is observed data, never a success verdict');
assert.equal(verifyObservedEvidence(forgedResult, 'sha256:forged').ok, false);

const missing = collectObservedEvidence([]);
assert.equal(missing.status, 'unavailable');
assert.ok(missing.diagnostics.includes('no-observed-source'));

const conflicting = collectObservedEvidence([
  createInMemoryObservedEvidenceSource(source, { run: 'run-1' }),
  createInMemoryObservedEvidenceSource({ ...source, sourceId: 'filesystem-result', kind: 'filesystem' }, { run: 'run-2' }),
]);
assert.equal(conflicting.status, 'conflicting');
assert.ok(conflicting.diagnostics.includes('conflicting-observed-values'));

console.log('ok: observed evidence source test passed');
