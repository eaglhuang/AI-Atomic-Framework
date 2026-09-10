import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isOnefilePayloadPath } from '../../scripts/build-onefile-release.ts';

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

console.log('[onefile-runtime-closure:test] ok');
