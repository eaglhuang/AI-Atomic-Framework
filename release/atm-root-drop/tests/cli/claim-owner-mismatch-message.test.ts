/**
 * Claim-ownership errors must identify the dimension that actually decided
 * ownership: lane when both lifecycle records have lane ids, otherwise actor.
 *
 * `compareClaimLifecycleOwners` decides on lane ids whenever both lifecycle
 * records carry one, and only falls back to actor ids when a lane id is
 * missing. The error message used to render actor ids unconditionally, so one
 * actor holding a task on an older lane read `claimed by X, not X` — a
 * self-contradiction that sends the reader looking for an identity defect that
 * does not exist. Recorded as ATM-BUG-2026-08-27-001.
 */
import assert from 'node:assert/strict';

import {
  describeClaimOwnerMismatch,
  evaluateSameTaskClaimOwnership,
  throwIfClaimOwnerMismatch
} from '../../packages/cli/src/commands/tasks/claim-ownership.ts';

// Lane mismatch, one actor: the message must talk about lanes and must never
// assert that an actor is not itself.
{
  const comparison = evaluateSameTaskClaimOwnership({
    currentActorId: 'claude-008',
    currentLaneSessionId: 'lane-holding',
    requestedActorId: 'claude-008',
    requestedLaneSessionId: 'lane-requested'
  });
  assert.equal(comparison.mode, 'lane-id');
  assert.equal(comparison.sameOwner, false);

  const text = describeClaimOwnerMismatch({
    taskId: 'TASK-PRF-0004',
    currentActorId: 'claude-008',
    requestedActorId: 'claude-008',
    comparison
  });
  assert.ok(text.includes('lane-holding'), 'message must name the holding lane');
  assert.ok(text.includes('lane-requested'), 'message must name the requested lane');
  assert.ok(
    !/claimed by claude-008, not claude-008/.test(text),
    'message must never claim an actor is not itself'
  );
}

// Lane mismatch, two actors: both lanes and both actors stay visible.
{
  const comparison = evaluateSameTaskClaimOwnership({
    currentActorId: 'cursor-captain',
    currentLaneSessionId: 'lane-holding',
    requestedActorId: 'claude-008',
    requestedLaneSessionId: 'lane-requested'
  });
  const text = describeClaimOwnerMismatch({
    taskId: 'TASK-PRF-0004',
    currentActorId: 'cursor-captain',
    requestedActorId: 'claude-008',
    comparison
  });
  assert.ok(text.includes('lane-holding') && text.includes('lane-requested'));
  assert.ok(text.includes('cursor-captain') && text.includes('claude-008'));
}

// Actor fallback (a lifecycle record without a lane id) keeps the actor wording.
{
  const comparison = evaluateSameTaskClaimOwnership({
    currentActorId: 'cursor-captain',
    currentLaneSessionId: null,
    requestedActorId: 'claude-008',
    requestedLaneSessionId: 'lane-requested'
  });
  assert.equal(comparison.mode, 'actor-fallback');
  const text = describeClaimOwnerMismatch({
    taskId: 'TASK-PRF-0004',
    currentActorId: 'cursor-captain',
    requestedActorId: 'claude-008',
    comparison
  });
  assert.equal(text, 'Task TASK-PRF-0004 is claimed by cursor-captain, not claude-008.');
}

// Same lane is still the same owner: no throw, and actor drift inside one lane
// stays a handoff rather than a conflict.
{
  const comparison = throwIfClaimOwnerMismatch({
    taskId: 'TASK-PRF-0004',
    currentActorId: 'claude-008',
    currentLaneSessionId: 'lane-holding',
    requestedActorId: 'cursor-captain',
    requestedLaneSessionId: 'lane-holding'
  });
  assert.equal(comparison.sameOwner, true);
}

// The thrown error keeps the machine-readable recovery contract intact.
{
  assert.throws(
    () => throwIfClaimOwnerMismatch({
      taskId: 'TASK-PRF-0004',
      currentActorId: 'claude-008',
      currentLaneSessionId: 'lane-holding',
      requestedActorId: 'claude-008',
      requestedLaneSessionId: 'lane-requested'
    }),
    (error: unknown) => {
      const cliError = error as { code?: string; details?: Record<string, unknown> };
      assert.equal(cliError.code, 'ATM_LANE_SESSION_OWNERSHIP_MISMATCH');
      assert.equal(cliError.details?.ownershipMode, 'lane-id');
      assert.equal(cliError.details?.holdingLaneSessionId, 'lane-holding');
      assert.equal(cliError.details?.requestedLaneSessionId, 'lane-requested');
      assert.equal(
        cliError.details?.laneAdoptCommand,
        'node atm.mjs lane adopt lane-holding --actor claude-008 --json'
      );
      assert.ok(String(cliError.details?.ownerComparisonReason ?? '').length > 0);
      return true;
    }
  );
}

// Without a holding lane, the older actor-specific code remains the public
// contract; the lane-specific error must not broaden into unrelated claims.
{
  assert.throws(
    () => throwIfClaimOwnerMismatch({
      taskId: 'TASK-PRF-0004',
      currentActorId: 'cursor-captain',
      currentLaneSessionId: null,
      requestedActorId: 'claude-008',
      requestedLaneSessionId: 'lane-requested'
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'ATM_TASK_CLAIM_OWNER_MISMATCH');
      return true;
    }
  );
}

console.log('[claim-owner-mismatch-message:test] ok');
