import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  authorizeMutationCapability,
  issueMutationCapability,
  type IssuedTokenRecord,
  type MutationAuthoritySnapshot,
  type MutationCapabilityToken,
  type MutationOperation
} from '../../packages/core/src/lane/lane-capability-provider.ts';

/**
 * Mutation capability parity: one verifier authorizes every protected mutation,
 * a capability issued for one mutation cannot authorize another, and a second
 * actor cannot borrow the original captain's lease, lane, command, environment,
 * or ticket. Generic fixture — no task/actor/date/path special cases
 * (INV-ATM-009). Replays the ATM-BUG-2026-07-24-239 borrow shape generically.
 */

const OWNER_LANE = 'lane-owner-aaaaaaaaaa';
const OTHER_LANE = 'lane-other-bbbbbbbbbb';
const TASK = 'WORK-ITEM-9001';
const GENERATION = 7;
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
const NOW = '2026-07-24T00:00:00.000Z';

function mint(operation: MutationOperation, overrides: Partial<{ laneId: string; resource: string; generation: number; expiresAt: string }> = {}) {
  return issueMutationCapability({
    operation,
    taskId: TASK,
    laneId: overrides.laneId ?? OWNER_LANE,
    generation: overrides.generation ?? GENERATION,
    resource: overrides.resource ?? `resource:${operation}`,
    issuedAt: NOW,
    expiresAt: overrides.expiresAt ?? FAR_FUTURE,
    tokenId: randomUUID()
  });
}

function snapshotWith(records: readonly IssuedTokenRecord[], consumed: readonly string[] = []): MutationAuthoritySnapshot {
  return {
    ownerLaneId: OWNER_LANE,
    currentGeneration: GENERATION,
    issuedTokens: records,
    consumedTokenIds: consumed
  };
}

const ALL_OPERATIONS: readonly MutationOperation[] = [
  'task-renew',
  'task-release',
  'task-handoff',
  'task-takeover',
  'governed-commit',
  'governed-push',
  'framework-mode-claim',
  'framework-mode-release',
  'runner-sync-reserve',
  'runner-sync-publish',
  'taskflow-close'
];

// 1. One verifier authorizes every protected mutation when the owner lane holds
//    a correctly-bound, current, unexpired token.
for (const operation of ALL_OPERATIONS) {
  const issued = mint(operation);
  const decision = authorizeMutationCapability(
    { operation, taskId: TASK, executingLaneId: OWNER_LANE, resource: `resource:${operation}`, presentedToken: issued.token, now: NOW },
    snapshotWith([issued.record]),
    {}
  );
  assert.equal(decision.allowed, true, `${operation} owner capability must verify`);
  assert.equal(decision.decisionClass, 'capability-verified');
  assert.equal(decision.consume, true, `${operation} verified decision must instruct single-use consume`);
  // Only fingerprints escape — the raw token id is never echoed in the decision.
  assert.ok(!JSON.stringify(decision).includes(issued.token.tokenId), `${operation} decision must not leak token id`);
  assert.ok(decision.tokenFingerprint?.startsWith('capabilityfp:'));
}

// 2. Identity alone is not authority: no token → ATM_LANE_CAPABILITY_REQUIRED.
{
  const decision = authorizeMutationCapability(
    { operation: 'governed-commit', taskId: TASK, executingLaneId: OWNER_LANE, actorId: 'owner-captain', resource: 'resource:governed-commit', presentedToken: null, now: NOW },
    snapshotWith([]),
    {}
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.errorCode, 'ATM_LANE_CAPABILITY_REQUIRED');
}

// 3. Cross-operation replay: a token minted for taskflow-close cannot authorize
//    governed-push (audience/operation subject mismatch).
{
  const closeToken = mint('taskflow-close');
  const decision = authorizeMutationCapability(
    { operation: 'governed-push', taskId: TASK, executingLaneId: OWNER_LANE, resource: 'resource:governed-push', presentedToken: closeToken.token as MutationCapabilityToken, now: NOW },
    snapshotWith([closeToken.record]),
    {}
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.errorCode, 'ATM_LANE_CAPABILITY_SUBJECT_MISMATCH');
}

// 4. Cross-resource replay: a token for one sealed resource cannot authorize the
//    same operation on a different resource.
{
  const issued = mint('runner-sync-publish', { resource: 'sha:aaaa' });
  const decision = authorizeMutationCapability(
    { operation: 'runner-sync-publish', taskId: TASK, executingLaneId: OWNER_LANE, resource: 'sha:bbbb', presentedToken: issued.token, now: NOW },
    snapshotWith([issued.record]),
    {}
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.errorCode, 'ATM_LANE_CAPABILITY_SUBJECT_MISMATCH');
}

