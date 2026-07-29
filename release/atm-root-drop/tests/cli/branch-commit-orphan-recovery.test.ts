import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  coordinateBranchCommit,
  type BranchCommitSnapshot
} from '../../packages/cli/src/commands/git-governance/branch-commit-coordinator.ts';

/**
 * Branch commit-window coordination + orphan-lock recovery.
 *
 * Replays the pre-commit timeout orphan-lock incident generically: a dead owner
 * before commit is recoverable even when HEAD did not move. No incident task id,
 * actor id, date, or local path is special-cased.
 */

const BRANCH = 'main';
const OWNER_LANE = 'lane-owner-aaaaaaaaaa';
const OTHER_LANE = 'lane-other-bbbbbbbbbb';
const NOW = '2026-07-25T00:00:00.000Z';
const HEAD = 'a'.repeat(40);

function snapshot(over: Partial<BranchCommitSnapshot> = {}): BranchCommitSnapshot {
  return {
    branch: BRANCH,
    owner: null,
    currentGeneration: 5,
    headSha: HEAD,
    ...over
  };
}

// 1. Free window -> acquire.
const free = coordinateBranchCommit(
  { branch: BRANCH, taskId: 'WORK-1', executingLaneSessionId: OWNER_LANE, candidateFiles: ['b.ts', 'a.ts', 'a.ts'], adapter: 'commit', now: NOW },
  snapshot()
);
assert.equal(free.action, 'acquire');
assert.equal(free.allowed, true);
assert.deepEqual(free.candidateSet, ['a.ts', 'b.ts'], 'candidate set is normalized + deduped + sorted');
assert.ok(free.fencingToken.startsWith('fence:5:'), 'fencing token binds the generation');
assert.ok(free.idempotencyKey.length > 0);
// Only fingerprints escape.
assert.ok(!JSON.stringify(free).includes(OWNER_LANE), 'plan must not leak raw lane id');

// 2. Orphan-lock incident: DEAD owner, HEAD did NOT move, generation unchanged -> reclaim.
const orphan = coordinateBranchCommit(
  { branch: BRANCH, taskId: 'WORK-1', executingLaneSessionId: OTHER_LANE, candidateFiles: ['a.ts'], adapter: 'commit', now: NOW },
  snapshot({
    owner: { laneSessionId: OWNER_LANE, actorId: 'a', generation: 5, expiresAt: '2999-01-01T00:00:00.000Z', headShaAtAcquire: HEAD, liveness: 'dead' },
    currentGeneration: 5,
    headSha: HEAD // unchanged
  })
);
assert.equal(orphan.action, 'reclaim', 'dead owner at unchanged generation is reclaimable even with unmoved HEAD');
assert.equal(orphan.allowed, true);
assert.ok(!orphan.recoveryCommand.includes('rm ') && !orphan.recoveryCommand.includes('.atm/runtime'), 'reclaim never instructs manual lock deletion');

// 3. Expired (but liveness unknown) owner at unchanged generation -> reclaim.
const expired = coordinateBranchCommit(
  { branch: BRANCH, taskId: 'WORK-1', executingLaneSessionId: OTHER_LANE, candidateFiles: ['a.ts'], adapter: 'close', now: '2026-07-25T01:00:00.000Z' },
  snapshot({
    owner: { laneSessionId: OWNER_LANE, actorId: 'a', generation: 5, expiresAt: '2026-07-25T00:30:00.000Z', headShaAtAcquire: HEAD, liveness: 'unknown' },
    currentGeneration: 5
  })
);
assert.equal(expired.action, 'reclaim');

// 4. LIVE owner -> wait (never reclaim a live window).
const live = coordinateBranchCommit(
  { branch: BRANCH, taskId: 'WORK-1', executingLaneSessionId: OTHER_LANE, candidateFiles: ['a.ts'], adapter: 'commit', now: NOW },
  snapshot({
    owner: { laneSessionId: OWNER_LANE, actorId: 'a', generation: 5, expiresAt: '2999-01-01T00:00:00.000Z', headShaAtAcquire: HEAD, liveness: 'live' },
    currentGeneration: 5
  })
);
assert.equal(live.action, 'wait');
assert.equal(live.allowed, false);

