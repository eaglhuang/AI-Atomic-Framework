import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderOnefileRuntime } from '../../scripts/build-onefile-release.ts';
import { verifyRuntimeBuildIdentity } from '../../packages/cli/src/commands/shared/runtime-build-identity-verifier.ts';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const version = '1.2.3';
const prefix = 'packages/cli/dist/';
type Member = { path: string; mode: number; dataBase64: string };
const member = (file: string, body: string | Buffer): Member => ({ path: file, mode: 0o644, dataBase64: Buffer.from(body).toString('base64') });
function fixture() {
  const runtime = 'throw new Error("Fast version must not import CLI or extract payload");';
  const content = { schemaId: 'atm.runtimeBuildIdentity.v1', sourceCommit: 'a'.repeat(40), sourceDigest: 'b'.repeat(64), packageName: '@ai-atomic-framework/cli', version,
    files: [{ path: 'atm.js', sha256: hash(runtime) }] };
  const identity = { ...content, buildId: hash(JSON.stringify(content)) };
  return { identity, files: [member('packages/cli/package.json', JSON.stringify({ name: identity.packageName, version })),
    member(`${prefix}build-identity.json`, JSON.stringify(identity)), member(`${prefix}atm.js`, runtime)] };
}
function replace(files: Member[], file: string, body: string | Buffer) { files[files.findIndex(item => item.path === file)] = member(file, body); }
function resign(identity: ReturnType<typeof fixture>['identity']) { const { buildId: _old, ...content } = identity; identity.buildId = hash(JSON.stringify(content)); }
function snapshotCache(root: string): unknown {
  return readdirSync(root, { withFileTypes: true }).map(entry => {
    const file = path.join(root, entry.name); const stat = statSync(file);
    return [entry.name, stat.mode, stat.mtimeMs, entry.isDirectory() ? snapshotCache(file) : hash(readFileSync(file))];
  });
}
function invoke(files: Member[], options: { flag?: string; warm?: boolean; checksum?: string; rawPayload?: Buffer; encoded?: string; frameworkVersion?: string } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-onefile-version-'));
  try {
    const cache = path.join(root, 'cache');
    const compressed = options.rawPayload ?? gzipSync(Buffer.from(JSON.stringify({ schemaVersion: 'atm.onefilePayload.v0.1', files })));
    if (options.warm) {
      const payloadRoot = path.join(cache, hash(compressed)); const lock = `${payloadRoot}.lock`;
      mkdirSync(payloadRoot, { recursive: true }); mkdirSync(lock);
      writeFileSync(path.join(payloadRoot, '.payload-ready.json'), JSON.stringify({ payloadSha256: hash(compressed) }));
      writeFileSync(path.join(payloadRoot, 'tampered-cache'), 'retain'); writeFileSync(path.join(lock, 'owner.json'), '{"pid":1}');
    }
    const beforeCache = options.warm ? snapshotCache(cache) : null;
    const launcher = path.join(root, 'atm.mjs');
    writeFileSync(launcher, renderOnefileRuntime({ payloadFiles: files, payloadBase64: options.encoded ?? compressed.toString('base64'), payloadSha256: options.checksum ?? hash(compressed), frameworkVersion: options.frameworkVersion ?? version }));
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@ai-atomic-framework/cli', version: '99.0.0' }));
    const result = spawnSync(process.execPath, [launcher, options.flag ?? '--version', '--json'], { cwd: root, encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, ATM_ONEFILE_CACHE_ROOT: cache, ATM_ONEFILE_RUNTIME: '1', ATM_ONEFILE_LAUNCHER_PATH: '/fake/launcher', ATM_ONEFILE_PAYLOAD_SHA256: 'f'.repeat(64), ATM_ONEFILE_EXTRACTED_ROOT: '/fake/cache' } });
    assert.equal(result.error, undefined, String(result.error));
    if (options.warm) assert.deepEqual(snapshotCache(cache), beforeCache, 'warm cache and active extraction lock must remain byte/mode/mtime unchanged');
    else assert.equal(existsSync(cache), false, 'fast version must not create an extraction cache');
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, result: result.stdout.trim() ? JSON.parse(result.stdout) : null };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function assertMismatch(files: Member[]) {
  const result = invoke(files); assert.equal(result.status, 0, result.stderr);
  const identity = result.result.evidence.runtimeBuildIdentity;
  assert.equal(identity.status, 'mismatch');
  for (const field of ['sourceCommit', 'sourceDigest', 'buildId']) assert.equal(identity[field], null);
}

