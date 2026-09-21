import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileAdapterParity, EDITORS } from '../../packages/core/src/evidence/adapter-parity.ts';

const report = JSON.parse(readFileSync('docs/reports/plan4-six-editor-adapter-parity.json', 'utf8'));

assert.equal(report.schemaId, 'atm.plan4SixEditorAdapterParity.v1');
assert.equal(report.taskId, 'ATM-GOV-0338');
assert.match(report.sealedSourceSha, /^[a-f0-9]{40}$/);
assert.match(report.source.digest, /^sha256:[a-f0-9]{64}$/);
assert.match(report.compiler.digest, /^sha256:[a-f0-9]{64}$/);
assert.equal(report.source.fileCount, 24);

const parity = compileAdapterParity({
  sourceDigest: report.source.digest,
  expectedCompilerDigests: report.expectedCompilerDigests,
  expectedManifestDigests: report.expectedManifestDigests,
  adapters: report.adapters
});

assert.equal(parity.status, 'proven');
assert.deepEqual(parity.adapters.map((adapter) => adapter.editor), [...EDITORS].sort());
assert.deepEqual(parity.degraded, []);
assert.deepEqual(parity.diagnostics, []);

for (const editor of EDITORS) {
  const adapter = report.adapters.find((entry: { editor: string }) => entry.editor === editor);
  assert.ok(adapter, `missing adapter report for ${editor}`);
  assert.equal(adapter.sourceDigest, report.source.digest);
  assert.equal(adapter.compilerDigest, report.expectedCompilerDigests[editor]);
  assert.equal(adapter.manifestDigest, report.expectedManifestDigests[editor]);
  assert.equal(adapter.installCommand, `node atm.mjs integration add ${editor} --json`);
  assert.equal(adapter.verifyCommand, `node atm.mjs integration verify ${editor} --json`);
  assert.equal(adapter.installExitCode, 0);
  assert.equal(adapter.verifyExitCode, 0);
  assert.equal(adapter.reinstallSmoke, true);
  assert.equal(adapter.frozenRunnerSmoke, true);
  assert.deepEqual(adapter.degradationDiagnostics, []);
}

const directOnlyEdit = compileAdapterParity({
  sourceDigest: report.source.digest,
  expectedCompilerDigests: report.expectedCompilerDigests,
  expectedManifestDigests: report.expectedManifestDigests,
  adapters: report.adapters.map((adapter: any) => adapter.editor === 'cursor'
    ? { ...adapter, manifestDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }
    : adapter)
});
assert.equal(directOnlyEdit.status, 'blocked');
assert.ok(directOnlyEdit.diagnostics.includes('manifest-digest-drift:cursor'));

const missingCommandSmoke = compileAdapterParity({
  sourceDigest: report.source.digest,
  expectedCompilerDigests: report.expectedCompilerDigests,
  expectedManifestDigests: report.expectedManifestDigests,
  adapters: report.adapters.map((adapter: any) => adapter.editor === 'gemini'
    ? { ...adapter, reinstallSmoke: false }
    : adapter)
});
assert.equal(missingCommandSmoke.status, 'blocked');
assert.ok(missingCommandSmoke.diagnostics.includes('reinstall-smoke-failed:gemini'));

const providerAuthorityDrift = compileAdapterParity({
  sourceDigest: report.source.digest,
  expectedCompilerDigests: report.expectedCompilerDigests,
  expectedManifestDigests: report.expectedManifestDigests,
  adapters: report.adapters.map((adapter: any) => adapter.editor === 'antigravity'
    ? { ...adapter, sourceDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111' }
    : adapter)
});
assert.equal(providerAuthorityDrift.status, 'blocked');
assert.ok(providerAuthorityDrift.diagnostics.includes('source-digest-drift:antigravity'));

console.log('six-editor adapter parity: ok');
