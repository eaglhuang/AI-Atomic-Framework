import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFrameworkStaleCleanupCommand, buildFrameworkTempClaimCommand, classifyFrameworkStaleLock, isFrameworkStaleLockReleasable } from '../temp-claim.js';
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
function writeTask(root, taskId, status) {
    writeFileSync(path.join(root, '.atm', 'history', 'tasks', `${taskId}.json`), JSON.stringify({ id: taskId, workItemId: taskId, status }, null, 2));
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
