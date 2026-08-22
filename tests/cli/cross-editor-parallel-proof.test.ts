import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  evaluateHardCausalAdmission
} from '../../scripts/audit-task-dependency-semantics.ts';
import {
  NEGATIVE_CONTROL_FACTS,
  compileParallelProof,
  createHarnessTwoEditorIntervals,
  maxConcurrency,
  overlapMs,
  requiredOverlapMs
} from '../../scripts/compile-cross-editor-parallel-proof.ts';
import { resolvePlanningRoot, sealWithoutDigest } from '../../scripts/audit-task-dependency-semantics.ts';

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
assert.equal(proof.safetyEvents.foreignOverwrite, 0);
assert.equal(proof.safetyEvents.unauthorizedTakeover, 0);
assert.equal(proof.safetyEvents.bypass, 0);
assert.ok(proof.proposals.length >= 1);
assert.equal(proof.broker.arbitration, 'proposal-first');
assert.equal(proof.compose.outcome, 'deferred-final-compose');
assert.equal(proof.lifecycle.frozenPublication.status, 'not-started');
assert.equal(proof.lifecycle.formalCloseout.status, 'not-started');
assert.equal(proof.hardCausalControls.nonHardClaimBeforeCompose, 'allowed');
assert.equal(proof.acceptance.acc5.status, 'met');

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
  maxConcurrency: proof.concurrency.maxActiveClaims,
  digest: proof.digest,
  sourceSha: proof.lifecycle.sourceDelivery.sha
}));
