import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveRuntimePackage } from '../../packages/cli/src/commands/shared/runtime-build-identity.ts';
import { resolveFirstRunRuntime } from '../../packages/cli/src/commands/first-run.ts';
import { identityMetadataByteLimit } from '../../packages/core/src/project/framework-identity.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-shared-runtime-'));
const pkg = path.join(root, 'actual-cli');
const metadata = path.join(pkg, 'package.json');
const moduleUrl = pathToFileURL(path.join(pkg, 'src/commands/first-run.ts')).href;
const runner = path.join(pkg, 'src/atm.ts');
let cases = 0;
const test = (label: string, fn: () => void) => { fn(); cases++; console.log(`ok: ${label}`); };
const manifest = (version: unknown = '1.2.3') => JSON.stringify({ name: '@ai-atomic-framework/cli', version });
const first = () => resolveFirstRunRuntime(['setup', 'next', 'doctor'], moduleUrl, runner, {});
const same = () => { const identity = resolveRuntimePackage(moduleUrl); const runtime = first(); assert.equal(runtime.installationRoot, identity?.installationRoot ?? null); assert.equal(runtime.version, identity?.version ?? null); return runtime; };
try {
  mkdirSync(path.dirname(runner), { recursive: true });
  mkdirSync(path.dirname(new URL(moduleUrl).pathname), { recursive: true });
  writeFileSync(runner, '// fixture runner');
  writeFileSync(path.join(root, 'package.json'), manifest('99.0.0'));
  writeFileSync(metadata, manifest());
  test('first-run and diagnostics share actual package facts', () => { const r = same(); assert.equal(r.status, 'available'); assert.equal(r.version, '1.2.3'); });
  test('invalid version retains package root but disables execution', () => { writeFileSync(metadata, manifest('invalid')); const r = same(); assert.equal(r.installationRoot, pkg); assert.equal(r.version, null); assert.equal(r.status, 'inconsistent-runtime'); });
  test('unrelated package blocks ancestor version spoofing', () => { writeFileSync(metadata, JSON.stringify({ name: 'consumer', version: '1.0.0' })); assert.equal(same().version, null); });
  for (const [label, bytes] of [['malformed', '{'], ['array', '[]'], ['oversized', JSON.stringify({ name: '@ai-atomic-framework/cli', version: '7.0.0', data: 'x'.repeat(identityMetadataByteLimit) })]]) {
    test(`${label} package boundary fails closed in both callers`, () => { writeFileSync(metadata, bytes); assert.equal(same().installationRoot, null); });
  }
  test('symlink package boundary fails closed', () => { rmSync(metadata); symlinkSync(path.join(root, 'package.json'), metadata); assert.equal(same().version, null); rmSync(metadata); });
  test('dangling symlink blocks ancestor fallback', () => { symlinkSync(path.join(root, 'absent.json'), metadata); assert.equal(same().version, null); rmSync(metadata); });
  test('directory package boundary fails closed', () => { mkdirSync(metadata); assert.equal(same().version, null); rmSync(metadata, { recursive: true }); });
  writeFileSync(metadata, manifest());
  test('root help package resolution does not read build hashes', () => { mkdirSync(path.join(pkg, 'dist/npm-runtime'), { recursive: true }); writeFileSync(path.join(pkg, 'dist/npm-runtime/build-identity.json'), '{malformed'); assert.equal(same().status, 'available'); });
  test('loaded registry still determines capabilities', () => { assert.deepEqual(Object.keys(resolveFirstRunRuntime(['next'], moduleUrl, runner, {}).commands), ['next']); });
  test('unknown executable is not promoted to an available runtime', () => { assert.equal(resolveFirstRunRuntime(['next'], moduleUrl, path.join(root, 'other.mjs'), {}).status, 'unknown-entrypoint'); });
  test('first-run has no separate package walk or build verification', () => { const text = readFileSync(new URL('../../packages/cli/src/commands/first-run.ts', import.meta.url), 'utf8'); assert.match(text, /resolveRuntimePackage\(moduleUrl\)/); assert.doesNotMatch(text, /let cursor =|readRuntimeBuildIdentity/); });
  console.log(`shared runtime package resolver: ${cases} cases passed`);
} finally { rmSync(root, { recursive: true, force: true }); }
