import assert from 'node:assert/strict';
import { candidatesToWriteIntent } from '../candidate-bridge.js';
import { calculateBrokerDecision } from '../decision.js';
import { cleanupGeneratedProjectionSteward, classifyBacklogItemShardProjectionWork, emptyGeneratedProjectionSteward, enqueueGeneratedProjectionRebuild, governanceBacklogProjectionKeyForPath } from '../generated-projection-steward.js';
import { GOVERNANCE_BACKLOG_PROJECTION } from '../global-resource-projection.js';
const t0 = '2026-07-15T00:00:00.000Z';
function makeCandidate(filePath, taskId) {
    return {
        candidateId: `${taskId}:${filePath}`,
        kind: 'file',
        symbol: filePath,
        filePath,
        lineStart: 1,
        lineEnd: 1,
        confidence: 'high',
        detectionMethod: 'fixture',
        suggestedAtomId: `atom-${taskId.toLowerCase()}`
    };
}
function makeIntent(taskId, targetFiles) {
    return candidatesToWriteIntent(targetFiles.map((filePath) => makeCandidate(filePath, taskId)), {
        taskId,
        actorId: `${taskId.toLowerCase()}-actor`,
        baseCommit: 'abc123'
    });
}
function activeFromIntent(intent, intentId) {
    return {
        intentId,
        taskId: intent.taskId,
        teamRunId: null,
        actorId: intent.actorId,
        baseCommit: intent.baseCommit,
        resourceKeys: {
            files: intent.targetFiles,
            atomIds: intent.atomRefs.map((ref) => ref.atomId),
            atomCids: intent.atomRefs.map((ref) => ref.atomCid),
            readAtomIds: [],
            readAtomCids: [],
            atomRanges: [],
            generators: intent.sharedSurfaces.generators,
            projections: intent.sharedSurfaces.projections,
            registries: intent.sharedSurfaces.registries,
            validators: intent.sharedSurfaces.validators,
            artifacts: intent.sharedSurfaces.artifacts
        },
        leaseEpoch: 1,
        leaseSeconds: 1800,
        leaseMaxSeconds: 1800,
        heartbeatAt: t0,
        lane: 'direct-brokered',
        expiresAt: '2099-01-01T00:00:00.000Z'
    };
}
function registryWith(intents) {
    return {
        schemaId: 'atm.writeBrokerRegistry.v1',
        specVersion: '0.1.0',
        repoId: 'test-repo',
        workspaceId: 'test-workspace',
        activeIntents: intents
    };
}
function testBacklogItemShardIsPrivateAppendOnly() {
    const classification = classifyBacklogItemShardProjectionWork([
        'docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-15-202.json'
    ]);
    assert.deepEqual(classification.itemShardPaths, [
        'docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-15-202.json'
    ]);
    assert.deepEqual(classification.generatedProjectionKeys, []);
    assert.equal(classification.closeBundleMustIncludeMarkdownProjection, false);
    console.log('ok: backlog item shard writes are private append-only source records');
}
function testProjectionRebuildQueuesOnCanonicalKey() {
    let queue = emptyGeneratedProjectionSteward(t0);
    const first = enqueueGeneratedProjectionRebuild(queue, {
        taskId: 'TASK-PROJECTION-A',
        actorId: 'captain-a',
        projectionKey: GOVERNANCE_BACKLOG_PROJECTION,
        sourceItemPaths: ['docs/governance/atm-bug-and-optimization-backlog.items/A.json'],
        createdAt: t0,
        heartbeatAt: t0
    });
    queue = first.queue;
    const second = enqueueGeneratedProjectionRebuild(queue, {
        taskId: 'TASK-PROJECTION-B',
        actorId: 'captain-b',
        projectionKey: GOVERNANCE_BACKLOG_PROJECTION,
        sourceItemPaths: ['docs/governance/atm-bug-and-optimization-backlog.items/B.json'],
        createdAt: '2026-07-15T00:00:01.000Z',
        heartbeatAt: '2026-07-15T00:00:01.000Z'
    });
    assert.equal(first.ownerTaskId, 'TASK-PROJECTION-A');
    assert.equal(second.ownerTaskId, 'TASK-PROJECTION-A');
    assert.equal(second.queuePosition, 2);
    assert.equal(second.queue.queues[0].projectionKey, GOVERNANCE_BACKLOG_PROJECTION);
    assert.ok(second.suggestedNextAction.includes('TASK-PROJECTION-A'));
    console.log('ok: generated projection rebuilds queue on the canonical projection key');
}
function testStaleProjectionOwnerCleanup() {
    let queue = emptyGeneratedProjectionSteward(t0);
    queue = enqueueGeneratedProjectionRebuild(queue, {
        taskId: 'TASK-STALE',
        actorId: 'stale-captain',
        projectionKey: GOVERNANCE_BACKLOG_PROJECTION,
        sourceItemPaths: ['docs/governance/atm-bug-and-optimization-backlog.items/A.json'],
        createdAt: t0,
        heartbeatAt: t0,
        ttlSeconds: 1
    }).queue;
    queue = enqueueGeneratedProjectionRebuild(queue, {
        taskId: 'TASK-LIVE',
        actorId: 'live-captain',
        projectionKey: GOVERNANCE_BACKLOG_PROJECTION,
        sourceItemPaths: ['docs/governance/atm-bug-and-optimization-backlog.items/B.json'],
        createdAt: '2026-07-15T00:00:02.000Z',
        heartbeatAt: '2026-07-15T00:00:02.000Z',
        ttlSeconds: 420
    }).queue;
    const cleanup = cleanupGeneratedProjectionSteward(queue, '2026-07-15T00:00:03.000Z');
    assert.equal(cleanup.staleReleases.length, 1);
    assert.equal(cleanup.staleReleases[0].taskId, 'TASK-STALE');
    assert.ok(cleanup.staleReleases[0].suggestedRetryCommand.includes('broker projection enqueue'));
    assert.equal(cleanup.queue.queues[0].entries[0].taskId, 'TASK-LIVE');
    assert.equal(cleanup.queue.queues[0].entries[0].queuePosition, 1);
    console.log('ok: generated projection stale owners are released with retry guidance');
}
function testWaitingProjectionDoesNotBlockBacklogShard() {
    const activeProjection = activeFromIntent(makeIntent('TASK-PROJECTION-A', [
        'docs/governance/atm-bug-and-optimization-backlog.md'
    ]), 'intent-projection-a');
    const itemShard = makeIntent('TASK-BACKLOG-ITEM', [
        'docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-15-203.json'
    ]);
    const decision = calculateBrokerDecision(itemShard, registryWith([activeProjection]));
    assert.equal(governanceBacklogProjectionKeyForPath('docs/governance/atm-bug-and-optimization-backlog.md'), GOVERNANCE_BACKLOG_PROJECTION);
    assert.equal(decision.verdict, 'parallel-safe');
    assert.equal(decision.conflicts.length, 0);
    console.log('ok: waiting generated projection rebuild does not block append-only item shards');
}
testBacklogItemShardIsPrivateAppendOnly();
testProjectionRebuildQueuesOnCanonicalKey();
testStaleProjectionOwnerCleanup();
testWaitingProjectionDoesNotBlockBacklogShard();
console.log('all generated projection steward tests passed');
