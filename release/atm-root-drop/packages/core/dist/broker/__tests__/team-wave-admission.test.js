// TASK-MAO-0026: tests for Team Agents Wave Mode broker admission.
import assert from 'node:assert/strict';
import { admitWave } from '../team-wave-admission.js';
function card(over) {
    return {
        taskId: over.taskId,
        dependencies: over.dependencies ?? [],
        scopePaths: over.scopePaths ?? [`src/${over.taskId}.ts`],
        deliverables: over.deliverables ?? [`src/${over.taskId}.ts`],
        validators: over.validators ?? ['npm run typecheck'],
        targetRepo: over.targetRepo ?? 'repo-x',
        closureAuthority: over.closureAuthority ?? 'target_repo',
        ownerAtomOrMap: over.ownerAtomOrMap ?? null
    };
}
function intent(taskId, atomCid) {
    return {
        schemaId: 'atm.writeIntent.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'test' },
        taskId,
        actorId: `actor-${taskId}`,
        baseCommit: 'base',
        targetFiles: [`src/${taskId}.ts`],
        atomRefs: [{ atomId: `atom-${atomCid}`, atomCid, operation: 'modify' }],
        sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
        requestedLane: 'auto'
    };
}
function member(over) {
    return { card: over.card, writeIntent: over.writeIntent ?? null, hasWorkerReport: over.hasWorkerReport };
}
function testDisjointSafeWaveAdmitsAll() {
    const decision = admitWave({
        members: [member({ card: card({ taskId: 'T-A' }) }), member({ card: card({ taskId: 'T-B' }) })]
    });
    assert.equal(decision.ok, true);
    assert.deepEqual([...decision.admitted].sort(), ['T-A', 'T-B']);
    assert.equal(decision.rejected.length, 0);
}
function testUnsafeSameDeliverableRejectsSecond() {
    const decision = admitWave({
        members: [
            member({ card: card({ taskId: 'T-A', scopePaths: ['src/x.ts'], deliverables: ['src/x.ts'] }) }),
            member({ card: card({ taskId: 'T-B', scopePaths: ['src/x.ts'], deliverables: ['src/x.ts'] }) })
        ]
    });
    assert.deepEqual(decision.admitted, ['T-A']);
    assert.equal(decision.rejected[0].taskId, 'T-B');
    assert.ok(decision.rejected[0].categories.includes('cid-conflict'));
}
function testDependencyNotClosedIsRejected() {
    const decision = admitWave({
        members: [member({ card: card({ taskId: 'T-A', dependencies: ['T-OPEN'] }) })]
    });
    assert.equal(decision.ok, false);
    assert.ok(decision.rejected[0].categories.includes('dependency'));
}
function testClosedDependencyAdmits() {
    const decision = admitWave({
        members: [member({ card: card({ taskId: 'T-A', dependencies: ['T-DONE'] }) })],
        closedTaskIds: ['T-DONE']
    });
    assert.equal(decision.ok, true);
}
function testMissingWorkerReportRejectedWhenRequired() {
    const decision = admitWave({
        members: [member({ card: card({ taskId: 'T-A' }), hasWorkerReport: false })],
        requireWorkerReports: true
    });
    assert.ok(decision.rejected[0].categories.includes('missing-worker-report'));
}
function testCidWriteWriteOnSameAtomRejects() {
    const decision = admitWave({
        members: [
            member({ card: card({ taskId: 'T-A', scopePaths: ['a.ts'], deliverables: ['a.ts'] }), writeIntent: intent('T-A', 'cid-shared') }),
            member({ card: card({ taskId: 'T-B', scopePaths: ['b.ts'], deliverables: ['b.ts'] }), writeIntent: intent('T-B', 'cid-shared') })
        ]
    });
    assert.deepEqual(decision.admitted, ['T-A']);
    assert.ok(decision.rejected[0].categories.includes('cid-conflict'));
}
function testClosureAuthorityMismatchRejects() {
    const decision = admitWave({
        members: [
            member({ card: card({ taskId: 'T-A', closureAuthority: 'target_repo' }) }),
            member({ card: card({ taskId: 'T-B', closureAuthority: 'planning_repo' }) })
        ]
    });
    assert.deepEqual(decision.admitted, ['T-A']);
    assert.ok(decision.rejected[0].categories.includes('closure-authority'));
}
testDisjointSafeWaveAdmitsAll();
testUnsafeSameDeliverableRejectsSecond();
testDependencyNotClosedIsRejected();
testClosedDependencyAdmits();
testMissingWorkerReportRejectedWhenRequired();
testCidWriteWriteOnSameAtomRejects();
testClosureAuthorityMismatchRejects();
console.log('team wave admission tests: ok');
