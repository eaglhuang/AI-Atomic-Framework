import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRootDropRelease } from './build-root-drop-release.ts';
import { buildOnefileRelease } from './build-onefile-release.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[runner-reproducibility:${mode}] ${message}`);
  }
}

function sha256(filePath: string) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function buildPair(tempRoot: string, label: string) {
  const rootDropRoot = path.join(tempRoot, label, 'atm-root-drop');
  const onefileRoot = path.join(tempRoot, label, 'atm-onefile');
  buildRootDropRelease({ repositoryRoot: root, releaseRoot: rootDropRoot });
  buildOnefileRelease({ repositoryRoot: root, rootDropRoot, outputRoot: onefileRoot });
  return {
    rootDropManifest: path.join(rootDropRoot, 'release-manifest.json'),
    onefileManifest: path.join(onefileRoot, 'release-manifest.json'),
    onefileRunner: path.join(onefileRoot, 'atm.mjs')
  };
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-repro-'));
try {
  const first = buildPair(tempRoot, 'first');
  const second = buildPair(tempRoot, 'second');
  for (const filePath of [
    first.rootDropManifest,
    first.onefileManifest,
    first.onefileRunner,
    second.rootDropManifest,
    second.onefileManifest,
    second.onefileRunner
  ]) {
    assert(existsSync(filePath), `expected build artifact missing: ${filePath}`);
  }

  const firstRootDrop = readJson(first.rootDropManifest);
  const firstOnefile = readJson(first.onefileManifest);
  assert(firstRootDrop.generatedAt === '1970-01-01T00:00:00.000Z', 'root-drop manifest generatedAt must be deterministic by default');
  assert(firstOnefile.generatedAt === '1970-01-01T00:00:00.000Z', 'onefile manifest generatedAt must be deterministic by default');

  const comparisons = [
    ['release/atm-root-drop/release-manifest.json', first.rootDropManifest, second.rootDropManifest],
    ['release/atm-onefile/release-manifest.json', first.onefileManifest, second.onefileManifest],
    ['release/atm-onefile/atm.mjs', first.onefileRunner, second.onefileRunner]
  ] as const;
  for (const [label, left, right] of comparisons) {
    assert(sha256(left) === sha256(right), `${label} must be byte-identical across consecutive builds`);
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`[runner-reproducibility:${mode}] ok (runner artifacts are byte-identical across consecutive builds)`);
