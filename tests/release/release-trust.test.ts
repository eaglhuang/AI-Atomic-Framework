import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkStartupIntegrity } from '../../packages/cli/src/startup-integrity.ts';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-release-trust-');

function sha256Prefixed(value: string) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

try {
  const noManifest = checkStartupIntegrity(tempRoot);
  assert.equal(noManifest.ok, true);
  assert.equal(noManifest.mode, 'no-manifest');

  const releaseDir = path.join(tempRoot, 'release');
  mkdirSync(releaseDir, { recursive: true });
  const matrixPath = path.join(tempRoot, 'compatibility-matrix.json');
  const matrixContents = readFileSync(path.join(root, 'compatibility-matrix.json'), 'utf8');
  writeFileSync(matrixPath, matrixContents, 'utf8');

  const manifestPath = path.join(releaseDir, 'integrity.json');
  writeFileSync(manifestPath, `${JSON.stringify({
    schemaVersion: 'atm.releaseIntegrity.v0.1',
    version: '0.1.0',
    buildAt: '2026-06-30T00:00:00.000Z',
    artefacts: [
      {
        path: 'compatibility-matrix.json',
        sha256: sha256Prefixed(matrixContents)
      }
    ]
  }, null, 2)}\n`, 'utf8');

  const ok = checkStartupIntegrity(tempRoot);
  assert.equal(ok.ok, true);
  assert.equal(ok.mode, 'ok');
  assert.equal(ok.checks.length, 1);

  writeFileSync(matrixPath, `${matrixContents}\n`, 'utf8');
  const tampered = checkStartupIntegrity(tempRoot);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.mode, 'tampered');

  rmSync(matrixPath, { force: true });
  const missing = checkStartupIntegrity(tempRoot);
  assert.equal(missing.ok, false);
  assert.equal(missing.mode, 'missing-artefact');

  writeFileSync(manifestPath, '{not-json}\n', 'utf8');
  const parseError = checkStartupIntegrity(tempRoot);
  assert.equal(parseError.ok, false);
  assert.equal(parseError.mode, 'parse-error');

  console.log('[release-trust-test] ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
