/**
 * startup-integrity.ts
 *
 * Verifies that the bundled `compatibility-matrix.json` matches the
 * sha256 recorded in the co-bundled `release/integrity.json` manifest.
 *
 * Call `checkStartupIntegrity(root)` early in CLI boot.  When
 * `integrity.json` is absent (development installs, pre-release), the
 * function returns `{ ok: true, mode: 'no-manifest' }` so the CLI
 * continues unimpeded.  When the manifest IS present and the hash
 * mismatches, it returns `{ ok: false, ... }` and the caller MUST refuse
 * to proceed (read-only `doctor --trust` sub-mode is the only exception).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface IntegrityArtefact {
  path: string;
  sha256: string;
}

export interface IntegrityManifest {
  schemaVersion: string;
  version: string;
  buildAt: string;
  artefacts: IntegrityArtefact[];
}

export type IntegrityCheckMode =
  | 'no-manifest'
  | 'ok'
  | 'tampered'
  | 'missing-artefact'
  | 'parse-error';

export interface IntegrityCheckResult {
  ok: boolean;
  mode: IntegrityCheckMode;
  version: string | null;
  checks: Array<{
    path: string;
    bundledHash: string | null;
    expectedHash: string;
    match: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

function sha256Hex(content: Buffer | string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * Locate the integrity manifest bundled alongside the CLI package.
 * In production the manifest lives at `<pkg-root>/release/integrity.json`.
 * We search upward from `frameworkRoot` to be resilient to the exact
 * install layout.
 */
function locateManifest(frameworkRoot: string): string | null {
  const candidate = path.join(frameworkRoot, 'release', 'integrity.json');
  if (existsSync(candidate)) return candidate;
  return null;
}

export function resolveBundledIntegrityRoot(): string {
  if (process.env.ATM_RELEASE_TRUST_ROOT) {
    return path.resolve(process.env.ATM_RELEASE_TRUST_ROOT);
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    moduleDir,
    path.resolve(moduleDir, '..'),
    path.resolve(moduleDir, '../..'),
    path.resolve(moduleDir, '../../..')
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'release', 'integrity.json'))) {
      return candidate;
    }
  }

  return path.resolve(moduleDir, '../../..');
}

export function checkStartupIntegrity(frameworkRoot = resolveBundledIntegrityRoot()): IntegrityCheckResult {
  const manifestPath = locateManifest(frameworkRoot);

  if (!manifestPath) {
    return { ok: true, mode: 'no-manifest', version: null, checks: [] };
  }

  let manifest: IntegrityManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as IntegrityManifest;
  } catch {
    return { ok: false, mode: 'parse-error', version: null, checks: [] };
  }

  if (!Array.isArray(manifest.artefacts)) {
    return { ok: false, mode: 'parse-error', version: manifest.version ?? null, checks: [] };
  }

  const checks: IntegrityCheckResult['checks'] = [];
  let anyTampered = false;
  let anyMissing = false;

  for (const entry of manifest.artefacts) {
    const absPath = path.join(frameworkRoot, entry.path);
    if (!existsSync(absPath)) {
      checks.push({ path: entry.path, bundledHash: null, expectedHash: entry.sha256, match: false });
      anyMissing = true;
      continue;
    }
    const bundledHash = sha256Hex(readFileSync(absPath));
    const match = bundledHash === entry.sha256;
    if (!match) anyTampered = true;
    checks.push({ path: entry.path, bundledHash, expectedHash: entry.sha256, match });
  }

  const ok = !anyTampered && !anyMissing;
  const mode: IntegrityCheckMode = anyMissing ? 'missing-artefact' : anyTampered ? 'tampered' : 'ok';

  return { ok, mode, version: manifest.version ?? null, checks };
}
