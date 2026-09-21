import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { buildRootDropRelease, hydrateVerifiedRootDropBase } from '../../scripts/build-root-drop-release.ts';

const repo = path.resolve(import.meta.dirname, '..', '..');
const temp = mkdtempSync(path.join(os.tmpdir(), 'atm-root-drop-overlay-'));
const base = path.join(temp, 'base');
const overlay = path.join(temp, 'overlay');

try {
  buildRootDropRelease({ repositoryRoot: repo, releaseRoot: base });
  const manifestPath = path.join(base, 'release-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.sealedSourceCommit = 'base-source';
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.equal(hydrateVerifiedRootDropBase({
    sourceReleaseRoot: base,
    targetReleaseRoot: overlay,
    previousSealedSourceSha: 'base-source',
    removeTree: (target) => rmSync(target, { recursive: true, force: true })
  }), true, 'only a verified inventory may be hydrated');

  // Model a valid previous release that predates one current source member.
  // The overlay list intentionally does not name README.md, so the builder
  // must materialize a missing target instead of hashing a non-existent file.
  const missingCurrentSource = 'README.md';
  const missingCurrentTarget = path.join(overlay, missingCurrentSource);
  unlinkSync(missingCurrentTarget);
  const overlayManifestPath = path.join(overlay, 'release-manifest.json');
  const overlayManifest = JSON.parse(readFileSync(overlayManifestPath, 'utf8'));
  overlayManifest.artifactInventory.entries = overlayManifest.artifactInventory.entries
    .filter((entry: { path: string }) => entry.path !== missingCurrentSource);
  const inventoryHash = createHash('sha256');
  for (const entry of [...overlayManifest.artifactInventory.entries].sort((left: { path: string }, right: { path: string }) => left.path.localeCompare(right.path))) {
    inventoryHash.update(`${entry.path}\0${entry.digest}\n`);
  }
  overlayManifest.artifactInventory.treeDigest = `sha256:${inventoryHash.digest('hex')}`;
  writeFileSync(overlayManifestPath, `${JSON.stringify(overlayManifest, null, 2)}\n`);
  const obsoletePath = path.join(overlay, 'packages', 'cli', 'deleted-from-current-input.txt');
  writeFileSync(obsoletePath, 'obsolete\n');

  const result = buildRootDropRelease({
    repositoryRoot: repo,
    releaseRoot: overlay,
    overlayChangedPaths: ['README.md'],
    previousSealedSourceSha: 'base-source'
  });
  const overlaid = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
  const rebuilt = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(overlaid.buildMode, 'overlay');
  assert.equal(overlaid.artifactInventory.treeDigest, rebuilt.artifactInventory.treeDigest);
  assert.ok(overlaid.copyReport.copied < rebuilt.copyReport.copied, 'overlay must not recopy the complete base');
  assert.equal(existsSync(obsoletePath), false, 'overlay must tombstone obsolete base entries');
  assert.equal(existsSync(missingCurrentTarget), true, 'overlay must materialize a current source file absent from the verified base');
  console.log('ok: verified base root-drop overlay is equivalent and narrower than full assembly');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