for (const flag of ['--version', '-v']) for (const warm of [false, true]) test(`${flag} verifies embedded identity without ${warm ? 'touching warm' : 'creating cold'} cache`, () => {
  const data = fixture(); const result = invoke(data.files, { flag, warm }); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.result.evidence.runtimeBuildIdentity, { schemaId: 'atm.runtimeIdentity.v1', packageName: '@ai-atomic-framework/cli', executionMode: 'distribution', version, status: 'verified',
    sourceCommit: data.identity.sourceCommit, sourceDigest: data.identity.sourceDigest, buildId: data.identity.buildId });
  assert.equal(result.result.evidence.runnerMode.mode, 'frozen');
});
test('legacy payload without identity is unavailable', () => {
  const data = fixture(); const result = invoke(data.files.filter(file => file.path !== `${prefix}build-identity.json`));
  assert.equal(result.status, 0); assert.equal(result.result.evidence.runtimeBuildIdentity.status, 'unavailable');
  assert.equal(result.result.evidence.runtimeBuildIdentity.sourceCommit, null);
});
test('compressed checksum failure never emits a valid seal', () => {
  const result = invoke(fixture().files, { checksum: '0'.repeat(64) }); assert.notEqual(result.status, 0); assert.equal(result.result, null);
});
test('invalid compressed base64 never emits a valid seal', () => { const result = invoke(fixture().files, { encoded: '!!!!' }); assert.notEqual(result.status, 0); assert.equal(result.result, null); });
for (const field of ['packageName', 'version', 'sourceCommit', 'sourceDigest', 'buildId'] as const) test(`rejects invalid embedded ${field}`, () => {
  const data = fixture(); data.identity[field] = field === 'version' ? '9.9.9' : 'invalid'; if (field !== 'buildId') resign(data.identity);
  replace(data.files, `${prefix}build-identity.json`, JSON.stringify(data.identity)); assertMismatch(data.files);
});
test('rejects rechecksummed payload with changed runtime bytes', () => { const data = fixture(); replace(data.files, `${prefix}atm.js`, 'changed'); assertMismatch(data.files); });
test('rejects malformed identity JSON', () => { const data = fixture(); replace(data.files, `${prefix}build-identity.json`, '{'); assertMismatch(data.files); });
test('rejects wrong embedded package version', () => { const data = fixture(); replace(data.files, 'packages/cli/package.json', JSON.stringify({ name: '@ai-atomic-framework/cli', version: '9.9.9' })); assertMismatch(data.files); });
test('rejects missing runtime member', () => { const data = fixture(); assertMismatch(data.files.filter(file => file.path !== `${prefix}atm.js`)); });
test('rejects duplicate payload paths', () => { const data = fixture(); assertMismatch([...data.files, data.files[0]]); });
test('rejects oversized member paths before prefix processing', () => { assertMismatch([...fixture().files, member('x'.repeat(4097), '')]); });
for (const invalid of ['bad\0.js', 'atm.js/child']) for (const reversed of [false, true]) test(`rejects impossible member ${JSON.stringify(invalid)} in ${reversed ? 'reverse' : 'forward'} order`, () => {
  const data = fixture(); data.identity.files.push({ path: invalid, sha256: hash('extra') }); if (reversed) data.identity.files.reverse(); resign(data.identity);
  replace(data.files, `${prefix}build-identity.json`, JSON.stringify(data.identity)); data.files.push(member(prefix + invalid, 'extra')); if (reversed) data.files.reverse();
  assertMismatch(data.files);
  let reads = 0;
  assert.throws(() => verifyRuntimeBuildIdentity(data.identity, version, 'atm.js', () => { reads++; return { digest: hash('extra'), bytes: 5 }; }, hash));
  assert.equal(reads, 0, 'all member paths must be validated before reading any member');
});
for (const boundary of ['packages/cli/dist/package.json', 'packages/cli/dist/commands/package.json', 'packages/cli/dist/commands/doctor/package.json']) {
  for (const body of ['{', JSON.stringify({ name: 'unrelated', version })]) test(`rejects nearer package boundary ${boundary} (${body === '{' ? 'malformed' : 'other package'})`, () => {
    assertMismatch([...fixture().files, member(boundary, body)]);
  });
}
test('equal invalid package, launcher and build versions cannot verify', () => {
  const data = fixture(); data.identity.version = 'invalid'; resign(data.identity);
  replace(data.files, `${prefix}build-identity.json`, JSON.stringify(data.identity));
  replace(data.files, 'packages/cli/package.json', JSON.stringify({ name: data.identity.packageName, version: 'invalid' }));
  const result = invoke(data.files, { frameworkVersion: 'invalid' }); assert.equal(result.status, 0);
  assert.notEqual(result.result.evidence.runtimeBuildIdentity.status, 'verified'); assert.equal(result.result.evidence.runtimeBuildIdentity.sourceCommit, null);
});
for (const file of ['../escape', '/absolute', 'a/./b', 'a//b', 'a\\b']) test(`rejects noncanonical payload path ${file}`, () => { const data = fixture(); assertMismatch([...data.files, member(file, '')]); });
test('rejects invalid base64', () => { const data = fixture(); data.files[2].dataBase64 = '!!!!'; assertMismatch(data.files); });
test('verifies a large valid runtime member', () => {
  const data = fixture(); const bytes = Buffer.alloc(2 * 1024 * 1024, 32);
  replace(data.files, `${prefix}atm.js`, bytes); data.identity.files[0].sha256 = hash(bytes); resign(data.identity);
  replace(data.files, `${prefix}build-identity.json`, JSON.stringify(data.identity));
  const result = invoke(data.files); assert.equal(result.status, 0); assert.equal(result.result.evidence.runtimeBuildIdentity.status, 'verified');
});
test('rejects noncanonical padding bits even in an unused member', () => { const data = fixture(); assertMismatch([...data.files, { path: 'extra', mode: 0o644, dataBase64: 'AB==' }]); });
test('rejects oversized package metadata', () => { const data = fixture(); replace(data.files, 'packages/cli/package.json', ' '.repeat(1024 * 1024 + 1)); assertMismatch(data.files); });
test('rejects per-member decoded-byte overflow before decoding it', () => { const data = fixture(); assertMismatch([...data.files, member('extra', Buffer.alloc(32 * 1024 * 1024 + 1))]); });
test('rejects total decoded-byte overflow', () => { const data = fixture(); assertMismatch([...data.files, member('extra-a', Buffer.alloc(32 * 1024 * 1024)), member('extra-b', Buffer.alloc(32 * 1024 * 1024))]); });
test('rejects oversized identity metadata before JSON parsing', () => { const data = fixture(); replace(data.files, `${prefix}build-identity.json`, ' '.repeat(1024 * 1024 + 1)); assertMismatch(data.files); });
test('rejects too many payload members', () => { const data = fixture(); assertMismatch([...data.files, ...Array.from({ length: 4096 }, (_, index) => member(`extra/${index}`, ''))]); });
test('rejects too many identity members', () => { const data = fixture(); data.identity.files = Array.from({ length: 4097 }, (_, index) => ({ path: `file${index}.js`, sha256: 'a'.repeat(64) })); resign(data.identity); replace(data.files, `${prefix}build-identity.json`, JSON.stringify(data.identity)); assertMismatch(data.files); });
test('rejects compressed-input budget before base64 allocation', () => { const result = invoke(fixture().files, { encoded: 'a'.repeat(Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4) }); assert.notEqual(result.status, 0); assert.equal(result.result, null); });
test('bounds decompression before parsing payload JSON', () => { const bomb = gzipSync(Buffer.alloc(128 * 1024 * 1024 + 1, 32)); const result = invoke(fixture().files, { rawPayload: bomb }); assert.notEqual(result.status, 0); assert.equal(result.result, null); });

