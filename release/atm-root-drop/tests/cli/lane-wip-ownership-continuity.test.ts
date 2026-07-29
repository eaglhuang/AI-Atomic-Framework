import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  planWipTransition,
  type WipOwnershipSnapshot
} from '../../packages/core/src/lane/wip-ownership-transition.ts';

/**
 * WIP ownership continuity: in-scope dirty WIP is never ownerless on release,
 * the original lane can resume it, a sealed handoff transfers it, and discard
 * requires a destructive-action receipt. Replays the ATM-BUG-2026-07-22-229
 * counterexample generically — no task/actor/date/path special cases.
 */

const ORIGINAL_LANE = 'lane-original-cccccccccc';
const FOREIGN_LANE = 'lane-foreign-dddddddddd';
const TARGET_LANE = 'lane-target-eeeeeeeeee';
const TASK = 'WORK-ITEM-8001';
const DIRTY = ['packages/core/src/lane/wip-ownership-transition.ts', 'packages/core/src/lane/lane-capability-provider.ts'];
const NOW = '2026-07-22T00:00:00.000Z';

function snapshot(overrides: Partial<WipOwnershipSnapshot> = {}): WipOwnershipSnapshot {
  return {
    taskId: TASK,
    ownerLaneId: overrides.ownerLaneId ?? null,
    recordedDirtyPaths: overrides.recordedDirtyPaths ?? [],
    journalHead: overrides.journalHead ?? 0
  };
}

// 1. Release with in-scope dirty WIP retains ownership on the original lane; it
//    is never ownerless, and a recovery command is emitted.
const release = planWipTransition(
  { kind: 'release', taskId: TASK, requestingLaneId: ORIGINAL_LANE, dirtyPaths: DIRTY, now: NOW },
  snapshot({ ownerLaneId: ORIGINAL_LANE }),
  {}
);
assert.equal(release.allowed, true);
assert.equal(release.transitionClass, 'release-wip-retained');
assert.equal(release.ownerless, false, 'release must never leave dirty WIP ownerless');
assert.equal(release.nextOwnerLaneId, ORIGINAL_LANE);
assert.ok(release.recoveryCommand.includes('--claim') && release.recoveryCommand.includes(TASK));
assert.equal(release.journalEntry.seq, 1);
assert.equal(release.journalEntry.dirtyPathCount, DIRTY.length);
// The surfaced artifacts — the append-only journal entry and the recovery
// command — expose only fingerprints and safe metadata, never a raw lane key.
assert.ok(!JSON.stringify(release.journalEntry).includes(ORIGINAL_LANE), 'journal entry must not leak raw lane id');
assert.ok(!release.recoveryCommand.includes(ORIGINAL_LANE), 'recovery command must not leak raw lane id');
assert.ok(release.recoveryCommand.includes('$ATM_LANE_SESSION_ID'), 'recovery references the holder lane via env, not a raw key');
assert.ok(release.nextOwnerLaneFingerprint?.startsWith('lanefp:'));

// 2. Same-lane reclaim resumes the recorded WIP.
const reclaim = planWipTransition(
  { kind: 'reclaim', taskId: TASK, requestingLaneId: ORIGINAL_LANE, dirtyPaths: DIRTY, now: NOW },
  snapshot({ ownerLaneId: ORIGINAL_LANE, recordedDirtyPaths: DIRTY, journalHead: 1 }),
  {}
);
assert.equal(reclaim.allowed, true);
assert.equal(reclaim.transitionClass, 'reclaim-resume');
assert.equal(reclaim.nextOwnerLaneId, ORIGINAL_LANE);
assert.equal(reclaim.journalEntry.seq, 2, 'journal is append-only and monotonic');

// 3. ATM-BUG-2026-07-22-229 replay: a FOREIGN lane reclaiming over the recorded
//    dirty WIP is refused with ATM_CLAIM_FOREIGN_UNSTAGED_WIP and an executable
//    recovery command — never silently ownerless/foreign.
const foreignReclaim = planWipTransition(
  { kind: 'reclaim', taskId: TASK, requestingLaneId: FOREIGN_LANE, dirtyPaths: DIRTY, now: NOW },
  snapshot({ ownerLaneId: ORIGINAL_LANE, recordedDirtyPaths: DIRTY, journalHead: 2 }),
  {}
);
assert.equal(foreignReclaim.allowed, false);
assert.equal(foreignReclaim.transitionClass, 'blocked-foreign-wip');
assert.equal(foreignReclaim.errorCode, 'ATM_CLAIM_FOREIGN_UNSTAGED_WIP');
assert.ok(foreignReclaim.recoveryCommand.trim().length > 0, 'blocked foreign WIP must carry a recovery command');
assert.ok(foreignReclaim.recoveryCommand.includes('repair-claim'));

