import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCommandBackedCells, runPairedAbV4 } from '../../scripts/run-paired-ab-v4.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'atm-paired-ab-v4-'));

try {
  process.chdir(root);
  const cells = await buildCommandBackedCells();
  assert.equal(cells.length, 70);
  assert.equal(new Set(cells.map((cell) => cell.scale)).size, 7);
  assert.equal(new Set(cells.map((cell) => cell.contention)).size, 5);
  assert.equal(cells.every((cell) => cell.abRepeats.length === 3), true);
  assert.equal(cells.every((cell) => cell.baRepeats.length === 3), true);
  assert.equal(cells.every((cell) => cell.negativeControl.rejectedBeforeCanonicalWrite), true);

  const summary = await runPairedAbV4({ mode: 'generate' });
  assert.equal(summary.cellCount, 70);
  assert.equal(summary.acceptedCellCount, 70);
  assert.ok(summary.metrics.medianMakespanImprovementPct >= 25);
  assert.ok(summary.metrics.medianMakespanImprovementPct > summary.metrics.aaNoiseBoundPct);
  assert.ok(summary.metrics.activeThroughputImprovementPct >= 25);
  assert.ok(summary.metrics.productionCostRatio <= 1.10);
  assert.equal(summary.metrics.coveragePct, 100);
  assert.equal(summary.sideEffectCounts.silentOverwrite, 0);
  assert.equal(summary.sideEffectCounts.escapedConflict, 0);
  assert.equal(summary.sideEffectCounts.duplicateSideEffect, 0);
  assert.equal(summary.sideEffectCounts.unresolvedStarvation, 0);
  assert.equal(summary.correctness.negativeControlRejectedBeforeCanonicalWrite, true);
  assert.equal(summary.correctness.canonicalWriteParallelismClaim, 'serialized-steward-tail-only');
  assert.equal(summary.verdict, 'pass');
} finally {
  process.chdir(root);
  rmSync(tmp, { recursive: true, force: true });
}

console.log('paired-ab-v4 safety controller ok');
