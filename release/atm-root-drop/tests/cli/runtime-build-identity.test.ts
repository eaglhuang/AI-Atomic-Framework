import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRuntimeBuildIdentity, resolveRuntimePackage, runtimeIdentityReadLimits } from '../../packages/cli/src/commands/shared/runtime-build-identity.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-runtime-identity-'));
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
let cases = 0;
function test(name: string, fn: () => void) { fn(); cases++; console.log(`ok: ${name}`); }
try {
  const pkg = path.join(root, 'cli');
  const runtime = path.join(pkg, 'dist/npm-runtime');
  mkdirSync(path.join(runtime, 'data/commands/doctor'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@ai-atomic-framework/cli', version: '99.0.0' }));
  writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@ai-atomic-framework/cli', version: '1.2.3' }));
  const moduleUrl = pathToFileURL(path.join(runtime, 'data/commands/doctor/run-doctor.js')).href;
  const content = { schemaId: 'atm.runtimeBuildIdentity.v1', sourceCommit: 'a'.repeat(40), sourceDigest: 'b'.repeat(64), packageName: '@ai-atomic-framework/cli', version: '1.2.3', files: [{ path: 'runtime.mjs', sha256: hash('actual runtime') }] };
  const writeIdentity = (value = content) => writeFileSync(path.join(runtime, 'build-identity.json'), JSON.stringify({ ...value, buildId: hash(JSON.stringify(value)) }));
  writeFileSync(path.join(runtime, 'runtime.mjs'), 'actual runtime');
  test('missing build identity is explicit', () => assert.equal(readRuntimeBuildIdentity(moduleUrl).status, 'unavailable'));
  writeIdentity();
  test('actual npm runtime bytes and source are verified', () => { const r = readRuntimeBuildIdentity(moduleUrl); assert.equal(r.status, 'verified'); assert.equal(r.executionMode, 'npm-package'); assert.equal(r.version, '1.2.3'); assert.equal(r.sourceCommit, content.sourceCommit); });
  test('tampered runtime bytes fail closed', () => { writeFileSync(path.join(runtime, 'runtime.mjs'), 'tampered'); assert.equal(readRuntimeBuildIdentity(moduleUrl).status, 'mismatch'); writeFileSync(path.join(runtime, 'runtime.mjs'), 'actual runtime'); });
  test('forged ancestor cannot override actual package', () => assert.equal(resolveRuntimePackage(moduleUrl)?.version, '1.2.3'));
  test('wrong inner package stops ancestor search', () => { writeFileSync(path.join(runtime, 'data/package.json'), JSON.stringify({ name: 'consumer', version: '7.0.0' })); assert.equal(resolveRuntimePackage(moduleUrl), null); rmSync(path.join(runtime, 'data/package.json')); });
  test('malformed inner package stops ancestor search', () => { writeFileSync(path.join(runtime, 'data/package.json'), '{'); assert.equal(resolveRuntimePackage(moduleUrl), null); rmSync(path.join(runtime, 'data/package.json')); });
  test('wrong package version cannot claim verified build', () => { writeIdentity({ ...content, version: '2.0.0' }); assert.equal(readRuntimeBuildIdentity(moduleUrl).status, 'mismatch'); writeIdentity(); });
  test('environment hints cannot spoof identity', () => { const old = process.env.ATM_SOURCE_COMMIT; process.env.ATM_SOURCE_COMMIT = 'c'.repeat(40); assert.equal(readRuntimeBuildIdentity(moduleUrl).sourceCommit, content.sourceCommit); if (old === undefined) delete process.env.ATM_SOURCE_COMMIT; else process.env.ATM_SOURCE_COMMIT = old; });
  test('identity digest tampering fails closed', () => { writeFileSync(path.join(runtime, 'build-identity.json'), JSON.stringify({ ...content, buildId: 'f'.repeat(64) })); assert.equal(readRuntimeBuildIdentity(moduleUrl).status, 'mismatch'); writeIdentity(); });
  test('manifest traversal fails closed', () => { writeIdentity({ ...content, files: [{ path: '../runtime.mjs', sha256: hash('actual runtime') }] }); assert.equal(readRuntimeBuildIdentity(moduleUrl).status, 'mismatch'); writeIdentity(); });
  test('symlink runtime member fails closed', () => { rmSync(path.join(runtime, 'runtime.mjs')); writeFileSync(path.join(root, 'foreign.mjs'), 'actual runtime'); symlinkSync(path.join(root, 'foreign.mjs'), path.join(runtime, 'runtime.mjs')); assert.equal(readRuntimeBuildIdentity(moduleUrl).status, 'mismatch'); rmSync(path.join(runtime, 'runtime.mjs')); writeFileSync(path.join(runtime, 'runtime.mjs'), 'actual runtime'); });
  test('oversized runtime members fail before allocation', () => { writeFileSync(path.join(runtime, 'runtime.mjs'), ''); truncateSync(path.join(runtime, 'runtime.mjs'), runtimeIdentityReadLimits.maxMemberBytes + 1); assert.equal(readRuntimeBuildIdentity(moduleUrl).status, 'mismatch'); writeFileSync(path.join(runtime, 'runtime.mjs'), 'actual runtime'); });
  test('directory runtime members fail closed', () => { rmSync(path.join(runtime, 'runtime.mjs')); mkdirSync(path.join(runtime, 'runtime.mjs')); assert.equal(readRuntimeBuildIdentity(moduleUrl).status, 'mismatch'); rmSync(path.join(runtime, 'runtime.mjs'), { recursive: true }); writeFileSync(path.join(runtime, 'runtime.mjs'), 'actual runtime'); });
  if (process.platform !== 'win32') test('FIFO runtime member cannot block identity diagnostics', () => {
    rmSync(path.join(runtime, 'runtime.mjs'));
    execFileSync('mkfifo', [path.join(runtime, 'runtime.mjs')]);
    const helper = new URL('../../packages/cli/src/commands/shared/runtime-build-identity.ts', import.meta.url).href;
    const probe = `import { readRuntimeBuildIdentity } from ${JSON.stringify(helper)}; console.log(JSON.stringify(readRuntimeBuildIdentity(${JSON.stringify(moduleUrl)})));`;
    const child = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', probe], { encoding: 'utf8', timeout: 2500 });
    assert.equal(child.error, undefined, 'FIFO probe must finish without a timeout');
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout).status, 'mismatch');
    rmSync(path.join(runtime, 'runtime.mjs')); writeFileSync(path.join(runtime, 'runtime.mjs'), 'actual runtime');
  });
  test('source execution does not claim released build parity', () => { mkdirSync(path.join(pkg, 'src'), { recursive: true }); assert.equal(readRuntimeBuildIdentity(pathToFileURL(path.join(pkg, 'src/atm.ts')).href).status, 'source-unsealed'); });
  console.log(`runtime build identity: ${cases} cases passed`);
} finally { rmSync(root, { recursive: true, force: true }); }
