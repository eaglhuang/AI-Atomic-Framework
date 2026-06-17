// TASK-MAO-0025: tests for the Team Wave Envelope.
import assert from 'node:assert/strict';
import { createTeamWaveEnvelope, validateTeamWaveEnvelope, closeReadyMembers } from '../team-wave-envelope.js';
function member(over) {
    return {
        taskId: over.taskId,
        workerActorId: over.workerActorId ?? `worker-${over.taskId}`,
        scopePaths: over.scopePaths ?? [`src/${over.taskId}.ts`],
        deliverables: over.deliverables ?? [`src/${over.taskId}.ts`],
        patchEnvelopeId: over.patchEnvelopeId ?? null,
        executionState: over.executionState
    };
}
function testValidEnvelopePasses() {
    const env = createTeamWaveEnvelope({
        coordinatorActorId: 'coord-1',
        targetRepo: 'repo-x',
        closureAuthority: 'target_repo',
        waveIndex: 0,
        members: [member({ taskId: 'T-A' }), member({ taskId: 'T-B' })]
    });
    assert.equal(env.schemaId, 'atm.teamWaveEnvelope.v1');
    assert.equal(validateTeamWaveEnvelope(env).ok, true);
}
function testEmptyMembersFails() {
    const env = createTeamWaveEnvelope({
        coordinatorActorId: 'coord-1',
        targetRepo: 'repo-x',
        closureAuthority: 'target_repo',
        waveIndex: 0,
        members: []
    });
    assert.equal(validateTeamWaveEnvelope(env).ok, false);
}
function testDuplicateDeliverableAcrossMembersFails() {
    const env = createTeamWaveEnvelope({
        coordinatorActorId: 'coord-1',
        targetRepo: 'repo-x',
        closureAuthority: 'target_repo',
        waveIndex: 0,
        members: [
            member({ taskId: 'T-A', deliverables: ['src/shared.ts'] }),
            member({ taskId: 'T-B', deliverables: ['src/shared.ts'] })
        ]
    });
    const result = validateTeamWaveEnvelope(env);
    assert.equal(result.ok, false);
    assert.match(result.reason, /shared\.ts/);
}
function testMissingCoordinatorFails() {
    const env = createTeamWaveEnvelope({
        coordinatorActorId: '   ',
        targetRepo: 'repo-x',
        closureAuthority: 'target_repo',
        waveIndex: 0,
        members: [member({ taskId: 'T-A' })]
    });
    assert.equal(validateTeamWaveEnvelope(env).ok, false);
}
function testCloseReadyMembersOnlyReturnsDone() {
    const env = createTeamWaveEnvelope({
        coordinatorActorId: 'coord-1',
        targetRepo: 'repo-x',
        closureAuthority: 'target_repo',
        waveIndex: 1,
        members: [
            member({ taskId: 'T-A', executionState: 'done' }),
            member({ taskId: 'T-B', executionState: 'blocked' }),
            member({ taskId: 'T-C', executionState: 'partial' })
        ]
    });
    const ready = closeReadyMembers(env);
    assert.equal(ready.length, 1);
    assert.equal(ready[0].taskId, 'T-A');
}
testValidEnvelopePasses();
testEmptyMembersFails();
testDuplicateDeliverableAcrossMembersFails();
testMissingCoordinatorFails();
testCloseReadyMembersOnlyReturnsDone();
console.log('team wave envelope tests: ok');