// 4. Sealed handoff transfers ownership to the target lane.
const handoff = planWipTransition(
  {
    kind: 'handoff',
    taskId: TASK,
    requestingLaneId: ORIGINAL_LANE,
    dirtyPaths: DIRTY,
    handoff: { handoffId: 'ho-1', fromLaneId: ORIGINAL_LANE, toLaneId: TARGET_LANE, taskId: TASK },
    now: NOW
  },
  snapshot({ ownerLaneId: ORIGINAL_LANE, recordedDirtyPaths: DIRTY, journalHead: 3 }),
  {}
);
assert.equal(handoff.allowed, true);
assert.equal(handoff.transitionClass, 'handoff-transfer');
assert.equal(handoff.nextOwnerLaneId, TARGET_LANE);
assert.equal(handoff.ownerless, false);

// 5. Unsealed handoff is refused; ownership stays on the original lane.
const unsealed = planWipTransition(
  { kind: 'handoff', taskId: TASK, requestingLaneId: ORIGINAL_LANE, dirtyPaths: DIRTY, handoff: null, now: NOW },
  snapshot({ ownerLaneId: ORIGINAL_LANE, recordedDirtyPaths: DIRTY, journalHead: 4 }),
  {}
);
assert.equal(unsealed.allowed, false);
assert.equal(unsealed.transitionClass, 'blocked-unsealed-handoff');
assert.equal(unsealed.nextOwnerLaneId, ORIGINAL_LANE, 'refused handoff keeps original owner');

// 6. Discard without a destructive-action receipt is refused.
const discardNoReceipt = planWipTransition(
  { kind: 'discard', taskId: TASK, requestingLaneId: ORIGINAL_LANE, dirtyPaths: DIRTY, now: NOW },
  snapshot({ ownerLaneId: ORIGINAL_LANE, recordedDirtyPaths: DIRTY, journalHead: 5 }),
  {}
);
assert.equal(discardNoReceipt.allowed, false);
assert.equal(discardNoReceipt.transitionClass, 'blocked-discard-requires-receipt');

// 7. Discard WITH a bound destructive-action receipt is sealed.
const discardSealed = planWipTransition(
  {
    kind: 'discard',
    taskId: TASK,
    requestingLaneId: ORIGINAL_LANE,
    dirtyPaths: DIRTY,
    destructiveReceipt: { receiptId: 'dr-1', approver: 'human-operator', taskId: TASK, laneId: ORIGINAL_LANE },
    now: NOW
  },
  snapshot({ ownerLaneId: ORIGINAL_LANE, recordedDirtyPaths: DIRTY, journalHead: 6 }),
  {}
);
assert.equal(discardSealed.allowed, true);
assert.equal(discardSealed.transitionClass, 'discard-sealed');

// 8. A wrong-lane discard receipt does not authorize discard.
const discardWrongLane = planWipTransition(
  {
    kind: 'discard',
    taskId: TASK,
    requestingLaneId: ORIGINAL_LANE,
    dirtyPaths: DIRTY,
    destructiveReceipt: { receiptId: 'dr-2', approver: 'human-operator', taskId: TASK, laneId: FOREIGN_LANE },
    now: NOW
  },
  snapshot({ ownerLaneId: ORIGINAL_LANE, recordedDirtyPaths: DIRTY, journalHead: 7 }),
  {}
);
assert.equal(discardWrongLane.allowed, false);
assert.equal(discardWrongLane.transitionClass, 'blocked-discard-requires-receipt');

// 9. Generalization guard.
{
  const source = readFileSync(
    path.join(process.cwd(), 'packages/core/src/lane/wip-ownership-transition.ts'),
    'utf8'
  );
  for (const forbidden of ['0263', '0264', 'claude-002', 'codex-plan31', 'Plan3.1', 'plan31', 'WORK-ITEM-8001']) {
    assert.ok(!source.includes(forbidden), `wip transition must not special-case ${forbidden}`);
  }
}

console.log('lane-wip-ownership-continuity.test.ts passed');
