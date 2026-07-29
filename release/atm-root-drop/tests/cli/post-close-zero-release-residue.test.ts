import assert from 'node:assert/strict';
import {
  publishSealedRunner,
  type PublicationRequest,
  type PublicationSnapshot
} from '../../packages/cli/src/commands/framework-development/runner-publication-lifecycle.ts';

/**
 * Post-close zero release residue.
 *
 * Receipt archival is a governed terminal phase, not untracked advisory
 * residue. A completed publication yields an ARCHIVED receipt disposition, and
 * repeated publication/reconcile calls are idempotent no-ops that never
 * re-publish or leave an unarchived receipt. This is the property that removes
 * the recurring post-close release-artifact residue / manual receipt archival
 * captain conversation. Generic fixture.
 */

const REQUEST: PublicationRequest = {
  authority: { taskId: 'WORK-3', laneSessionId: 'lane-owner-dddddddddd', stewardActorId: 'steward-actor' },
  sealedSourceSha: 'e'.repeat(40),
  surfaces: ['release/atm-onefile/atm.mjs', 'release/atm-root-drop', 'packages/cli/dist'],
  remoteVisibility: 'local',
  now: '2026-07-25T00:00:00.000Z'
};

function snapshot(over: Partial<PublicationSnapshot> = {}): PublicationSnapshot {
  return {
    phase: 'reservation',
    sealedSourceSha: REQUEST.sealedSourceSha,
    generation: 7,
    runnerBuildDigest: 'sha256:runner',
    manifestDigest: 'sha256:manifest',
    publicationCommitSha: 'f'.repeat(40),
    publishedGenerations: [],
    archivedReceiptPath: null,
    queueHeadOwned: true,
    ...over
  };
}

// 1. At the 'published' phase, the governed next action is receipt archival —
//    the receipt is a tracked terminal artifact, never advisory residue.
const atPublished = publishSealedRunner(REQUEST, snapshot({ phase: 'published' }));
assert.equal(atPublished.action, 'archive-receipt');
assert.ok(atPublished.receipt, 'a canonical receipt is produced for archival');

// 2. Once archived, the lifecycle is complete with an ARCHIVED disposition
//    (zero unarchived residue) and is idempotent.
const archived = snapshot({
  phase: 'receipt-archived',
  publishedGenerations: [7],
  archivedReceiptPath: '.atm/history/evidence/WORK-3.runner-sync-receipt.json'
});
const complete = publishSealedRunner(REQUEST, archived);
assert.equal(complete.action, 'complete');
assert.equal(complete.idempotent, true);
assert.equal(complete.receipt?.receiptDisposition, 'archived', 'terminal receipt is archived, not pending residue');

// 3. Repeated reconcile calls after completion never re-publish and never
//    produce a non-archived (residual) receipt.
for (let i = 0; i < 5; i += 1) {
  const again = publishSealedRunner(REQUEST, archived);
  assert.equal(again.idempotent, true, `reconcile #${i} is idempotent`);
  assert.notEqual(again.action, 'publish', `reconcile #${i} must not re-publish`);
  assert.notEqual(again.action, 'build', `reconcile #${i} must not rebuild`);
  assert.equal(again.receipt?.receiptDisposition, 'archived', `reconcile #${i} leaves zero unarchived residue`);
}

// 4. A published-but-not-yet-archived generation is driven to archival (so no
//    post-close call can leave the receipt as untracked residue).
const publishedNotArchived = publishSealedRunner(REQUEST, snapshot({
  phase: 'published',
  publishedGenerations: [7],
  archivedReceiptPath: null
}));
assert.equal(publishedNotArchived.idempotent, true);
assert.equal(publishedNotArchived.action, 'archive-receipt', 'unarchived receipt is converged to archived, not left as residue');

// 5. A fresh, never-published generation still requires the full lifecycle
//    (no shortcut that would skip archival and leave residue).
const fresh = publishSealedRunner(REQUEST, snapshot({ phase: 'reservation', generation: 8, publishedGenerations: [7] }));
assert.equal(fresh.allowed, true);
assert.notEqual(fresh.idempotent, true, 'a new generation is not treated as already-done');

console.log('post-close-zero-release-residue.test.ts passed');
