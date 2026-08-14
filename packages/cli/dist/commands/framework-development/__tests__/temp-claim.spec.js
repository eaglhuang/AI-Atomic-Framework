import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFrameworkStaleCleanupCommand, buildFrameworkTempClaimCommand, classifyFrameworkStaleLock, isFrameworkStaleLockReleasable, runFrameworkTempClaim } from '../temp-claim.js';
import { createFrameworkModeStatus, runFrameworkMode } from '../closure-packet-schema.js';
function tempRoot() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'atm-temp-claim-'));
    mkdirSync(path.join(root, '.atm', 'runtime', 'locks'), { recursive: true });
    mkdirSync(path.join(root, '.atm', 'history', 'tasks'), { recursive: true });
    return root;
}
function writeLock(root, actorId, body) {
    const laneSessionId = typeof body.laneSessionId === 'string' ? body.laneSessionId : null;
    const laneSuffix = laneSessionId ? `-lane-${laneSessionId.replace(/[^A-Za-z0-9_-]+/g, '-')}` : '';
    writeFileSync(path.join(root, '.atm', 'runtime', 'locks', `ATM-FRAMEWORK-TEMP-${actorId}${laneSuffix}.lock.json`), JSON.stringify({
        actorId,
        lockedAt: '2026-06-14T00:00:00.000Z',
        ttlSeconds: 1,
        ...body
    }, null, 2));
}
function writeTask(root, taskId, status, extras = {}) {
    writeFileSync(path.join(root, '.atm', 'history', 'tasks', `${taskId}.json`), JSON.stringify({ id: taskId, workItemId: taskId, status, ...extras }, null, 2));
}
function writeLiveDirectionTask(root, taskId, laneSessionId) {
    writeTask(root, taskId, 'running', {
        claim: {
            actorId: 'agent-one',
            leaseId: `lease-${taskId}`,
            claimedAt: new Date().toISOString(),
            state: 'active',
            heartbeatAt: new Date().toISOString(),
            ttlSeconds: 3600,
            files: ['x.ts'],
            laneSession: { laneSessionId, status: 'adopted', source: 'test', exportHint: 'test' }
        }
    });
}
function initializeGitRoot(root) {
    execFileSync('git', ['init', '--quiet', root]);
}
function initializeFrameworkRoot(root) {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ai-atomic-framework' }), 'utf8');
    mkdirSync(path.join(root, 'packages', 'core', 'src'), { recursive: true });
    mkdirSync(path.join(root, 'packages', 'cli', 'src'), { recursive: true });
    writeFileSync(path.join(root, 'packages', 'core', 'src', 'index.ts'), '', 'utf8');
    writeFileSync(path.join(root, 'packages', 'cli', 'src', 'atm.ts'), '', 'utf8');
}
function writeDirectionLock(root, taskId, actorId, laneSessionId) {
    writeFileSync(path.join(root, '.atm', 'runtime', 'locks', `${taskId}.lock.json`), JSON.stringify({
        taskDirectionLock: {
            schemaId: 'atm.taskDirectionLock.v1',
            specVersion: '0.1.0',
            taskId,
            batchId: null,
            scopeKey: null,
            queueId: null,
            queueIndex: null,
            allowedFiles: ['x.ts'],
            planningReadOnlyPaths: [],
            planningMirrorPaths: [],
            allowPlanningMirror: false,
            promptHash: null,
            actorId,
            sessionId: null,
            ...(laneSessionId ? { laneSession: { laneSessionId, status: 'active', source: 'test', exportHint: 'test' } } : {}),
            createdAt: '2026-08-10T00:00:00.000Z',
            status: 'active'
        }
    }, null, 2));
}
const claimCommand = buildFrameworkTempClaimCommand(['b.ts', 'a.ts'], 'unit test', 'agent one');
assert.match(claimCommand, /framework-mode claim/);
assert.match(claimCommand, /--actor "agent one"/);
assert.match(claimCommand, /--files "a.ts,b.ts"/);
{
    const root = tempRoot();
    assert.equal(classifyFrameworkStaleLock(root, 'agent-one'), null);
}
{
    const root = tempRoot();
    writeLock(root, 'agent-one', {
        linkedTaskId: 'TASK-DONE',
        heartbeatAt: '2026-06-14T00:00:00.000Z'
    });
    writeTask(root, 'TASK-DONE', 'done');
    const staleLock = classifyFrameworkStaleLock(root, 'agent-one');
    assert.equal(staleLock?.kind, 'stale-completed');
    assert.equal(isFrameworkStaleLockReleasable(staleLock), true);
    assert.match(buildFrameworkStaleCleanupCommand(staleLock, ['x.ts'], 'continue'), /framework-mode release/);
}
{
    const root = tempRoot();
    writeLock(root, 'agent-one', {
        linkedTaskId: 'TASK-RUNNING',
        heartbeatAt: new Date().toISOString(),
        ttlSeconds: 3600
    });
    writeTask(root, 'TASK-RUNNING', 'running');
    const staleLock = classifyFrameworkStaleLock(root, 'agent-one');
    assert.equal(staleLock?.kind, 'still-active');
    assert.equal(isFrameworkStaleLockReleasable(staleLock), false);
}
{
    const root = tempRoot();
    writeLock(root, 'agent-one', {
        heartbeatAt: '2026-06-14T00:00:00.000Z',
        ttlSeconds: 1
    });
    const staleLock = classifyFrameworkStaleLock(root, 'agent-one');
    assert.equal(staleLock?.kind, 'stale-ttl-expired');
    assert.equal(isFrameworkStaleLockReleasable(staleLock), true);
}
{
    const root = tempRoot();
    writeLock(root, 'agent-one', {
        workItemId: 'ATM-FRAMEWORK-TEMP-agent-one',
        lockedBy: 'agent-one',
        heartbeatAt: new Date().toISOString(),
        ttlSeconds: 3600
    });
    const staleLock = classifyFrameworkStaleLock(root, 'agent-one');
    assert.equal(staleLock, null, 'same-actor unlabeled temp lock must be reusable for scope refresh');
}
{
    const root = tempRoot();
    writeLock(root, 'agent-one', {
        workItemId: 'ATM-FRAMEWORK-TEMP-agent-one-lane-lane-a',
        lockedBy: 'agent-one',
        laneSessionId: 'lane-a',
        heartbeatAt: new Date().toISOString(),
        ttlSeconds: 3600
    });
    writeLock(root, 'agent-one', {
        workItemId: 'ATM-FRAMEWORK-TEMP-agent-one-lane-lane-b',
        lockedBy: 'agent-one',
        laneSessionId: 'lane-b',
        heartbeatAt: new Date().toISOString(),
        ttlSeconds: 3600
    });
    assert.equal(classifyFrameworkStaleLock(root, 'agent-one', { laneSessionId: 'lane-a' }), null, 'lane-a must reuse only its own lane-scoped framework temp lock');
    assert.equal(classifyFrameworkStaleLock(root, 'agent-one', { laneSessionId: 'lane-b' }), null, 'lane-b must reuse only its own lane-scoped framework temp lock');
    assert.equal(classifyFrameworkStaleLock(root, 'agent-one'), null, 'legacy actor-only lookup must not collide with lane-scoped locks');
}
{
    const root = tempRoot();
    writeLock(root, 'agent-one', {
        linkedTaskId: 'TASK-DONE',
        laneSessionId: 'lane-a',
        heartbeatAt: '2026-06-14T00:00:00.000Z'
    });
    writeTask(root, 'TASK-DONE', 'done');
    const staleLock = classifyFrameworkStaleLock(root, 'agent-one', { laneSessionId: 'lane-a' });
    assert.equal(staleLock?.kind, 'stale-completed');
    assert.equal(staleLock?.laneSessionId, 'lane-a');
    assert.match(staleLock?.detail ?? '', /lane lane-a/);
    assert.match(buildFrameworkStaleCleanupCommand(staleLock, ['x.ts'], 'continue'), /--lane-session "lane-a"/);
}
{
    const root = tempRoot();
    writeDirectionLock(root, 'TASK-A', 'agent-one', 'lane-a');
    writeDirectionLock(root, 'TASK-B', 'agent-one', 'lane-b');
    writeLock(root, 'agent-one', {
        workItemId: 'ATM-FRAMEWORK-TEMP-agent-one-lane-lane-a',
        linkedTaskId: 'TASK-A',
        laneSessionId: 'lane-a',
        heartbeatAt: new Date().toISOString(),
        ttlSeconds: 3600
    });
    writeLiveDirectionTask(root, 'TASK-A', 'lane-a');
    writeLiveDirectionTask(root, 'TASK-B', 'lane-b');
    assert.equal(classifyFrameworkStaleLock(root, 'agent-one', { laneSessionId: 'lane-a' }), null, 'stale-lock audit must resolve the task inside the lock lane instead of treating other lanes as ambiguous');
}
{
    const root = tempRoot();
    writeDirectionLock(root, 'TASK-A', 'agent-one', 'lane-a');
    writeDirectionLock(root, 'TASK-B', 'agent-one', 'lane-b');
    writeLock(root, 'agent-one', {
        workItemId: 'ATM-FRAMEWORK-TEMP-agent-one',
        linkedTaskId: 'TASK-A',
        heartbeatAt: new Date().toISOString(),
        ttlSeconds: 3600
    });
    writeLiveDirectionTask(root, 'TASK-A', 'lane-a');
    writeLiveDirectionTask(root, 'TASK-B', 'lane-b');
    const legacyLock = classifyFrameworkStaleLock(root, 'agent-one');
    assert.equal(legacyLock?.kind, 'still-active');
    assert.equal(legacyLock?.currentTaskId, null);
    assert.equal(legacyLock?.linkedTaskId, 'TASK-A', 'read-only stale-lock audit must retain durable linkage without guessing among active lanes');
}
{
    const root = tempRoot();
    initializeGitRoot(root);
    writeDirectionLock(root, 'TASK-A', 'agent-one', 'lane-a');
    writeLiveDirectionTask(root, 'TASK-A', 'lane-a');
    const result = await runFrameworkTempClaim(root, 'agent-one', ['x.ts'], 'unit test', 'TASK-A', 'lane-a');
    assert.equal(result.ok, true);
    assert.equal(result.evidence.linkedTaskId, 'TASK-A');
}
{
    const root = tempRoot();
    initializeGitRoot(root);
    writeDirectionLock(root, 'TASK-EXACT', 'agent-one', '');
    writeTask(root, 'TASK-EXACT', 'running', {
        claim: {
            actorId: 'agent-one',
            leaseId: 'lease-TASK-EXACT',
            claimedAt: new Date().toISOString(),
            state: 'active',
            heartbeatAt: new Date().toISOString(),
            ttlSeconds: 3600,
            files: ['x.ts'],
            laneSession: { laneSessionId: 'lane-a', status: 'adopted', source: 'test', exportHint: 'test' }
        }
    });
    const result = await runFrameworkTempClaim(root, 'agent-one', ['x.ts'], 'unit test', 'TASK-EXACT', 'lane-a');
    assert.equal(result.evidence.linkedTaskId, 'TASK-EXACT', 'the live claim must complete a legacy direction projection into the exact canonical authority snapshot');
}
{
    const root = tempRoot();
    initializeGitRoot(root);
    writeDirectionLock(root, 'TASK-MISMATCHED', 'agent-one', 'lane-b');
    writeLiveDirectionTask(root, 'TASK-MISMATCHED', 'lane-a');
    await assert.rejects(() => runFrameworkTempClaim(root, 'agent-one', ['x.ts'], 'unit test', 'TASK-MISMATCHED', 'lane-a'), (error) => Boolean(error && typeof error === 'object' && error.code === 'ATM_FRAMEWORK_TEMP_CLAIM_TASK_BINDING_INVALID'), 'a projection that disagrees with the live claim lane must fail closed');
}
{
    const root = tempRoot();
    initializeGitRoot(root);
    writeDirectionLock(root, 'TASK-A', 'agent-one', 'lane-a');
    writeLiveDirectionTask(root, 'TASK-A', 'lane-a');
    await assert.rejects(async () => await runFrameworkMode(['claim', '--cwd', root, '--actor', 'agent-one', '--task', 'TASK-B', '--files', 'x.ts', '--lane-session', 'lane-a']), (error) => Boolean(error && typeof error === 'object' && error.code === 'ATM_FRAMEWORK_TEMP_CLAIM_TASK_BINDING_INVALID'), 'an explicit task must be proved by the actor and lane rather than trusted blindly');
}
{
    const root = tempRoot();
    initializeGitRoot(root);
    writeDirectionLock(root, 'TASK-A', 'agent-one', 'lane-a');
    writeDirectionLock(root, 'TASK-B', 'agent-one', 'lane-a');
    writeLiveDirectionTask(root, 'TASK-A', 'lane-a');
    writeLiveDirectionTask(root, 'TASK-B', 'lane-a');
    await assert.rejects(() => runFrameworkTempClaim(root, 'agent-one', ['x.ts'], 'unit test', null, 'lane-a'), (error) => Boolean(error && typeof error === 'object' && error.code === 'ATM_FRAMEWORK_TEMP_CLAIM_TASK_BINDING_AMBIGUOUS'), 'multiple active tasks in one lane must fail closed rather than choose by recency');
}
{
    const root = tempRoot();
    initializeFrameworkRoot(root);
    writeDirectionLock(root, 'TASK-A', 'agent-one', 'lane-a');
    writeDirectionLock(root, 'TASK-B', 'agent-one', 'lane-a');
    writeLock(root, 'agent-one', {
        linkedTaskId: 'TASK-A',
        heartbeatAt: new Date().toISOString(),
        ttlSeconds: 3600
    });
    writeLiveDirectionTask(root, 'TASK-A', 'lane-a');
    writeLiveDirectionTask(root, 'TASK-B', 'lane-a');
    const report = createFrameworkModeStatus({
        cwd: root,
        files: ['packages/cli/src/atm.ts'],
        taskId: 'TASK-A',
        actorId: 'agent-one'
    });
    assert.deepEqual(report.activeLocks, ['.atm/runtime/locks/TASK-A.lock.json']);
    assert.equal(report.staleLocks.length, 0, 'a known committing task must not be blocked by another active task direction');
}
