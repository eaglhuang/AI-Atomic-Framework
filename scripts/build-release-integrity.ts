/**
 * build-release-integrity.ts
 *
 * Computes sha256 digests for key published artefacts and writes
 * `release/integrity.json` alongside the release tarball.  Run during
 * CI after the build step and before `npm publish`.
 *
 * Usage:
 *   node --strip-types scripts/build-release-integrity.ts
 *   node --strip-types scripts/build-release-integrity.ts --dry-run
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Artefacts to hash (paths relative to repo root)
// These are files bundled into the published packages that consumers rely on.
// ---------------------------------------------------------------------------

const TRACKED_ARTEFACTS = [
  'compatibility-matrix.json',
  'compatibility-matrix.legacy.json',
  'known-bad-versions.json',
  'schemas/governance/default-guards.schema.json'
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(content: Buffer | string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function hashFile(relPath: string): string {
  const abs = path.join(root, relPath);
  if (!existsSync(abs)) {
    throw new Error(`[build-release-integrity] Tracked artefact not found: ${relPath}`);
  }
  return sha256Hex(readFileSync(abs));
}

// ---------------------------------------------------------------------------
// Build manifest
// ---------------------------------------------------------------------------

const artefacts = TRACKED_ARTEFACTS.map((relPath) => ({
  path: relPath,
  sha256: hashFile(relPath)
}));

const pkgJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const manifest = {
  schemaVersion: 'atm.releaseIntegrity.v0.1',
  version: pkgJson.version ?? '0.0.0',
  buildAt: new Date().toISOString(),
  artefacts
};

const outDir = path.join(root, 'release');
const outPath = path.join(outDir, 'integrity.json');
const cliDistDir = path.join(root, 'packages', 'cli', 'dist');

if (dryRun) {
  console.log('[build-release-integrity] dry-run — would write:');
  console.log(JSON.stringify(manifest, null, 2));
} else {
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  if (existsSync(cliDistDir)) {
    const packageManifestPath = path.join(cliDistDir, 'release', 'integrity.json');
    mkdirSync(path.dirname(packageManifestPath), { recursive: true });
    writeFileSync(packageManifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    for (const artefact of artefacts) {
      const sourcePath = path.join(root, artefact.path);
      const targetPath = path.join(cliDistDir, artefact.path);
      mkdirSync(path.dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
    }
  }
  console.log(`[build-release-integrity] wrote ${path.relative(root, outPath)}`);
  for (const a of artefacts) {
    console.log(`  ${a.path}  ${a.sha256}`);
  }
}