// 5. Dead owner but generation ALREADY ADVANCED -> refuse reclaim (fencing), wait.
const staleGen = coordinateBranchCommit(
  { branch: BRANCH, taskId: 'WORK-1', executingLaneSessionId: OTHER_LANE, candidateFiles: ['a.ts'], adapter: 'commit', now: NOW },
  snapshot({
    owner: { laneSessionId: OWNER_LANE, actorId: 'a', generation: 4, expiresAt: '2000-01-01T00:00:00.000Z', headShaAtAcquire: HEAD, liveness: 'dead' },
    currentGeneration: 5 // advanced past the owner's generation
  })
);
assert.equal(staleGen.action, 'wait', 'reclaim requires an unchanged fenced generation');

// 6. No executing lane capability -> wait (authority cannot bind to an actor string).
const noLane = coordinateBranchCommit(
  { branch: BRANCH, taskId: 'WORK-1', executingLaneSessionId: null, actorId: 'someone', candidateFiles: ['a.ts'], adapter: 'commit', now: NOW },
  snapshot()
);
assert.equal(noLane.action, 'wait');
assert.equal(noLane.allowed, false);

// 7. Owner lane re-entry at live generation is idempotent acquire.
const reentry = coordinateBranchCommit(
  { branch: BRANCH, taskId: 'WORK-1', executingLaneSessionId: OWNER_LANE, candidateFiles: ['a.ts'], adapter: 'commit', now: NOW },
  snapshot({
    owner: { laneSessionId: OWNER_LANE, actorId: 'a', generation: 5, expiresAt: '2999-01-01T00:00:00.000Z', headShaAtAcquire: HEAD, liveness: 'live' },
    currentGeneration: 5
  })
);
assert.equal(reentry.action, 'acquire');
assert.equal(reentry.allowed, true);

// 8. Release by the current-generation owner is authorized; by a non-owner is not.
const release = coordinateBranchCommit(
  { branch: BRANCH, taskId: 'WORK-1', executingLaneSessionId: OWNER_LANE, candidateFiles: ['a.ts'], adapter: 'commit', releasing: true, now: NOW },
  snapshot({ owner: { laneSessionId: OWNER_LANE, actorId: 'a', generation: 5, expiresAt: '2999-01-01T00:00:00.000Z', headShaAtAcquire: HEAD, liveness: 'live' }, currentGeneration: 5 })
);
assert.equal(release.action, 'release');
assert.equal(release.allowed, true);

// 9. Idempotency key is stable for identical requests, differs on candidate change.
const k1 = coordinateBranchCommit({ branch: BRANCH, taskId: 'WORK-1', executingLaneSessionId: OWNER_LANE, candidateFiles: ['a.ts'], adapter: 'commit', now: NOW }, snapshot()).idempotencyKey;
const k2 = coordinateBranchCommit({ branch: BRANCH, taskId: 'WORK-1', executingLaneSessionId: OWNER_LANE, candidateFiles: ['a.ts'], adapter: 'commit', now: NOW }, snapshot()).idempotencyKey;
const k3 = coordinateBranchCommit({ branch: BRANCH, taskId: 'WORK-1', executingLaneSessionId: OWNER_LANE, candidateFiles: ['a.ts', 'c.ts'], adapter: 'commit', now: NOW }, snapshot()).idempotencyKey;
assert.equal(k1, k2, 'identical requests share an idempotency key');
assert.notEqual(k1, k3, 'a different candidate set yields a different idempotency key');

// 10. Generalization guard.
const src = readFileSync(path.join(process.cwd(), 'packages/cli/src/commands/git-governance/branch-commit-coordinator.ts'), 'utf8');
for (const forbidden of ['0263', '0264', '0265', 'claude-002', 'codex-plan31', 'plan31', 'WORK-1']) {
  assert.ok(!src.includes(forbidden), `coordinator must not special-case ${forbidden}`);
}

console.log('branch-commit-orphan-recovery.test.ts passed');
