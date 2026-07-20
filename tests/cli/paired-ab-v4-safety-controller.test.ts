import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyParallelAdmissionSafetyDecision,
  defaultParallelAdmissionPolicy,
  evaluateParallelAdmissionSafety
} from '../../packages/core/src/broker/parallel-admission-policy.ts';
import type { ParallelAdmissionSafetyMetrics } from '../../packages/core/src/broker/parallel-admission-policy.ts';
import { buildCells, runPairedAbV4 } from '../../scripts/run-paired-ab-v4.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'atm-paired-ab-v4-'));

try {
  process.chdir(root);
  const cells = buildCells();
  assert.equal(cells.length, 420);
  assert.equal(new Set(cells.map((cell) => cell.arm)).size, 4);
  assert.equal(new Set(cells.map((cell) => cell.scale)).size, 7);
  assert.equal(new Set(cells.map((cell) => cell.contention)).size, 5);
  assert.equal(new Set(cells.map((cell) => cell.repeat)).size, 3);

  const summary = await runPairedAbV4({ mode: 'generate' });
  assert.equal(summary.cellCount, 420);
  assert.ok(summary.metrics.medianMakespanImprovementPct >= 25);
  assert.ok(summary.metrics.activeThroughputImprovementPct >= 25);
  assert.ok(summary.metrics.productionCostRatio <= 1.10);
  assert.equal(summary.metrics.coveragePct, 100);
  assert.equal(summary.sideEffectCounts.silentOverwrite, 0);
  assert.equal(summary.sideEffectCounts.escapedConflict, 0);
  assert.equal(summary.sideEffectCounts.duplicateSideEffect, 0);
  assert.equal(summary.sideEffectCounts.unresolvedStarvation, 0);
  assert.ok(summary.taskSummary.window);
  assert.ok(summary.taskSummary.watermark);
  assert.ok(summary.taskSummary.sealedDigest.startsWith('sha256:'));
  assert.equal(summary.safetyController.verdict, 'pass');
  assert.equal(summary.safetyController.resetEligible, true);

  const passingMetrics: ParallelAdmissionSafetyMetrics = {
    schemaId: 'atm.parallelAdmissionSafetyMetrics.v1',
    taskId: 'ATM-GOV-0224',
    cellCount: summary.cellCount,
    requiredCellCount: summary.requiredCellCount,
    medianMakespanImprovementPct: summary.metrics.medianMakespanImprovementPct,
    activeThroughputImprovementPct: summary.metrics.activeThroughputImprovementPct,
    productionCostRatio: summary.metrics.productionCostRatio,
    coveragePct: summary.metrics.coveragePct,
    sideEffectCounts: summary.sideEffectCounts,
    taskSummary: summary.taskSummary
  };
  const passingDecision = evaluateParallelAdmissionSafety(passingMetrics);
  assert.equal(passingDecision.verdict, 'pass');
  assert.equal(passingDecision.resetEligible, true);

  const tripped = applyParallelAdmissionSafetyDecision(defaultParallelAdmissionPolicy(), {
    actorId: 'tester',
    metrics: { ...passingMetrics, sideEffectCounts: { ...passingMetrics.sideEffectCounts, escapedConflict: 1 } },
    now: '2026-07-20T18:30:00.000Z'
  });
  assert.equal(tripped.tripped, true);
  assert.equal(tripped.fallbackMode, 'queue-only');
  assert.match(tripped.tripReason ?? '', /escaped conflict/);

  const reset = applyParallelAdmissionSafetyDecision(tripped, {
    actorId: 'tester',
    metrics: passingMetrics,
    now: '2026-07-20T18:31:00.000Z'
  });
  assert.equal(reset.tripped, false);
  assert.ok(reset.resetEvidenceDigest?.startsWith('sha256:'));
  assert.equal(reset.resetAt, '2026-07-20T18:31:00.000Z');
} finally {
  process.chdir(root);
  rmSync(tmp, { recursive: true, force: true });
}

console.log('paired-ab-v4 safety controller ok');