let doctorBundle: Promise<Buffer> | undefined;
async function actualDoctorFixture() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const doctorSource = path.join(repositoryRoot, 'packages/cli/src/commands/doctor/run-doctor.ts');
  doctorBundle ??= build({ stdin: { contents: `import { runDoctor } from ${JSON.stringify(doctorSource)}; const result = await runDoctor(process.argv.slice(2)); process.stdout.write(JSON.stringify(result));`,
    resolveDir: repositoryRoot, sourcefile: 'doctor-parity-entry.ts', loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', target: 'node24', write: false,
    banner: { js: "import { createRequire as makeRequire } from 'node:module'; const require = makeRequire(import.meta.url);" },
    plugins: [{ name: 'preserve-support-module-locations', setup(builder) {
      builder.onLoad({ filter: /\.[cm]?[jt]s$/ }, args => {
        // Keep support-module resource resolution at its real source location.
        // The actual doctor module uses its real fixture executable URL, so its
        // nearest-package and FD-backed identity checks are not mocked.
        if (!args.path.startsWith(`${repositoryRoot}${path.sep}packages${path.sep}`) || args.path === doctorSource) return;
        return { contents: readFileSync(args.path, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(args.path).href)), loader: args.path.endsWith('.ts') ? 'ts' : 'js' };
      });
    } }]
  }).then(result => Buffer.from(result.outputFiles[0].contents));
  const bytes = await doctorBundle; const data = fixture();
  data.identity.files.push({ path: 'commands/doctor/run-doctor.js', sha256: hash(bytes) }); resign(data.identity);
  replace(data.files, `${prefix}build-identity.json`, JSON.stringify(data.identity));
  replace(data.files, 'packages/cli/package.json', JSON.stringify({ name: data.identity.packageName, version, type: 'module' }));
  data.files.push(member(`${prefix}commands/doctor/run-doctor.js`, bytes)); return data;
}
function invokeActualDoctor(files: Member[]) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-doctor-identity-parity-'));
  try {
    for (const file of files) { const target = path.join(root, file.path); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, Buffer.from(file.dataBase64, 'base64')); }
    const target = path.join(root, 'adopter'); mkdirSync(target);
    const result = spawnSync(process.execPath, [path.join(root, prefix, 'commands/doctor/run-doctor.js'), '--cwd', target, '--json'], { encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.error, undefined, String(result.error));
    // A malformed nearest package may stop Node before doctor can run.
    return result.stdout.trim() ? JSON.parse(result.stdout).evidence?.runtimeBuildIdentity : null;
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('actual doctor and rendered fast version agree on valid identity', async () => {
  const data = await actualDoctorFixture(); const doctor = invokeActualDoctor(data.files);
  assert.equal(doctor.status, 'verified'); assert.deepEqual(invoke(data.files).result.evidence.runtimeBuildIdentity, doctor);
});
for (const boundary of ['packages/cli/dist/package.json', 'packages/cli/dist/commands/package.json', 'packages/cli/dist/commands/doctor/package.json']) {
  for (const body of ['{', JSON.stringify({ name: 'unrelated', version, type: 'module' })]) test(`actual doctor/fast refuse nearer boundary ${boundary} (${body === '{' ? 'malformed' : 'other package'})`, async () => {
    const data = await actualDoctorFixture(); data.files.push(member(boundary, body));
    assert.notEqual(invokeActualDoctor(data.files)?.status, 'verified'); assertMismatch(data.files);
  });
}
test('actual doctor/fast refuse equal invalid versions', async () => {
  const data = await actualDoctorFixture(); data.identity.version = 'invalid'; resign(data.identity);
  replace(data.files, `${prefix}build-identity.json`, JSON.stringify(data.identity));
  replace(data.files, 'packages/cli/package.json', JSON.stringify({ name: data.identity.packageName, version: 'invalid', type: 'module' }));
  assert.notEqual(invokeActualDoctor(data.files)?.status, 'verified');
  const fast = invoke(data.files, { frameworkVersion: 'invalid' }).result.evidence.runtimeBuildIdentity;
  assert.notEqual(fast.status, 'verified'); assert.equal(fast.sourceCommit, null);
});
for (const boundary of ['packages/cli/dist/package.json', 'packages/cli/dist/commands/package.json', 'packages/cli/dist/commands/doctor/package.json']) {
  test(`actual doctor/fast refuse directory package boundary ${boundary}`, async () => {
    const data = await actualDoctorFixture(); data.files.push(member(`${boundary}/child.txt`, 'directory boundary'));
    assert.notEqual(invokeActualDoctor(data.files)?.status, 'verified'); assertMismatch(data.files);
  });
}
test('similarly named directory is not a package boundary', async () => {
  const data = await actualDoctorFixture(); data.files.push(member('packages/cli/dist/package.json.backup/child.txt', 'unrelated directory'));
  const doctor = invokeActualDoctor(data.files); assert.equal(doctor.status, 'verified');
  assert.deepEqual(invoke(data.files).result.evidence.runtimeBuildIdentity, doctor);
});
