import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { materializeStableOnefileMeasurementArtifact } from '../../scripts/validate-next-warm-run-latency.ts';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-next-warm-measurement-test-'));
try {
  const sourceFilePath = path.join(tempRoot, 'fresh', 'atm.mjs');
  const stableRoot = path.join(tempRoot, 'stable');
  mkdirSync(path.dirname(sourceFilePath), { recursive: true });
  writeFileSync(sourceFilePath, 'export const version = 1;\n', { encoding: 'utf8', flag: 'w' });

  const first = materializeStableOnefileMeasurementArtifact(sourceFilePath, stableRoot);
  assert.equal(first.reused, false);
  assert.equal(readFileSync(first.outputFilePath, 'utf8'), 'export const version = 1;\n');

  const second = materializeStableOnefileMeasurementArtifact(sourceFilePath, stableRoot);
  assert.equal(second.reused, true);
  assert.equal(second.outputFilePath, first.outputFilePath);
  assert.equal(second.artifactKey, first.artifactKey);

  writeFileSync(sourceFilePath, 'export const version = 2;\n', { encoding: 'utf8', flag: 'w' });
  const changed = materializeStableOnefileMeasurementArtifact(sourceFilePath, stableRoot);
  assert.equal(changed.reused, false);
  assert.notEqual(changed.artifactKey, first.artifactKey);
  assert.notEqual(changed.outputFilePath, first.outputFilePath);
  assert.equal(readFileSync(changed.outputFilePath, 'utf8'), 'export const version = 2;\n');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[next-warm-run-latency-measurement.test] ok');
