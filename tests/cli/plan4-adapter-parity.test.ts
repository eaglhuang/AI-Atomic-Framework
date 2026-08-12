import assert from 'node:assert/strict';
import { ADAPTER_PARITY_SCHEMA_ID, compileAdapterParity, EDITORS } from '../../packages/core/src/evidence/adapter-parity.ts';

const sourceDigest = 'sha256:source';
const expectedCompilerDigests = Object.fromEntries(EDITORS.map((editor) => [editor, `sha256:${editor}-compiler`]));
const expectedManifestDigests = Object.fromEntries(EDITORS.map((editor) => [editor, `sha256:${editor}-manifest`]));
const adapters = EDITORS.map((editor) => ({
  editor,
  sourceDigest,
  compilerDigest: expectedCompilerDigests[editor],
  manifestDigest: expectedManifestDigests[editor],
  reinstallSmoke: true,
  frozenRunnerSmoke: true
}));

const green = compileAdapterParity({ sourceDigest, expectedCompilerDigests, expectedManifestDigests, adapters });
assert.equal(green.schemaId, ADAPTER_PARITY_SCHEMA_ID);
assert.equal(green.status, 'proven');
assert.equal(green.sourceDigest, sourceDigest);
assert.deepEqual(green.expectedCompilerDigests, expectedCompilerDigests);
assert.deepEqual(green.adapters.map((adapter) => adapter.editor), [...EDITORS].sort());
assert.equal(green.rollback.preservesSourceEvidence, true);

const manifestDrift = compileAdapterParity({
  sourceDigest,
  expectedCompilerDigests,
  expectedManifestDigests,
  adapters: adapters.map((adapter) => adapter.editor === 'cursor' ? { ...adapter, manifestDigest: 'sha256:wrong' } : adapter)
});
assert.equal(manifestDrift.status, 'blocked');
assert.ok(manifestDrift.diagnostics.includes('manifest-digest-drift:cursor'));

const compilerDrift = compileAdapterParity({
  sourceDigest,
  expectedCompilerDigests,
  expectedManifestDigests,
  adapters: adapters.map((adapter) => adapter.editor === 'gemini' ? { ...adapter, compilerDigest: 'sha256:wrong' } : adapter)
});
assert.equal(compilerDrift.status, 'blocked');
assert.ok(compilerDrift.diagnostics.includes('compiler-digest-drift:gemini'));

const smokeFailure = compileAdapterParity({
  sourceDigest,
  expectedCompilerDigests,
  expectedManifestDigests,
  adapters: adapters.map((adapter) => adapter.editor === 'antigravity' ? { ...adapter, frozenRunnerSmoke: false } : adapter)
});
assert.equal(smokeFailure.status, 'blocked');
assert.ok(smokeFailure.diagnostics.includes('frozen-runner-smoke-failed:antigravity'));

const broken = compileAdapterParity({ sourceDigest, expectedCompilerDigests, expectedManifestDigests, adapters: adapters.filter((adapter) => adapter.editor !== 'gemini') });
assert.equal(broken.status, 'blocked');
assert.ok(broken.diagnostics.includes('missing-adapter:gemini'));

console.log('plan4 adapter parity: ok');
