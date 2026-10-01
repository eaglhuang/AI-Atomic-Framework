import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRootDropRelease, hydrateVerifiedRootDropBase } from '../../scripts/build-root-drop-release.ts';

const repo = path.resolve(import.meta.dirname, '..', '..');
const temp = mkdtempSync(path.join(os.tmpdir(), 'atm-root-drop-invalid-base-'));
const base = path.join(temp, 'base');
const target = path.join(temp, 'target');
const preparedPaths = ['packages/cli/dist/atm-public.js', 'packages/cli/dist/npm-runtime/manifest.json', 'packages/cli/dist/npm-runtime/runtime.mjs'];
const preparedBytes = preparedPaths.map(relative => readFileSync(path.join(repo, relative)));

try {
  // Inventory tamper detection uses fixed prepared inputs, not a shared rebuild.
  buildRootDropRelease({ repositoryRoot: repo, releaseRoot: base, packageDistReady: true });
  const manifestPath = path.join(base, 'release-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.sealedSourceCommit = 'base-source';
  manifest.artifactInventory.entries[0].digest = 'sha256:tampered';
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.equal(hydrateVerifiedRootDropBase({
    sourceReleaseRoot: base,
    targetReleaseRoot: target,
    previousSealedSourceSha: 'base-source',
    removeTree: (entry) => rmSync(entry, { recursive: true, force: true })
  }), false, 'tampered inventory must never hydrate');

  const result = buildRootDropRelease({
    repositoryRoot: repo,
    packageDistReady: true,
    releaseRoot: base,
    overlayChangedPaths: ['README.md'],
    previousSealedSourceSha: 'base-source'
  });
  const fallback = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
  assert.equal(fallback.buildMode, 'full');
  assert.equal(fallback.overlayFallbackReason, 'base-release-ineligible');
  console.log('ok: invalid root-drop base fails closed to full assembly');
} finally {
  rmSync(temp, { recursive: true, force: true });
  preparedPaths.forEach((relative, index) => assert.deepEqual(readFileSync(path.join(repo, relative)), preparedBytes[index], `must not mutate prepared input: ${relative}`));
}

