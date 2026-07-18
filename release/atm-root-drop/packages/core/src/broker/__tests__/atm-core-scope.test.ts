import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  analyzeAtmCoreScope,
  applyAtmScopeClassOverride,
  classifyAtmCorePath,
  deriveAtmScopeClass,
  type RunnerBuildScopeManifest
} from '../atm-core-scope.ts';

const manifest = JSON.parse(readFileSync('scripts/AtmCore/runner-build-scope.json', 'utf8')) as RunnerBuildScopeManifest;

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

assert.deepEqual(deriveAtmScopeClass(['packages/core/src/index.ts']).scopeClass, ['code']);
assert.deepEqual(deriveAtmScopeClass(['scripts/run-sealed-runner-build.ts']).scopeClass, ['code']);
assert.deepEqual(deriveAtmScopeClass(['templates/agent-pack/README.md']).scopeClass, ['code']);
assert.deepEqual(deriveAtmScopeClass(['schemas/atom.schema.json']).scopeClass, ['code']);
assert.deepEqual(deriveAtmScopeClass(['release/atm-onefile/atm.mjs']).scopeClass, ['code']);
assert.deepEqual(deriveAtmScopeClass(['package.json', 'tsconfig.json']).scopeClass, ['code']);
assert.deepEqual(deriveAtmScopeClass(['docs/ai_atomic_framework/tasks/ATM-GOV-0159.task.md']).scopeClass, ['docs']);
assert.deepEqual(deriveAtmScopeClass(['docs/governance/error-code-registry.json']).scopeClass, ['docs']);
assert.deepEqual(deriveAtmScopeClass(['.atm/history/tasks/ATM-GOV-0159.json']).scopeClass, ['ledger']);
assert.deepEqual(
  deriveAtmScopeClass(['docs/plan.md', '.atm/history/tasks/ATM-GOV-0159.json', 'packages/cli/src/atm.ts']).scopeClass,
  ['code', 'docs', 'ledger']
);

assert.deepEqual(applyAtmScopeClassOverride(['docs/plan.md'], ['ledger']).scopeClass, ['ledger']);
assert.deepEqual(applyAtmScopeClassOverride(['packages/core/src/index.ts'], ['docs']).scopeClass, ['code']);

console.log('[atm-core-scope:test] ok');
