import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runFrozenParallelReplay } from '../../packages/cli/src/commands/broker/replay/implementation.ts';
import {
  compileHostileDogfood,
  compileHostileDogfoodSaturation
} from '../../packages/core/src/evidence/hostile-dogfood.ts';
import { buildParallelReplayTelemetryProof } from '../../packages/core/src/telemetry/parallel-replay/index.ts';

const report = JSON.parse(readFileSync('docs/reports/plan4-hostile-dogfood-saturation.json', 'utf8')) as {
  readonly schemaId: string;
  readonly taskId: string;
  readonly hostileBranches: readonly {
    readonly condition: string;
    readonly overrideLeaseUsed: boolean;
    readonly rollbackPreserved: boolean;
    readonly canonicalWorktreeIntact: boolean;
  }[];
  readonly pairedExperiments: readonly {
    readonly label: 'AA' | 'AB' | 'BA';
    readonly sampleCount: number;
    readonly correctnessPass: boolean;
    readonly queueWaitMs: number;
    readonly rollbackPreserved: boolean;
  }[];
  readonly incidentFamilies: readonly {
    readonly family: string;
    readonly recurrenceCount: number;
    readonly disposition: 'known-covered' | 'new-backlog-required' | 'unknown';
  }[];
  readonly stoppingRule: {
    readonly minimumSamplesPerArm: number;
    readonly maximumUnknownFamilies: number;
  };
};

assert.equal(report.schemaId, 'atm.hostileDogfoodSaturationReport.v1');
assert.equal(report.taskId, 'ATM-GOV-0339');
assert.equal(report.hostileBranches.length >= 4, true);
assert.deepEqual(new Set(report.pairedExperiments.map((entry) => entry.label)), new Set(['AA', 'AB', 'BA']));

const replayEvidence = await runFrozenParallelReplay({ cwd: process.cwd(), workerCount: 3 });
const replayProof = buildParallelReplayTelemetryProof(replayEvidence);

const hostile = compileHostileDogfood({
  sealedReceiptDigest: replayEvidence.digest,
  minimumIndependentLanes: 2,
  requiredConditions: report.hostileBranches.map((entry) => entry.condition),
  lanes: replayEvidence.workerReceipts.slice(0, 2).map((receipt) => ({
    laneId: receipt.workerId,
    actorId: receipt.actorId,
    receiptDigest: receipt.stdoutDigest,
    sealed: true
  })),
  conditions: report.hostileBranches.map((entry) => ({
    condition: entry.condition,
    outcome: 'recovered',
    overrideLeaseUsed: entry.overrideLeaseUsed,
    rollbackPreserved: entry.rollbackPreserved,
    canonicalWorktreeIntact: entry.canonicalWorktreeIntact
  }))
});

assert.equal(replayEvidence.schemaId, 'atm.parallelReplayEvidence.v1');
assert.equal(replayEvidence.verdict, 'pass');
assert.equal(replayProof.correctness.escapedConflictCount, 0);
assert.equal(replayProof.correctness.silentOverwriteCount, 0);
assert.equal(replayProof.breaker.timeInQueueOnlyRatio, 0);
assert.equal(hostile.status, 'proven');
assert.equal(hostile.rollbackPreserved, true);
assert.equal(hostile.canonicalWorktreeIntact, true);

const saturation = compileHostileDogfoodSaturation({
  taskId: report.taskId,
  hostile,
  replayProof,
  pairedExperiments: report.pairedExperiments,
  incidentFamilies: report.incidentFamilies,
  stoppingRule: report.stoppingRule
});

assert.equal(saturation.schemaId, 'atm.hostileDogfoodSaturation.v1');
assert.equal(saturation.verdict, 'pass');
assert.equal(saturation.pairedExperimentSummary.aaSamples, 2);
assert.equal(saturation.pairedExperimentSummary.abSamples, 2);
assert.equal(saturation.pairedExperimentSummary.baSamples, 2);
assert.equal(saturation.incidentFamilySummary.unknownDispositionCount, 0);
assert.match(saturation.digest, /^sha256:[a-f0-9]{64}$/);

const borrowedIdentity = compileHostileDogfood({
  sealedReceiptDigest: replayEvidence.digest,
  minimumIndependentLanes: 2,
  requiredConditions: ['provenance-mismatch'],
  lanes: [
    { laneId: 'borrowed-lane-a', actorId: 'same-actor', receiptDigest: replayEvidence.digest, sealed: true },
    { laneId: 'borrowed-lane-b', actorId: 'same-actor', receiptDigest: replayEvidence.digest, sealed: true }
  ],
  conditions: [
    {
      condition: 'provenance-mismatch',
      outcome: 'recovered',
      overrideLeaseUsed: false,
      rollbackPreserved: true,
      canonicalWorktreeIntact: true
    }
  ]
});
assert.equal(borrowedIdentity.status, 'blocked');
assert.equal(borrowedIdentity.diagnostics.includes('lane-actor-not-independent:same-actor'), true);

const emergencyOverride = compileHostileDogfood({
  sealedReceiptDigest: replayEvidence.digest,
  minimumIndependentLanes: 2,
  requiredConditions: ['shared-index'],
  lanes: replayEvidence.workerReceipts.slice(0, 2).map((receipt) => ({
    laneId: receipt.workerId,
    actorId: receipt.actorId,
    receiptDigest: receipt.stdoutDigest,
    sealed: true
  })),
  conditions: [
    {
      condition: 'shared-index',
      outcome: 'recovered',
      overrideLeaseUsed: true,
      rollbackPreserved: true,
      canonicalWorktreeIntact: true
    }
  ]
});
assert.equal(emergencyOverride.status, 'blocked');
assert.equal(emergencyOverride.diagnostics.includes('override-lease-forbidden:shared-index'), true);

console.log('[plan4-hostile-dual-captain.test] ok');
