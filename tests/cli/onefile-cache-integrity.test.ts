import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { renderOnefileRuntime } from '../../scripts/build-onefile-release.ts';

const temp = mkdtempSync(path.join(os.tmpdir(), 'atm-cache-integrity-'));
const files = [
  { path: 'atm.mjs', dataBase64: Buffer.from('// stable fallback').toString('base64') },
  { path: 'packages/cli/package.json', dataBase64: Buffer.from('{"type":"module"}').toString('base64') },
  { path: 'packages/cli/dist/atm.js', dataBase64: Buffer.from("export async function runCli() { console.log('ORIGINAL'); return 0; }").toString('base64') }
];
const compressed = gzipSync(JSON.stringify({ schemaVersion: 'atm.onefilePayload.v0.1', files }));
const digest = createHash('sha256').update(compressed).digest('hex');
const launcher = path.join(temp, 'launcher.mjs');
const cache = path.join(temp, 'cache', digest);
function run() {
  const result = spawnSync(process.execPath, [launcher, 'tasks', 'list'], {
    cwd: temp, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, ATM_ONEFILE_CACHE_ROOT: path.join(temp, 'cache') }
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ORIGINAL');
}
try {
  writeFileSync(launcher, renderOnefileRuntime({ payloadBase64: compressed.toString('base64'), payloadSha256: digest, frameworkVersion: '0.0.0', payloadFiles: files }));
  run();
  run();
  writeFileSync(path.join(cache, 'packages/cli/dist/atm.js'), "export async function runCli() { console.log('TAMPERED'); return 0; }");
  run();
  rmSync(path.join(cache, 'packages/cli/package.json'));
  run();
  writeFileSync(path.join(cache, '.payload-ready.json'), '{}');
  run();
  for (const file of files) assert.equal(readFileSync(path.join(cache, file.path)).toString('base64'), file.dataBase64);
  console.log('[onefile-cache-integrity] cold/warm/tampered/missing/marker passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
