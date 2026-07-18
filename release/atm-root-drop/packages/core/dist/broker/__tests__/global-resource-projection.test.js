import assert from 'node:assert/strict';
import { candidatesToWriteIntent } from '../candidate-bridge.js';
import { calculateBrokerDecision } from '../decision.js';
import { ATOM_MAP_PROJECTION, BRANCH_COMMIT_QUEUE_REGISTRY, GIT_INDEX_REGISTRY, GOVERNANCE_BACKLOG_PROJECTION, RELEASE_MIRROR_ARTIFACT, RUNNER_SYNC_STEWARD_GENERATOR, projectGovernanceSharedSurfacesFromPaths } from '../global-resource-projection.js';
function registryWith(intents) {
    return {
        schemaId: 'atm.writeBrokerRegistry.v1',
        specVersion: '0.1.0',
        repoId: 'test-repo',
        workspaceId: 'test-workspace',
        activeIntents: intents
    };
}
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
function makeIntent(input) {
    return candidatesToWriteIntent(input.targetFiles.map((filePath) => makeCandidate(filePath, input.taskId)), {
        taskId: input.taskId,
        actorId: input.actorId ?? `${input.taskId.toLowerCase()}-actor`,
        baseCommit: 'abc123',
        governanceResources: { runnerSyncRequired: input.runnerSyncRequired }
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
        heartbeatAt: '2026-07-15T14:19:30.431Z',
        lane: 'direct-brokered',
        expiresAt: '2099-01-01T00:00:00.000Z'
    };
}
function testPathProjection() {
    const projection = projectGovernanceSharedSurfacesFromPaths([
        'release/atm-onefile/atm.mjs',
        'docs/governance/atm-bug-and-optimization-backlog.md',
        'atomic_workbench/atomization-coverage/path-to-atom-map.json',
        '.atm/runtime/git-index-leases/git-stage-override-test.json',
        '.atm/runtime/locks/git-commit-queue-main.lock'
    ]);
    assert.deepEqual(projection.generators, [RUNNER_SYNC_STEWARD_GENERATOR]);
    assert.deepEqual(projection.artifacts, [RELEASE_MIRROR_ARTIFACT]);
    assert.deepEqual(projection.projections, [ATOM_MAP_PROJECTION, GOVERNANCE_BACKLOG_PROJECTION]);
    assert.deepEqual(projection.registries, [BRANCH_COMMIT_QUEUE_REGISTRY, GIT_INDEX_REGISTRY]);
    console.log('ok: global governance paths project into existing shared surfaces');
}
function testLiveRftCaseAllowsBacklogItemShard() {
    const activeRft = activeFromIntent(makeIntent({
        taskId: 'TASK-RFT-0039',
        actorId: 'codex-task-rft-0039',
        targetFiles: [
            'packages/cli/src/commands/team-legacy.ts',
            'packages/cli/src/commands/team/legacy/team-run-store.ts',
            'tests/cli/team-legacy-patrol-contract-extraction.test.ts'
        ]
    }), 'intent-rft-0039');
    const backlogShard = makeIntent({
        taskId: 'ATM-GOV-0148',
        actorId: 'codex-gpt-5-5-captain',
        targetFiles: ['docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-15-202.json']
    });
    const decision = calculateBrokerDecision(backlogShard, registryWith([activeRft]));
    assert.equal(decision.verdict, 'parallel-safe');
    assert.equal(decision.conflictMatrix?.arbitrationVerdict, 'allow');
    assert.equal(decision.conflicts.length, 0);
    console.log('ok: live RFT Team surface does not block append-only backlog item shard');
}
function testGeneratedProjectionRebuildFreezesOnProjectionKey() {
    const activeProjection = activeFromIntent(makeIntent({
        taskId: 'TASK-PROJECTION-A',
        targetFiles: ['docs/governance/atm-bug-and-optimization-backlog.md']
    }), 'intent-projection-a');
    const secondProjection = makeIntent({
        taskId: 'TASK-PROJECTION-B',
        targetFiles: ['docs/governance/atm-bug-and-optimization-backlog.md']
    });
    const decision = calculateBrokerDecision(secondProjection, registryWith([activeProjection]));
    assert.equal(decision.verdict, 'blocked-shared-surface');
    assert.equal(decision.failureReason?.blockingLayer, 'shared-surface');
    assert.ok(decision.conflicts.some((conflict) => conflict.kind === 'projection' && conflict.detail.includes(GOVERNANCE_BACKLOG_PROJECTION)));
    console.log('ok: generated projection rebuild freezes on the projection key');
}
function testRunnerSyncCoalescesThroughStewardGenerator() {
    const activeBuild = activeFromIntent(makeIntent({
        taskId: 'TASK-BUILD-A',
        targetFiles: ['release/atm-onefile/atm.mjs'],
        runnerSyncRequired: true
    }), 'intent-build-a');
    const secondBuild = makeIntent({
        taskId: 'TASK-BUILD-B',
        targetFiles: ['release/atm-root-drop/release-manifest.json'],
        runnerSyncRequired: true
    });
    const decision = calculateBrokerDecision(secondBuild, registryWith([activeBuild]));
    assert.equal(decision.verdict, 'blocked-shared-surface');
    assert.ok(decision.conflicts.some((conflict) => conflict.kind === 'generator' && conflict.detail.includes(RUNNER_SYNC_STEWARD_GENERATOR)));
    assert.ok(decision.conflicts.some((conflict) => conflict.kind === 'artifact' && conflict.detail.includes(RELEASE_MIRROR_ARTIFACT)));
    console.log('ok: runner-sync/build requests coalesce through one steward generator key');
}
testPathProjection();
testLiveRftCaseAllowsBacklogItemShard();
testGeneratedProjectionRebuildFreezesOnProjectionKey();
testRunnerSyncCoalescesThroughStewardGenerator();
console.log('all global-resource projection tests passed');
