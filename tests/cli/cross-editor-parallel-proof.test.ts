import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  evaluateHardCausalAdmission
} from '../../scripts/audit-task-dependency-semantics.ts';
import {
  NEGATIVE_CONTROL_FACTS,
  compileParallelProof,
  createHarnessTwoEditorIntervals,
  evaluateScopedAcc3,
  maxConcurrency,
  maxDistinctConcurrency,
  overlapMs,
  requiredOverlapMs,
  scopedIntervalsFromEvents,
  unionDurationMs
} from '../../scripts/compile-cross-editor-parallel-proof.ts';
import { resolvePlanningRoot, sealWithoutDigest } from '../../scripts/audit-task-dependency-semantics.ts';
import type { TaskEvent } from '../../scripts/validate-cross-editor-parallel-proof.ts';

const editors = new Map<string, string>([
  ['cursor-captain', 'cursor'],
  ['claude-captain', 'claude-code']
]);

const claimOnly: TaskEvent[] = [
  { action: 'claim', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-22T00:00:00.000Z' },
  { action: 'claim', actorId: 'claude-captain', taskId: 'ATM-GOV-0406', createdAt: '2026-08-22T00:00:00.000Z' }
];
assert.equal(scopedIntervalsFromEvents(claimOnly, editors).length, 0);
assert.equal(evaluateScopedAcc3([]).status, 'unproven');

const shortIdle: TaskEvent[] = [
  ...claimOnly,
  { action: 'scope-amendment', actorId: 'claude-captain', taskId: 'ATM-GOV-0406', createdAt: '2026-08-22T01:00:00.000Z', endedAt: '2026-08-22T01:00:05.000Z' },
  { action: 'evidence-run', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-22T10:00:00.000Z', endedAt: '2026-08-22T10:00:02.000Z' }
];
const shortScoped = scopedIntervalsFromEvents(shortIdle, editors);
assert.ok(unionDurationMs(shortScoped) < 60_000);
assert.equal(evaluateScopedAcc3(shortScoped).status, 'unproven');
assert.equal(evaluateScopedAcc3(shortScoped).overlapMs, 0);

const overlapping: TaskEvent[] = [
  { action: 'claim', actorId: 'claude-captain', taskId: 'ATM-GOV-0406', createdAt: '2026-08-22T15:00:00.000Z' },
  { action: 'claim', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-22T15:00:00.000Z' },
  { action: 'scope-amendment', actorId: 'claude-captain', taskId: 'ATM-GOV-0406', createdAt: '2026-08-22T15:10:00.000Z' },
  { action: 'evidence-run', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-22T15:12:00.000Z', endedAt: '2026-08-22T15:12:01.000Z' },
  { action: 'commit', actorId: 'claude-captain', taskId: 'ATM-GOV-0406', createdAt: '2026-08-22T15:40:00.000Z' },
  { action: 'commit', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-22T15:45:00.000Z' }
];
const overlapped = scopedIntervalsFromEvents(overlapping, editors);
const overlappedAcc3 = evaluateScopedAcc3(overlapped);
assert.equal(overlappedAcc3.status, 'met');
assert.ok(overlappedAcc3.overlapMs > 0);
assert.ok(overlappedAcc3.overlapMs < 40 * 60 * 1000);
assert.equal(overlapped.find((interval) => interval.actorId === 'cursor-captain')?.endedAt, '2026-08-22T15:45:00.000Z');

const duplicateSessions: TaskEvent[] = [
  { action: 'claim', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-22T15:00:00.000Z' },
  { action: 'evidence-run', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-22T15:10:00.000Z', endedAt: '2026-08-22T15:20:00.000Z', source: 'session-a' },
  { action: 'evidence-run', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-22T15:12:00.000Z', endedAt: '2026-08-22T15:18:00.000Z', source: 'session-b' },
  { action: 'commit', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-22T15:25:00.000Z' }
];
const duplicateScoped = scopedIntervalsFromEvents(duplicateSessions, editors);
assert.equal(maxDistinctConcurrency(duplicateScoped, 'editor'), 1);
assert.equal(maxDistinctConcurrency(duplicateScoped, 'actorId'), 1);

const harness = createHarnessTwoEditorIntervals('2026-08-22T15:55:01.258Z');
const now = harness[1].endedAt ?? '2026-08-22T16:20:01.258Z';
const overlap = overlapMs(harness[0], harness[1], now);
const shorter = Math.min(
  Date.parse(harness[0].endedAt ?? now) - Date.parse(harness[0].startedAt),
  Date.parse(harness[1].endedAt ?? now) - Date.parse(harness[1].startedAt)
);
assert.equal(harness[0].editor, 'claude-code');
assert.equal(harness[1].editor, 'cursor');
assert.notEqual(harness[0].actorId, harness[1].actorId);
assert.ok(maxConcurrency(harness, now) >= 2);
assert.ok(overlap >= requiredOverlapMs(shorter));
assert.ok(overlap >= Math.min(15 * 60 * 1000, Math.floor(shorter * 0.25)));

const before = evaluateHardCausalAdmission(NEGATIVE_CONTROL_FACTS, false);
const after = evaluateHardCausalAdmission({ ...NEGATIVE_CONTROL_FACTS, producerOutputAvailable: true }, true);
assert.equal(before.claim, 'blocked');
assert.equal(after.claim, 'allowed');

const proof = compileParallelProof({
  targetRoot: resolve('.'),
  planningRoot: resolvePlanningRoot(),
  generatedAt: '2026-08-22T16:00:00.000Z'
});
assert.equal(proof.schemaId, 'atm.crossEditorParallelProof.v1');
assert.equal(proof.digest, sealWithoutDigest(proof));
assert.ok(proof.timeWindow.watermark);
assert.equal(proof.safetyEvents.unauthorizedTakeover, 0);
assert.equal(proof.safetyEvents.bypass, 0);
assert.ok(proof.safetyEvents.policyViolationCount >= 1);
assert.equal(proof.proposals.length, 0);
assert.ok(!JSON.stringify(proof).includes('prop-0407-shared-dashboard-surface'));
assert.ok(!JSON.stringify(proof).includes('execute-now-on-0407-private-report-surface'));
assert.ok(proof.broker.arbitration === 'broker-arbitration' || proof.acceptance.acc4.status === 'unproven');
if (proof.broker.arbitration === 'broker-arbitration') {
  assert.equal(proof.acceptance.acc4.status, 'met');
  assert.equal(proof.broker.source.schemaId, 'atm.teamRun.v1');
  assert.equal(proof.broker.source.taskId, 'ATM-GOV-0407');
  assert.equal(proof.broker.source.verdict, 'parallel-safe');
  assert.equal(proof.broker.source.lane, 'direct-brokered');
  assert.ok(proof.broker.source.digest);
  assert.equal(proof.compose.outcome, 'final-compose');
}
const missing = compileParallelProof({
  targetRoot: resolve('.'),
  planningRoot: resolvePlanningRoot(),
  generatedAt: '2026-08-22T16:00:00.000Z',
  arbitrationPath: '.atm/runtime/team-runs/missing-0407-arbitration.json'
});
assert.equal(missing.acceptance.acc4.status, 'unproven');
assert.equal(missing.broker.arbitration, 'unproven');
assert.ok(missing.broker.source.issues.includes('arbitration artifact missing'));
const first = proof.proofWindows.find((window) => window.id === 'first-window');
const second = proof.proofWindows.find((window) => window.id === 'second-window');
assert.equal(first?.policyViolationCount, 1);
assert.equal(first?.foreignByteLoss, 0);
assert.equal(first?.cleanProofWindow, false);
assert.equal(second?.source, 'task-events-0406-0407-scan');
assert.equal(proof.lifecycle.frozenPublication.status, 'not-started');
assert.equal(proof.lifecycle.formalCloseout.status, 'not-started');
assert.equal(proof.hardCausalControls.nonHardClaimBeforeCompose, 'allowed');
assert.equal(proof.acceptance.acc5.status, 'met');
assert.equal(proof.overlap.basis, 'scoped-work');
assert.ok(!proof.intervals.some((interval) => String(interval.source).includes('harness')));
assert.ok(!proof.acceptance.acc3.detail.includes('harness'));
assert.notEqual(proof.acceptance.acc3.status, 'met');
assert.equal(evaluateScopedAcc3(harness).status, 'met');
assert.ok(Array.isArray(proof.claimIntervals));
assert.ok(typeof proof.concurrency.maxScopedWork === 'number');
assert.ok(proof.concurrency.maxActiveClaims >= proof.concurrency.maxScopedWork || proof.concurrency.maxActiveClaims >= 1);

const regenerated = compileParallelProof({
  targetRoot: resolve('.'),
  planningRoot: resolvePlanningRoot(),
  generatedAt: '2026-08-22T16:00:00.000Z'
});
assert.equal(regenerated.digest, proof.digest);

console.log('[cross-editor-parallel-proof.test] ok');
console.log(JSON.stringify({
  overlapMs: proof.overlap.overlapMs,
  overlapRatio: proof.overlap.overlapRatio,
  maxActiveClaims: proof.concurrency.maxActiveClaims,
  maxScopedWork: proof.concurrency.maxScopedWork,
  acc3: proof.acceptance.acc3.status,
  acc4: proof.acceptance.acc4.status,
  digest: proof.digest,
  sourceSha: proof.lifecycle.sourceDelivery.sha
}));
