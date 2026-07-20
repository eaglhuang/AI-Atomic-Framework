import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBroker } from '../broker.js';
import { runNext } from '../next.js';
import { evaluateBrokerQueueAdmission } from '../next/broker-queue-admission.js';
function intent(taskId, actorId, files) {
    return {
        schemaId: 'atm.writeIntent.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'broker workflow test' },
        taskId,
        actorId,
        baseCommit: 'same-test-base',
        targetFiles: files,
        atomRefs: [],
        sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
        requestedLane: 'auto'
    };
}
async function register(cwd, value) {
    const intentPath = path.join(cwd, `${value.taskId}.intent.json`);
    writeFileSync(intentPath, `${JSON.stringify(value)}\n`, 'utf8');
    return runBroker(['register', '--cwd', cwd, '--task', value.taskId, '--actor', value.actorId, '--intent-file', intentPath]);
}
async function testQueueFreezeAckReleaseWorkflow() {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-queue-'));
    try {
        const owner = intent('TASK-OWNER', 'owner-agent', ['src/shared.ts', 'src/owner-private.ts']);
        const waiter = intent('TASK-WAITER', 'waiter-agent', ['src/shared.ts', 'src/waiter-private.ts']);
        await register(cwd, owner);
        const queued = await register(cwd, waiter);
        assert.equal(queued.ok, true, 'a waiter with private paths is admitted instead of reported as globally blocked');
        assert.equal(queued.evidence.queueAdmission.status, 'queued-private-work');
        assert.deepEqual(queued.evidence.queueAdmission.allowedFiles, ['src/waiter-private.ts']);
        const freezes = queued.evidence.sharedSurfaceFreezes;
        assert.equal(freezes.length, 1, 'a queued shared file must notify its current holder exactly once');
        assert.equal(freezes[0].signal.taskId, 'TASK-OWNER');
        assert.equal(freezes[0].waitingTaskId, 'TASK-WAITER');
        assert.equal(freezes[0].requiredNextAction, 'publish-patch-proposal-or-release');
        const blocked = evaluateBrokerQueueAdmission({
            cwd,
            taskId: 'TASK-WAITER',
            allowedFiles: waiter.targetFiles,
            overlappingFiles: ['src/shared.ts']
        });
        assert.equal(blocked.status, 'queued-private-work');
        assert.deepEqual(blocked.allowedFiles, ['src/waiter-private.ts']);
        const freezeId = freezes[0].signal.freezeId;
        await assert.rejects(() => runBroker(['acknowledge', '--cwd', cwd, '--task', 'TASK-WAITER', '--actor', 'waiter-agent', '--freeze-id', freezeId]), (error) => error.code === 'ATM_BROKER_FREEZE_ACK_FORBIDDEN');
        const acknowledged = await runBroker(['acknowledge', '--cwd', cwd, '--task', 'TASK-OWNER', '--actor', 'owner-agent', '--freeze-id', freezeId]);
        assert.equal(acknowledged.evidence.freeze.status, 'acknowledged');
        await runBroker(['release', '--cwd', cwd, '--task', 'TASK-OWNER']);
        const unblocked = evaluateBrokerQueueAdmission({
            cwd,
            taskId: 'TASK-WAITER',
            allowedFiles: waiter.targetFiles,
            overlappingFiles: ['src/shared.ts']
        });
        assert.equal(unblocked.status, 'queue-head');
        const freezeDocument = JSON.parse(readFileSync(path.join(cwd, '.atm/runtime/broker-shared-surface-freezes.json'), 'utf8'));
        assert.equal(freezeDocument.records[0].status, 'released');
        console.log('ok: shared file queues, notifies, acknowledges, and releases without blocking private work');
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}
async function testBaseMismatchFailsClosed() {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-base-mismatch-'));
    try {
        await register(cwd, intent('TASK-BASE-ONE', 'base-one', ['src/shared.ts']));
        const mismatched = { ...intent('TASK-BASE-TWO', 'base-two', ['src/shared.ts']), baseCommit: 'different-test-base' };
        await assert.rejects(() => register(cwd, mismatched), (error) => error.code === 'ATM_BROKER_SHARED_QUEUE_BLOCKED');
        console.log('ok: base-hash mismatch fails closed instead of inventing a queue order');
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}
async function testSharedOnlyWaiterIsBlocked() {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-shared-only-'));
    try {
        await register(cwd, intent('TASK-HEAD', 'head-agent', ['src/shared-only.ts']));
        const waiter = intent('TASK-BLOCKED', 'blocked-agent', ['src/shared-only.ts']);
        const queued = await register(cwd, waiter);
        assert.equal(queued.ok, false, 'a waiter with no private path must remain fail-closed');
        assert.equal(queued.evidence.queueAdmission.status, 'queued-blocked');
        const admission = evaluateBrokerQueueAdmission({
            cwd,
            taskId: waiter.taskId,
            allowedFiles: waiter.targetFiles,
            overlappingFiles: waiter.targetFiles
        });
        assert.equal(admission.status, 'queued-blocked');
        assert.equal(admission.waitingOn[0]?.queueHeadTaskId, 'TASK-HEAD');
        assert.equal(admission.waitingOn[0]?.surfacePath, 'src/shared-only.ts');
        console.log('ok: a task with only queued shared files remains fail-closed');
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}
async function testWaitingTaskCanAbandonWithoutLeavingGhostQueueEntry() {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-abandon-'));
    try {
        await register(cwd, intent('TASK-OWNER', 'owner-agent', ['src/shared.ts']));
        await register(cwd, intent('TASK-WAITER', 'waiter-agent', ['src/shared.ts', 'src/private.ts']));
        await runBroker(['release', '--cwd', cwd, '--task', 'TASK-WAITER']);
        const queueDocument = JSON.parse(readFileSync(path.join(cwd, '.atm/runtime/broker-shared-surface-queues.json'), 'utf8'));
        assert.deepEqual(queueDocument.queues[0].entries.map((entry) => entry.taskId), ['TASK-OWNER']);
        console.log('ok: a waiting task can abandon without leaving a ghost shared-surface queue entry');
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}
async function testDisjointFilesRemainParallel() {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-parallel-'));
    try {
        await register(cwd, intent('TASK-LEFT', 'left-agent', ['src/left.ts']));
        const result = await register(cwd, intent('TASK-RIGHT', 'right-agent', ['src/right.ts']));
        assert.deepEqual(result.evidence.sharedSurfaceQueues, []);
        assert.deepEqual(result.evidence.sharedSurfaceFreezes, []);
        console.log('ok: disjoint files remain parallel and do not issue a freeze');
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}
async function testNextClaimExcludesQueuedPathsFromDirectionLock() {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-next-queue-claim-'));
    try {
        execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.name', 'ATM Fixture'], { cwd, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd, stdio: 'ignore' });
        writeFixtureJson(cwd, '.atm/config.json', { schemaVersion: 'atm.config.v0.1', layoutVersion: 2, taskLedger: { enabled: true, mode: 'auto', requireCliTransitions: true } });
        writeFixtureJson(cwd, '.atm/runtime/identity/default.json', { actorId: 'waiter-agent', gitName: 'ATM Fixture', gitEmail: 'fixture@example.invalid', updatedAt: '2026-07-12T00:00:00.000Z' });
        writeFixtureJson(cwd, '.atm/history/tasks/TASK-OWNER.json', taskDocument('TASK-OWNER', 'running', ['src/shared.ts']));
        writeFixtureJson(cwd, '.atm/history/tasks/TASK-WAITER.json', taskDocument('TASK-WAITER', 'ready', ['src/shared.ts', 'src/private.ts']));
        writeFixtureJson(cwd, '.atm/runtime/broker-shared-surface-queues.json', {
            schemaId: 'atm.brokerSharedSurfaceQueues.v1',
            queues: [{ schemaId: 'atm.brokerSharedSurfaceQueue.v1', surfacePath: 'src/shared.ts', entries: [
                        { taskId: 'TASK-OWNER', actorId: 'owner-agent', surfacePath: 'src/shared.ts', leaseEpoch: 1, baseHash: 'fixture-base', reason: 'owner', releaseCondition: 'owner release', queuedAt: '2026-07-12T00:00:00.000Z' },
                        { taskId: 'TASK-WAITER', actorId: 'waiter-agent', surfacePath: 'src/shared.ts', leaseEpoch: 2, baseHash: 'fixture-base', reason: 'waiter', releaseCondition: 'owner release', queuedAt: '2026-07-12T00:01:00.000Z' }
                    ] }]
        });
        mkdirSync(path.join(cwd, 'src'), { recursive: true });
        writeFileSync(path.join(cwd, 'src/shared.ts'), 'export const shared = true;\n');
        writeFileSync(path.join(cwd, 'src/private.ts'), 'export const privateFile = true;\n');
        execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
        execFileSync('git', ['commit', '-m', 'fixture base'], { cwd, stdio: 'ignore' });
        const fixtureHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
        const queuePath = path.join(cwd, '.atm/runtime/broker-shared-surface-queues.json');
        const queueDocument = JSON.parse(readFileSync(queuePath, 'utf8'));
        for (const entry of queueDocument.queues[0].entries)
            entry.baseHash = fixtureHead;
        writeFileSync(queuePath, `${JSON.stringify(queueDocument, null, 2)}\n`, 'utf8');
        const result = await runNext(['--cwd', cwd, '--claim', '--task', 'TASK-WAITER', '--actor', 'waiter-agent', '--claim-intent', 'write']);
        assert.equal(result.ok, true, 'queue-admitted private work must reach the actual next claim path');
        assert.equal(result.evidence.preClaimBrokerTransaction.queueAdmission.status, 'queued-private-work');
        assert.ok(result.evidence.nextAction.brokerQueueAdmission, JSON.stringify(result.evidence.nextAction, null, 2));
        assert.equal(result.evidence.nextAction.brokerQueueAdmission.status, 'queued-private-work');
        const directionLockFiles = result.evidence.nextAction.taskDirectionLock.allowedFiles;
        assert.equal(directionLockFiles.includes('src/private.ts'), true);
        assert.equal(directionLockFiles.includes('src/shared.ts'), false);
        console.log('ok: next claim writes a direction lock that excludes queued shared paths');
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}
function taskDocument(taskId, status, scopePaths) {
    return {
        schemaVersion: 'atm.workItem.v0.2', workItemId: taskId, title: taskId, status,
        scopePaths, deliverables: scopePaths, targetAllowedFiles: scopePaths,
        targetRepo: 'fixture', closureAuthority: 'target_repo', source: { planPath: null }
    };
}
function writeFixtureJson(cwd, relativePath, value) {
    const filePath = path.join(cwd, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
await testQueueFreezeAckReleaseWorkflow();
await testDisjointFilesRemainParallel();
await testBaseMismatchFailsClosed();
await testSharedOnlyWaiterIsBlocked();
await testWaitingTaskCanAbandonWithoutLeavingGhostQueueEntry();
await testNextClaimExcludesQueuedPathsFromDirectionLock();
