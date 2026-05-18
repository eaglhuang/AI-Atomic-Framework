import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-release-trust-');

try {
  const compatibilityMatrix = readFileSync(path.join(root, 'compatibility-matrix.json'), 'utf8');
  const expectedHash = sha256(compatibilityMatrix);
  writeFileSync(path.join(tempRoot, 'compatibility-matrix.json'), compatibilityMatrix, 'utf8');
  mkdirSync(path.join(tempRoot, 'release'), { recursive: true });
  writeFileSync(path.join(tempRoot, 'release', 'integrity.json'), JSON.stringify({
    schemaVersion: 'atm.releaseIntegrity.v0.1',
    version: '0.0.0-test',
    buildAt: '2026-01-01T00:00:00.000Z',
    artefacts: [
      { path: 'compatibility-matrix.json', sha256: expectedHash }
    ]
  }, null, 2) + '\n', 'utf8');

  const trustedDoctor = runAtm(['doctor', '--trust', '--json'], tempRoot);
  assert.equal(trustedDoctor.parsed.evidence.trustIntegrity.ok, true);
  assert.equal(trustedDoctor.parsed.evidence.trustIntegrity.checks[0].expectedHash, expectedHash);
  assert.equal(trustedDoctor.parsed.evidence.trustIntegrity.checks[0].bundledHash, expectedHash);

  writeFileSync(path.join(tempRoot, 'compatibility-matrix.json'), compatibilityMatrix.replace('"0.0.0"', '"0.0.0-tampered"'), 'utf8');

  const blockedNext = runAtm(['next', '--json'], tempRoot);
  assert.equal(blockedNext.exitCode, 1);
  assert.equal(blockedNext.parsed.ok, false);
  assert.equal(blockedNext.parsed.messages[0].code, 'ATM_RELEASE_INTEGRITY_FAILED');
  assert.equal(blockedNext.parsed.evidence.trustIntegrity.mode, 'tampered');

  const tamperedDoctor = runAtm(['doctor', '--trust', '--json'], tempRoot);
  assert.equal(tamperedDoctor.parsed.evidence.trustIntegrity.ok, false);
  assert.equal(tamperedDoctor.parsed.evidence.trustIntegrity.mode, 'tampered');
  assert.equal(tamperedDoctor.parsed.evidence.trustIntegrity.checks[0].match, false);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[release-trust:test] ok (doctor hash output + tamper startup block)');

function sha256(content: string | Buffer) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function runAtm(args: readonly string[], trustRoot: string) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ATM_RELEASE_TRUST_ROOT: trustRoot
    }
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 1,
    parsed: JSON.parse(payload || '{}'),
    stdout: result.stdout,
    stderr: result.stderr
  };
}
