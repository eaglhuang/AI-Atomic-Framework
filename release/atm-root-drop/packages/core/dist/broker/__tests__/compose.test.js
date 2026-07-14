import assert from 'node:assert/strict';
import { enqueueSharedSurface, planSharedSurfaceAcquisition, releaseSharedSurfaceHead } from '../shared-surface-queue.js';
const first = enqueueSharedSurface({
    entry: {
        taskId: 'TASK-ONE', actorId: 'agent-one', surfacePath: 'docs/governance/backlog.md',
        leaseEpoch: 1, baseHash: 'sha256:same', reason: 'bounded text update',
        releaseCondition: 'TASK-ONE commit recorded', queuedAt: '2026-07-12T00:00:00.000Z'
    }
});
assert.equal(first.ok, true);
assert.equal(first.position, 1);
const second = enqueueSharedSurface({
    queue: first.queue,
    entry: {
        taskId: 'TASK-TWO', actorId: 'agent-two', surfacePath: 'docs/governance/backlog.md',
        leaseEpoch: 2, baseHash: 'sha256:same', reason: 'bounded follow-up',
        releaseCondition: 'TASK-ONE release recorded', queuedAt: '2026-07-12T00:01:00.000Z'
    }
});
assert.equal(second.ok, true);
assert.equal(second.position, 2);
assert.equal(releaseSharedSurfaceHead({ queue: second.queue, taskId: 'TASK-ONE' }).entries[0]?.taskId, 'TASK-TWO');
const mismatched = enqueueSharedSurface({
    queue: first.queue,
    entry: {
        taskId: 'TASK-THREE', actorId: 'agent-three', surfacePath: 'docs/governance/backlog.md',
        leaseEpoch: 3, baseHash: 'sha256:different', reason: 'stale source',
        releaseCondition: 'manual re-arbitration', queuedAt: '2026-07-12T00:02:00.000Z'
    }
});
assert.equal(mismatched.ok, false);
assert.equal(mismatched.code, 'base-hash-mismatch');
assert.throws(() => releaseSharedSurfaceHead({ queue: second.queue, taskId: 'TASK-TWO' }), /RELEASE_FORBIDDEN/);
const reverseArrival = enqueueSharedSurface({
    entry: { taskId: 'TASK-LATER', actorId: 'later', surfacePath: 'docs/governance/second.md', leaseEpoch: 20, baseHash: 'sha256:same', reason: 'later request', releaseCondition: 'release', queuedAt: '2026-07-12T00:20:00.000Z' }
});
const stableOrder = enqueueSharedSurface({
    queue: reverseArrival.queue,
    entry: { taskId: 'TASK-EARLIER', actorId: 'earlier', surfacePath: 'docs/governance/second.md', leaseEpoch: 10, baseHash: 'sha256:same', reason: 'earlier request', releaseCondition: 'release', queuedAt: '2026-07-12T00:10:00.000Z' }
});
assert.equal(stableOrder.queue.entries[0]?.taskId, 'TASK-EARLIER', 'Lease epoch, not process arrival, determines every surface queue order.');
const acquisition = planSharedSurfaceAcquisition([second.queue, stableOrder.queue], 'TASK-TWO');
assert.deepEqual(acquisition.orderedSurfacePaths, ['docs/governance/backlog.md']);
assert.equal(acquisition.readyToMutateSharedPaths, false);
assert.equal(acquisition.waitingOn[0]?.queueHeadTaskId, 'TASK-ONE');
console.log('ok: shared-surface queue ordering and fail-closed base hash checks');
