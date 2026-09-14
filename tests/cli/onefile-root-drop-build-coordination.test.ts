import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRootDropRelease } from '../../scripts/build-root-drop-release.ts';

const repo = path.resolve(import.meta.dirname, '..', '..');
const rootDropSource = readFileSync(path.join(repo, 'scripts', 'build-root-drop-release.ts'), 'utf8');
const onefileSource = readFileSync(path.join(repo, 'scripts', 'build-onefile-release.ts'), 'utf8');

assert.match(rootDropSource, /if \(options\.packageDistReady !== true\)\s*\{\s*ensureBuiltPackageDist\(repositoryRoot\);/s);
assert.match(onefileSource, /buildRootDropRelease\(\{ repositoryRoot, releaseRoot: rootDropRoot, packageDistReady: true \}\);/);

// The public builder contract remains safe for direct callers.  The test
// injects a ready package-dist state only to exercise the coordination seam
// without rebuilding the complete framework fixture.
const temp = mkdtempSync(path.join(os.tmpdir(), 'atm-onefile-root-drop-coordination-'));
const releaseRoot = path.join(temp, 'root-drop');
try {
  const result = buildRootDropRelease({ repositoryRoot: repo, releaseRoot, packageDistReady: true });
  assert.equal(result.manifestPath, path.join(releaseRoot, 'release-manifest.json'));
  console.log('ok: onefile coordinates one package-dist build; direct root-drop keeps refresh-by-default contract');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
