import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isOnefilePayloadPath } from '../../scripts/build-onefile-release.ts';
import { isOnefileRuntimeDependencyPath } from '../../scripts/onefile-runtime-closure.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const builder = readFileSync(path.join(root, 'scripts', 'build-onefile-release.ts'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const fastVersionRuntime = readFileSync(path.join(root, 'scripts', 'onefile-fast-version-runtime.ts'), 'utf8');

assert.match(builder, /renderOnefileFastVersionRuntime/, 'onefile builder must inject the dedicated fast-version runtime fragment');
assert.match(fastVersionRuntime, /function isVersionRequest\(args\)/, 'onefile launcher must recognize a direct version request before extraction');
assert.match(fastVersionRuntime, /function writeFastVersionResult\(\)/, 'onefile launcher must expose a sealed version envelope without importing every CLI command');
assert.ok([
  'node --strip-types scripts/build-onefile-release.ts',
  'node --strip-types scripts/run-sealed-runner-build.ts onefile'
].includes(packageJson.scripts['build:onefile-release']), 'onefile package script must use the canonical builder or sealed wrapper');

// A onefile launcher must carry one executable closure: the CLI and its
// vendored runtime dependencies. Root workspace copies are development-tree
// duplicates and must never silently re-enter the payload.
for (const path of [
  'packages/cli/package.json',
  'packages/cli/dist/atm.js',
  'packages/cli/dist/_vendor/core/dist/index.js',
  'packages/cli/dist/templates/root-drop/AGENTS.md',
  'packages/cli/src/atm.ts'
]) {
  assert.equal(isOnefilePayloadPath(path), true, `CLI runtime path must remain in onefile payload: ${path}`);
}

for (const path of [
  'docs/governance/docs-neutrality-policy.json',
  'docs/governance/error-code-registry.json',
  'docs/governance/tasks-audit-warning-baseline.json'
]) {
  assert.equal(isOnefilePayloadPath(path), true, `runtime governance record must remain in onefile payload: ${path}`);
}

for (const path of [
  'packages/core/package.json',
  'packages/core/dist/index.js',
  'packages/core/src/index.ts',
  'packages/integrations-core/dist/index.js',
  'packages/language-python/dist/index.js'
]) {
  assert.equal(isOnefilePayloadPath(path), false, `duplicate root workspace must stay outside onefile payload: ${path}`);
}

assert.equal(isOnefilePayloadPath('packages/cli/dist/npm-runtime/runtime.mjs'), false, 'npm-only compact runtime must stay outside onefile payload');

for (const path of [
  'docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-08-12-001.json'
]) {
  assert.equal(isOnefilePayloadPath(path), false, `host governance projection must stay outside onefile payload: ${path}`);
}

// Atomize subcommands import helper modules and a framework-owned taxonomy
// from the framework root. An adopter repo cannot provide them, so the onefile
// payload must carry them or `atomize inventory|backfill` fails before scanning.
for (const path of [
  'scripts/src/atomize-inventory.js',
  'scripts/src/atomize-backfill.js',
  'scripts/src/atomize-score.js',
  'scripts/src/atomization-register-receipt.js',
  'docs/ATOMIZATION_COVERAGE_TAXONOMY.md',
  'atomic_workbench/atomization-coverage/path-to-atom-map-shards/merge.js'
]) {
  assert.equal(isOnefilePayloadPath(path), true, `atomize helper must remain in onefile payload: ${path}`);
}

// broker proposal validation imports ajv by bare specifier. The onefile has no
// node_modules of its own, so the ajv closure is carried from the host install.
for (const path of [
  'node_modules/ajv/package.json',
  'node_modules/ajv/dist/2020.js',
  'node_modules/ajv-formats/dist/index.js',
  'node_modules/fast-uri/index.js',
  'node_modules/json-schema-traverse/index.js'
]) {
  assert.equal(isOnefileRuntimeDependencyPath(path), true, `ajv runtime closure must be embedded: ${path}`);
}
for (const path of [
  'node_modules/ajv/dist/compile/validate.d.ts',
  'node_modules/ajv/dist/2020.js.map',
  'node_modules/ajv/lib/compile/index.ts',
  'node_modules/ajv/dist/tests/unit.js',
  'node_modules/typescript/lib/typescript.js',
  'node_modules/ajv/README.md'
]) {
  assert.equal(isOnefileRuntimeDependencyPath(path), false, `non-runtime or unrelated module must stay out of onefile payload: ${path}`);
}
assert.match(builder, /collectRuntimeDependencyPayloadFiles\(repositoryRoot\)/, 'onefile builder must embed the runtime dependency closure from the host install');

console.log('[onefile-runtime-closure:test] ok');