// 5. Single-use: a verified token consumed once cannot be replayed.
{
  const issued = mint('task-release');
  const first = authorizeMutationCapability(
    { operation: 'task-release', taskId: TASK, executingLaneId: OWNER_LANE, resource: 'resource:task-release', presentedToken: issued.token, now: NOW },
    snapshotWith([issued.record]),
    {}
  );
  assert.equal(first.allowed, true);
  // Caller appends first.consumeTokenId to the ledger; the replay now fails.
  const replay = authorizeMutationCapability(
    { operation: 'task-release', taskId: TASK, executingLaneId: OWNER_LANE, resource: 'resource:task-release', presentedToken: issued.token, now: NOW },
    snapshotWith([issued.record], [issued.token.tokenId]),
    {}
  );
  assert.equal(replay.allowed, false);
  assert.equal(replay.errorCode, 'ATM_LANE_CAPABILITY_REPLAYED');
}

// 6. Generation bump: an old-generation token fails closed after authority
//    advances (e.g. a takeover rotates the generation).
{
  const issued = mint('framework-mode-claim', { generation: GENERATION - 1 });
  const decision = authorizeMutationCapability(
    { operation: 'framework-mode-claim', taskId: TASK, executingLaneId: OWNER_LANE, resource: 'resource:framework-mode-claim', presentedToken: issued.token, now: NOW },
    snapshotWith([issued.record]),
    {}
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.errorCode, 'ATM_LANE_CAPABILITY_REPLAYED');
}

// 7. Borrowed lane: a second actor presents the owner's token from a different
//    executing lane. Possession of the token text is not authority.
{
  const issued = mint('governed-commit');
  const decision = authorizeMutationCapability(
    { operation: 'governed-commit', taskId: TASK, executingLaneId: OTHER_LANE, actorId: 'owner-captain', resource: 'resource:governed-commit', presentedToken: issued.token, now: NOW },
    snapshotWith([issued.record]),
    {}
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.decisionClass, 'borrowed-actor-blocked');
}

// 8. Forged token: an unknown token id (never issued) grants nothing even if its
//    fields look valid.
{
  const forged = mint('taskflow-close');
  const decision = authorizeMutationCapability(
    { operation: 'taskflow-close', taskId: TASK, executingLaneId: OWNER_LANE, resource: 'resource:taskflow-close', presentedToken: forged.token, now: NOW },
    snapshotWith([]), // record NOT present in issued set
    {}
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.errorCode, 'ATM_LANE_CAPABILITY_REQUIRED');
}

// 9. Tampered binding: mutating a bound field without re-issuing breaks the
//    binding hash.
{
  const issued = mint('governed-push');
  const tampered = { ...issued.token, resource: 'resource:elevated' } as MutationCapabilityToken;
  const decision = authorizeMutationCapability(
    { operation: 'governed-push', taskId: TASK, executingLaneId: OWNER_LANE, resource: 'resource:elevated', presentedToken: tampered, now: NOW },
    snapshotWith([issued.record]),
    {}
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.errorCode, 'ATM_LANE_CAPABILITY_REQUIRED');
}

// 10. Expiry: an expired token fails closed.
{
  const issued = mint('runner-sync-reserve', { expiresAt: '2026-07-24T00:00:01.000Z' });
  const decision = authorizeMutationCapability(
    { operation: 'runner-sync-reserve', taskId: TASK, executingLaneId: OWNER_LANE, resource: 'resource:runner-sync-reserve', presentedToken: issued.token, now: '2026-07-24T01:00:00.000Z' },
    snapshotWith([issued.record]),
    {}
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.errorCode, 'ATM_LANE_CAPABILITY_REPLAYED');
}

// 11. Generalization guard: no task/actor/date/path literal special-cases the
//     production provider.
{
  const providerSource = readFileSync(
    path.join(process.cwd(), 'packages/core/src/lane/lane-capability-provider.ts'),
    'utf8'
  );
  for (const forbidden of ['0263', '0264', 'claude-002', 'codex-plan31', 'Plan3.1', 'plan31', 'WORK-ITEM-9001']) {
    assert.ok(!providerSource.includes(forbidden), `provider must not special-case ${forbidden}`);
  }
}

console.log('lane-mutation-capability-parity.test.ts passed');
