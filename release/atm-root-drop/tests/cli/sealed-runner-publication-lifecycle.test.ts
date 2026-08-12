import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  publishSealedRunner,
  nextPublicationPhase,
  type PublicationPhase,
  type PublicationRequest,
  type PublicationSnapshot
} from '../../packages/cli/src/commands/framework-development/runner-publication-lifecycle.ts';

/**
 * Sealed runner publication lifecycle: reservation -> build-ready ->
 * built-sealed -> publication-ready -> published -> receipt-archived, with a
 * mandatory queue-head reservation, an idempotent already-published generation,
 * and a canonical receipt. Generic fixture — no incident id/actor/date/path.
 */

const REQUEST: PublicationRequest = {
  authority: { taskId: 'WORK-2', laneSessionId: 'lane-owner-cccccccccc', stewardActorId: 'steward-actor' },
  sealedSourceSha: 'c'.repeat(40),
  surfaces: ['release/atm-root-drop', 'release/atm-onefile/atm.mjs'],
  remoteVisibility: 'remote',
  now: '2026-07-25T00:00:00.000Z'
};

function snapshot(over: Partial<PublicationSnapshot> = {}): PublicationSnapshot {
  return {
    phase: 'prepared',
    sealedSourceSha: REQUEST.sealedSourceSha,
    generation: 3,
    runnerBuildDigest: null,
    manifestDigest: null,
    publicationCommitSha: null,
    publishedGenerations: [],
    archivedReceiptPath: null,
    queueHeadOwned: true,
    ...over
  };
}

// 1. Reservation without queue-head ownership fails closed with the steward code.
const privatePreparation = publishSealedRunner(REQUEST, snapshot({ queueHeadOwned: false }));
assert.equal(privatePreparation.allowed, true);
assert.equal(privatePreparation.action, 'build');

const noPublicationReservation = publishSealedRunner(REQUEST, snapshot({ phase: 'publication-ready', queueHeadOwned: false }));
assert.equal(noPublicationReservation.allowed, false);
assert.equal(noPublicationReservation.errorCode, 'ATM_RUNNER_SYNC_STEWARD_REQUIRED');
assert.ok(noPublicationReservation.recoveryCommand?.includes('runner-sync enqueue'));

// 2. Full phase walk drives one governed transition per call to the terminal phase.
const expectedActionByPhase: Record<PublicationPhase, string> = {
  'prepared': 'build',
  'reservation': 'build',
  'build-ready': 'build',
  'built-sealed': 'seal',
  'publication-ready': 'publish',
  'published': 'archive-receipt',
  'receipt-archived': 'complete'
};
let phase: PublicationPhase = 'prepared';
const walk: PublicationPhase[] = [phase];
for (let i = 0; i < 7 && phase !== 'receipt-archived'; i += 1) {
  const decision = publishSealedRunner(REQUEST, snapshot({ phase, generation: 3 }));
  assert.equal(decision.allowed, true, `${phase} must advance`);
  assert.equal(decision.action, expectedActionByPhase[phase], `${phase} action`);
  const next = nextPublicationPhase(phase);
  if (!next) break;
  phase = next;
  walk.push(phase);
}
assert.deepEqual(walk, ['prepared', 'reservation', 'build-ready', 'built-sealed', 'publication-ready', 'published', 'receipt-archived']);

// 3. Published phase yields a canonical receipt binding every required field.
const atPublished = publishSealedRunner(REQUEST, snapshot({
  phase: 'published',
  generation: 3,
  runnerBuildDigest: 'sha256:runner',
  manifestDigest: 'sha256:manifest',
  publicationCommitSha: 'd'.repeat(40)
}));
const receipt = atPublished.receipt;
assert.ok(receipt, 'published phase returns a receipt');
assert.equal(receipt!.taskId, 'WORK-2');
assert.equal(receipt!.sealedSourceSha, REQUEST.sealedSourceSha);
assert.equal(receipt!.generation, 3);
assert.equal(receipt!.runnerBuildDigest, 'sha256:runner');
assert.equal(receipt!.manifestDigest, 'sha256:manifest');
assert.equal(receipt!.publicationCommitSha, 'd'.repeat(40));
assert.equal(receipt!.remoteVisibility, 'remote');
assert.deepEqual(receipt!.surfaces, ['release/atm-onefile/atm.mjs', 'release/atm-root-drop']);
assert.ok(receipt!.receiptDigest.startsWith('sha256:'));
// Lane authority is bound as a fingerprint, never a raw lane key.
assert.ok(receipt!.laneFingerprint?.startsWith('lanefp:'));
assert.ok(!JSON.stringify(receipt).includes('lane-owner-cccccccccc'), 'receipt must not leak raw lane id');

// 4. Idempotency: an already-published generation is NOT re-published.
const alreadyPublished = publishSealedRunner(REQUEST, snapshot({
  phase: 'built-sealed', // even if snapshot phase looks earlier
  generation: 3,
  publishedGenerations: [3],
  archivedReceiptPath: null
}));
assert.equal(alreadyPublished.idempotent, true);
assert.notEqual(alreadyPublished.action, 'publish', 'must never re-publish the same generation');
assert.equal(alreadyPublished.action, 'archive-receipt');

// 5. Already published AND archived -> complete, idempotent, returns archived receipt.
const done = publishSealedRunner(REQUEST, snapshot({
  phase: 'receipt-archived',
  generation: 3,
  publishedGenerations: [3],
  archivedReceiptPath: '.atm/history/evidence/WORK-2.runner-sync-receipt.json'
}));
assert.equal(done.action, 'complete');
assert.equal(done.idempotent, true);
assert.equal(done.receipt?.receiptDisposition, 'archived');

// 6. Generalization guard.
const src = readFileSync(path.join(process.cwd(), 'packages/cli/src/commands/framework-development/runner-publication-lifecycle.ts'), 'utf8');
for (const forbidden of ['0263', '0264', '0265', 'claude-002', 'codex-plan31', 'plan31', 'WORK-2']) {
  assert.ok(!src.includes(forbidden), `lifecycle must not special-case ${forbidden}`);
}

console.log('sealed-runner-publication-lifecycle.test.ts passed');
