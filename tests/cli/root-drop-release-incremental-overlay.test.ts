import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  console.log('ok: verified base root-drop overlay is equivalent and narrower than full assembly');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
