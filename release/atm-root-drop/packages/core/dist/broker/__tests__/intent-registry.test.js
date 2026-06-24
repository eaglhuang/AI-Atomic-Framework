import assert from 'node:assert/strict';
import { registerIntent, renewIntentLease, releaseTask } from '../registry.js';
function emptyRegistry() {
    return {
        schemaId: 'atm.writeBrokerRegistry.v1',
        specVersion: '0.1.0',
        repoId: 'test-repo',
        workspaceId: 'test-workspace',
        activeIntents: []
    };
}
function makeIntent(overrides = {}) {
    return {
        schemaId: 'atm.writeIntent.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'test' },
        taskId: 'TASK-LEASE-001',
        actorId: 'agent-a',
        baseCommit: 'abc123',
        targetFiles: ['src/lease.ts'],
        atomRefs: [
            {
                atomId: 'atom-lease',
                atomCid: 'cid-lease',
                operation: 'modify'
            }
        ],
        sharedSurfaces: {
            generators: [],
            projections: [],
            registries: [],
            validators: [],
            artifacts: []
        },
        requestedLane: 'auto',
        leaseBounds: {
            requestedSeconds: 300,
            maxSeconds: 600
        },
        ...overrides
    };
}
function testRegisterIntentEncodesLeaseBounds() {
    const registry = registerIntent(emptyRegistry(), makeIntent({
        proposalAdmission: {
            trigger: 'hot-file',
            summarySubmitted: true,
            hotFiles: ['src/lease.ts']
        }
    }), 'direct-brokered', 300);
    assert.equal(registry.activeIntents.length, 1);
    const [active] = registry.activeIntents;
    assert.equal(active.taskId, 'TASK-LEASE-001');
    assert.equal(active.leaseSeconds, 300);
    assert.equal(active.leaseMaxSeconds, 600);
    assert.equal(typeof active.heartbeatAt, 'string');
    assert.ok(active.expiresAt);
    assert.equal(active.admission?.state, 'proposal-submitted');
    console.log('ok: registerIntent encodes lease bounds and heartbeat');
}
function testRegisterIntentPersistsReadSetKeys() {
    const registry = registerIntent(emptyRegistry(), makeIntent({
        readAtoms: [
            {
                atomId: 'atom-read',
                atomCid: 'cid-read',
                operation: 'modify'
            }
        ]
    }), 'direct-brokered', 300);
    const [active] = registry.activeIntents;
    assert.deepEqual(active.resourceKeys.readAtomIds, ['atom-read']);
    assert.deepEqual(active.resourceKeys.readAtomCids, ['cid-read']);
    console.log('ok: registerIntent persists read-set resource keys');
}
function testRegisterIntentDefaultsMissingReadSetKeysToEmptyLists() {
    const registry = registerIntent(emptyRegistry(), makeIntent(), 'direct-brokered', 300);
    const [active] = registry.activeIntents;
    assert.deepEqual(active.resourceKeys.readAtomIds, []);
    assert.deepEqual(active.resourceKeys.readAtomCids, []);
    console.log('ok: registerIntent defaults missing read-set keys to empty lists');
}
function testRegisterIntentFailsClosedOnLeaseOverflow() {
    assert.throws(() => registerIntent(emptyRegistry(), makeIntent({
        leaseBounds: {
            requestedSeconds: 900,
            maxSeconds: 600
        }
    }), 'direct-brokered', 900), /exceeds leaseMaxSeconds/i);
    console.log('ok: registerIntent fails closed when requested lease exceeds max');
}
function testRenewIntentLease() {
    const registry = registerIntent(emptyRegistry(), makeIntent(), 'direct-brokered', 300);
    const renewed = renewIntentLease(registry, 'TASK-LEASE-001', 'agent-a', 900);
    const [active] = renewed.activeIntents;
    assert.equal(active.leaseSeconds, 600, 'renewal must clamp to the declared lease max');
    assert.ok(active.heartbeatAt.length > 0);
    assert.ok(active.expiresAt);
    console.log('ok: renewIntentLease clamps to lease max and updates heartbeat');
}
function testRenewIntentLeaseIgnoresMismatchedActor() {
    const registry = registerIntent(emptyRegistry(), makeIntent(), 'direct-brokered', 300);
    const renewed = renewIntentLease(registry, 'TASK-LEASE-001', 'agent-b', 900);
    assert.deepEqual(renewed, registry);
    console.log('ok: renewIntentLease ignores mismatched actor');
}
function testReleaseTask() {
    const registry = registerIntent(emptyRegistry(), makeIntent(), 'direct-brokered', 300);
    const released = releaseTask(registry, 'TASK-LEASE-001');
    assert.equal(released.activeIntents.length, 0);
    console.log('ok: releaseTask removes task intents');
}
testRegisterIntentEncodesLeaseBounds();
testRegisterIntentPersistsReadSetKeys();
testRegisterIntentDefaultsMissingReadSetKeysToEmptyLists();
testRegisterIntentFailsClosedOnLeaseOverflow();
testRenewIntentLease();
testRenewIntentLeaseIgnoresMismatchedActor();
testReleaseTask();
console.log('all broker intent-registry tests passed');
