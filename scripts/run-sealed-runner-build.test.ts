import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncGeneratedArtifacts } from './run-sealed-runner-build.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-sealed-sync-'));
const source = path.join(root, 'source');
const target = path.join(root, 'target');
const artifact = 'release/atm-onefile/atm.mjs';

try {
  mkdirSync(path.dirname(path.join(source, artifact)), { recursive: true });
  mkdirSync(path.dirname(path.join(target, artifact)), { recursive: true });
  writeFileSync(path.join(source, artifact), 'sealed build bytes\n');
  writeFileSync(path.join(target, artifact), 'foreign dirty bytes\n');

  const result = syncGeneratedArtifacts(source, target, 'onefile', [artifact]);
  assert.deepEqual(result.preservedPaths, [artifact]);
  assert.equal(readFileSync(path.join(target, artifact), 'utf8'), 'foreign dirty bytes\n');
  console.log('[sealed-runner-build] preserves pre-existing generated WIP');
} finally {
  rmSync(root, { recursive: true, force: true });
}
