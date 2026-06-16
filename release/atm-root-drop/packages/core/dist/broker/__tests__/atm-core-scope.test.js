import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeAtmCoreScope, classifyAtmCorePath } from '../atm-core-scope.js';
const manifest = JSON.parse(readFileSync('scripts/AtmCore/runner-build-scope.json', 'utf8'));
assert.equal(classifyAtmCorePath(manifest, 'packages/core/src/index.ts').kind, 'atm-core');
assert.equal(classifyAtmCorePath(manifest, 'packages/cli/src/commands/next.ts').kind, 'atm-core');
assert.equal(classifyAtmCorePath(manifest, 'packages/plugin-governance-local/src/index.ts').kind, 'atm-core');
assert.equal(classifyAtmCorePath(manifest, 'schemas/atom.schema.json').kind, 'atm-core');
assert.equal(classifyAtmCorePath(manifest, 'scripts/AtmCore/runner-build-scope.json').kind, 'atm-core');
assert.equal(classifyAtmCorePath(manifest, 'scripts/build-onefile-release.ts').kind, 'atm-core');
assert.equal(classifyAtmCorePath(manifest, 'atm.mjs').kind, 'atm-core');
assert.equal(classifyAtmCorePath(manifest, 'docs/notes.md').kind, 'non-core-planning');
assert.equal(classifyAtmCorePath(manifest, 'atomic_workbench/atomization-coverage/path-to-atom-map.json').kind, 'non-core-planning');
const releaseClassification = classifyAtmCorePath(manifest, 'release/atm-onefile/atm.mjs');
assert.equal(releaseClassification.kind, 'generated-artifact');
assert.equal(releaseClassification.stewardOnly, true);
const report = analyzeAtmCoreScope(manifest, [
    'packages/core/src/broker/atm-core-scope.ts',
    'release/atm-root-drop/release-manifest.json',
    'tmp/random.txt'
]);
assert.equal(report.schemaId, 'atm.atmCoreScopeReport.v1');
assert.equal(report.runnerSyncNeeded, true);
assert.equal(report.diagnostics.some((diagnostic) => diagnostic.code === 'ATM_CORE_SCOPE_RELEASE_WRITE_STEWARD_ONLY'), true);
assert.equal(report.diagnostics.some((diagnostic) => diagnostic.code === 'ATM_CORE_SCOPE_UNDECLARED_WRITE'), true);
console.log('[atm-core-scope:test] ok');
