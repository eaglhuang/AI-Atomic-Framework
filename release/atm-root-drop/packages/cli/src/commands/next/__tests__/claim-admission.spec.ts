import assert from 'node:assert/strict';
import {
  compareClaimLifecycleOwners,
  deriveActiveWriteConflictFromOwnerComparison,
  evaluateClaimAdmission,
  isBrokerVerdictAdmissible
} from '../claim-admission.ts';
import { buildPreClaimWriteIntent } from '../claim-helpers.ts';

assert.equal(isBrokerVerdictAdmissible('allow'), true);

const cleanImport = evaluateClaimAdmission({
  brokerVerdict: 'allow',
  cidVerdict: 'parallel-safe',
  candidateTaskId: 'TASK-RFT-0001'
});
assert.equal(cleanImport.admitted, true);
assert.equal(cleanImport.blockCode, null);

const blockedCid = evaluateClaimAdmission({
  brokerVerdict: 'freeze',
  cidVerdict: 'blocked-cid-conflict',
  candidateTaskId: 'TASK-RFT-0002',
  conflictingTaskId: 'TASK-RFT-0001',
  overlappingAtomIds: ['atm.next-command-atomic-map']
});
assert.equal(blockedCid.admitted, false);
assert.equal(blockedCid.blockCode, 'ATM_NEXT_CLAIM_BLOCKED');
assert.match(blockedCid.blockReason ?? '', /TASK-RFT-0001/);

const closeoutOnlyOk = evaluateClaimAdmission({
  brokerVerdict: 'watch',
  cidVerdict: 'parallel-safe',
  candidateTaskId: 'TASK-RFT-0003'
});
assert.equal(closeoutOnlyOk.admitted, true);

const sameActorDifferentLane = compareClaimLifecycleOwners({
  current: { actorId: 'codex-captain', laneSessionId: 'lane-a' },
  conflicting: { actorId: 'codex-captain', laneSessionId: 'lane-b' }
});
assert.equal(sameActorDifferentLane.mode, 'lane-id');
assert.equal(sameActorDifferentLane.sameOwner, false);
assert.equal(
  deriveActiveWriteConflictFromOwnerComparison({
    comparison: sameActorDifferentLane,
    conflictIntent: 'write'
  }),
  true,
  'same actor with different lane ids is a distinct lifecycle owner'
);

const sameLaneDifferentActor = compareClaimLifecycleOwners({
  current: { actorId: 'codex-after-handoff', laneSessionId: 'lane-shared' },
  conflicting: { actorId: 'codex-before-handoff', laneSessionId: 'lane-shared' }
});
assert.equal(sameLaneDifferentActor.mode, 'lane-id');
assert.equal(sameLaneDifferentActor.sameOwner, true);
assert.equal(
  deriveActiveWriteConflictFromOwnerComparison({
    comparison: sameLaneDifferentActor,
    conflictIntent: 'write'
  }),
  false,
  'same lane remains one lifecycle owner even when actor metadata changes'
);

const actorFallback = compareClaimLifecycleOwners({
  current: { actorId: 'codex-captain' },
  conflicting: { actorId: 'codex-captain' }
});
assert.equal(actorFallback.mode, 'actor-fallback');
assert.equal(actorFallback.sameOwner, true);

const before = JSON.stringify({
  brokerVerdict: 'allow',
  cidVerdict: 'parallel-safe',
  candidateTaskId: 'TASK-RFT-0004'
} as const);
const input = {
  brokerVerdict: 'allow' as const,
  cidVerdict: 'parallel-safe' as const,
  candidateTaskId: 'TASK-RFT-0004'
};
evaluateClaimAdmission(input);
assert.equal(JSON.stringify(input), before, 'admission policy must not mutate its input');

const releaseMirrorIntent = buildPreClaimWriteIntent({
  taskId: 'TASK-RUNNER-SYNC',
  actorId: 'captain-a',
  baseCommit: 'abc123',
  targetFiles: ['release/atm-onefile/atm.mjs']
});
assert.deepEqual(releaseMirrorIntent.sharedSurfaces.generators, ['atm.runner-sync.coalescing-steward']);
assert.deepEqual(releaseMirrorIntent.sharedSurfaces.artifacts, ['atm.release-mirror']);

const backlogProjectionIntent = buildPreClaimWriteIntent({
  taskId: 'TASK-BACKLOG-PROJECTION',
  actorId: 'captain-b',
  baseCommit: 'abc123',
  targetFiles: ['docs/governance/atm-bug-and-optimization-backlog.md']
});
assert.deepEqual(backlogProjectionIntent.sharedSurfaces.projections, ['atm.generated-projection.governance-backlog']);

const ordinaryIntent = buildPreClaimWriteIntent({
  taskId: 'TASK-ORDINARY',
  actorId: 'captain-c',
  baseCommit: 'abc123',
  targetFiles: ['src/ordinary.ts']
});
assert.deepEqual(ordinaryIntent.sharedSurfaces, {
  generators: [],
  projections: [],
  registries: [],
  validators: [],
  artifacts: []
});

console.log('[claim-admission.spec] ok');
