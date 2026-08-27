import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  evaluateHardCausalAdmission,
  resolvePlanningRoot,
  sealWithoutDigest
} from '../../scripts/audit-task-dependency-semantics.ts';
import {
  NEGATIVE_CONTROL_FACTS,
  PRODUCT_PROOF_WINDOW_ENDED_AT,
  PRODUCT_PROOF_WINDOW_STARTED_AT,
  compileParallelProof,
  createHarnessTwoEditorIntervals,
  clipIntervalToWindow,
  commandRunIntervalsFromEvents,
  evaluateProductProofAcc3,
  evaluateScopedAcc3,
  maxConcurrency,
  maxDistinctConcurrency,
  overlapMs,
  requiredOverlapMs,
  scopedIntervalsFromEvents,
  unionDurationMs
} from '../../scripts/compile-cross-editor-parallel-proof.ts';
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

const windowedHistorical: TaskEvent[] = [
  { action: 'claim', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-22T15:55:01.000Z' },
  { action: 'evidence-run', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-22T16:03:10.000Z', endedAt: '2026-08-22T16:11:04.000Z', command: 'historical' },
  { action: 'evidence-run', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-23T07:10:35.024Z', endedAt: '2026-08-23T07:10:36.024Z', command: 'current-cursor' },
  { action: 'evidence-run', actorId: 'claude-captain', taskId: 'ATM-GOV-0406', createdAt: '2026-08-23T07:10:35.524Z', endedAt: '2026-08-23T07:10:36.524Z', command: 'current-claude' }
];
const windowedRuns = commandRunIntervalsFromEvents(windowedHistorical, editors);
const windowedAcc3 = evaluateProductProofAcc3(windowedRuns);
assert.ok(windowedAcc3.shorterIntervalMs < 5_000);
assert.ok(windowedAcc3.shorterIntervalMs < Date.parse('2026-08-22T16:11:04.000Z') - Date.parse('2026-08-22T16:03:10.000Z'));
assert.equal(windowedAcc3.status, 'met');

const gapped: TaskEvent[] = [
  { action: 'evidence-run', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-23T07:10:35.024Z', endedAt: '2026-08-23T07:10:36.024Z' },
  { action: 'evidence-run', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-23T07:12:00.000Z', endedAt: '2026-08-23T07:12:01.000Z' }
];
assert.equal(unionDurationMs(commandRunIntervalsFromEvents(gapped, editors)), 2_000);

const failedRun: TaskEvent[] = [
  { action: 'evidence-run', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-23T07:11:00.000Z', endedAt: '2026-08-23T07:12:00.000Z', command: 'npm test', exitCode: 1 },
  { action: 'evidence-run', actorId: 'claude-captain', taskId: 'ATM-GOV-0406', createdAt: '2026-08-23T07:11:10.000Z', endedAt: '2026-08-23T07:11:50.000Z', command: 'npm test', exitCode: 1 }
];
const failedIntervals = commandRunIntervalsFromEvents(failedRun, editors);
assert.equal(failedIntervals[0]?.exitCode, 1);
assert.ok(unionDurationMs(failedIntervals) >= 40_000);
assert.equal(evaluateProductProofAcc3(failedIntervals).status, 'met');

const overlappingUnion: TaskEvent[] = [
  { action: 'evidence-run', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-23T07:11:00.000Z', endedAt: '2026-08-23T07:11:20.000Z' },
  { action: 'evidence-run', actorId: 'cursor-captain', taskId: 'ATM-GOV-0407', createdAt: '2026-08-23T07:11:05.000Z', endedAt: '2026-08-23T07:11:15.000Z' }
];
assert.equal(unionDurationMs(commandRunIntervalsFromEvents(overlappingUnion, editors)), 20_000);

const claimsDoNotChangeScoped = commandRunIntervalsFromEvents([
  ...claimOnly,
  ...failedRun
], editors);
assert.equal(claimsDoNotChangeScoped.length, 2);
assert.equal(clipIntervalToWindow({
  taskId: 'ATM-GOV-0407',
  actorId: 'cursor-captain',
  editor: 'cursor',
  startedAt: '2026-08-22T16:03:10.000Z',
  endedAt: '2026-08-22T16:11:04.000Z',
  source: 'historical'
}, PRODUCT_PROOF_WINDOW_STARTED_AT, PRODUCT_PROOF_WINDOW_ENDED_AT), null);

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
assert.equal(proof.productProofWindow.startedAt, PRODUCT_PROOF_WINDOW_STARTED_AT);
assert.equal(proof.productProofWindow.endedAt, PRODUCT_PROOF_WINDOW_ENDED_AT);
assert.ok(proof.overlap.shorterIntervalMs < Date.parse(PRODUCT_PROOF_WINDOW_ENDED_AT) - Date.parse(PRODUCT_PROOF_WINDOW_STARTED_AT));
assert.equal(proof.acceptance.acc3.status, proof.overlap.overlapMs >= proof.overlap.requiredMs ? 'met' : 'unproven');
assert.ok(proof.validatorOutcomes.some((outcome) => outcome.command === 'npm test' && outcome.exitCode === 1));
assert.ok(proof.publicationBlockers.some((blocker) => /P1/.test(blocker.reason)));
assert.ok(/npm test failure/i.test(proof.acceptance.acc6.detail));
assert.equal(evaluateScopedAcc3(harness).status, 'met');
assert.ok(Array.isArray(proof.claimIntervals));
assert.ok(typeof proof.concurrency.maxScopedWork === 'number');
assert.ok(proof.concurrency.maxActiveClaims >= 1);

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
