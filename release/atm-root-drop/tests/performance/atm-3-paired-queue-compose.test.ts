import assert from 'node:assert/strict';
import { buildCommandBackedCells, runPairedAbV4 } from '../../scripts/run-paired-ab-v4.ts';

const cells = await buildCommandBackedCells();
assert.equal(cells.length, 70);
assert.equal(cells.every((cell) => cell.abRepeats.length === 3), true);
assert.equal(cells.every((cell) => cell.baRepeats.length === 3), true);
assert.equal(cells.every((cell) => cell.aaNullControl.length === 3), true);
assert.equal(cells.every((cell) => cell.negativeControl.rejectedBeforeCanonicalWrite), true);
assert.equal(cells.every((cell) => cell.abRepeats.every((run) => run.commandReceipts.length === 2)), true);
assert.equal(cells.every((cell) => cell.abRepeats.every((run) => run.timing.sharedCommitMs > 0 && run.timing.stewardApplyMs > 0)), true);

const workloadDigests = new Set(cells.flatMap((cell) => [
  ...cell.abRepeats.flatMap((run) => run.commandReceipts.map((receipt) => receipt.workloadDigest)),
  ...cell.baRepeats.flatMap((run) => run.commandReceipts.map((receipt) => receipt.workloadDigest))
]));
assert.equal(workloadDigests.size > 10, true);

const summary = await runPairedAbV4({ mode: 'command-backed' });
assert.equal(summary.taskId, 'ATM-GOV-0243');
assert.equal(summary.verdict, 'pass');
assert.equal(summary.acceptedCellCount, 70);
assert.equal(summary.metrics.medianMakespanImprovementPct > summary.metrics.aaNoiseBoundPct, true);
assert.equal(summary.correctness.canonicalWriteParallelismClaim, 'serialized-steward-tail-only');

console.log('[atm-3-paired-queue-compose.test] ok');
