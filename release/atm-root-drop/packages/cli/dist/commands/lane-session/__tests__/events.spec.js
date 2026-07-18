import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runLane } from '../../lane.js';
import { appendLaneSessionEvent, historyLaneSessionEventsRootRelativePath, laneSessionEventDirectory, listLaneSessionEvents } from '../events.js';
import { mintLaneSession } from '../store.js';
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-lane-session-events-'));
try {
    const first = appendLaneSessionEvent({
        cwd: repo,
        laneId: 'lane-fixture',
        action: 'mint',
        actorId: 'agent-a',
        createdAt: '2026-07-16T00:00:00.000Z',
        details: { status: 'active' }
    });
    const second = appendLaneSessionEvent({
        cwd: repo,
        laneId: 'lane-fixture',
        action: 'heartbeat',
        actorId: 'agent-a',
        createdAt: '2026-07-16T00:00:01.000Z',
        details: { command: 'lane heartbeat' }
    });
    assert.match(first.event.eventId, /^2026-07-16T00-00-00-000Z-mint-[a-f0-9]{12}$/);
    assert.match(second.event.eventId, /^2026-07-16T00-00-01-000Z-heartbeat-[a-f0-9]{12}$/);
    assert.equal(first.event.sequence, 1);
    assert.equal(second.event.sequence, 2);
    assert.equal(first.eventPath.startsWith(`${historyLaneSessionEventsRootRelativePath}/lane-fixture/`), true);
    assert.ok(existsSync(path.join(repo, first.eventPath)));
    assert.ok(existsSync(path.join(repo, second.eventPath)));
    const events = listLaneSessionEvents(repo, 'lane-fixture');
    assert.deepEqual(events.map((event) => event.action), ['mint', 'heartbeat']);
    assert.deepEqual(events.map((event) => event.sequence), [1, 2]);
    assert.deepEqual(events.map((event) => event.createdAt), ['2026-07-16T00:00:00.000Z', '2026-07-16T00:00:01.000Z']);
    const eventDir = laneSessionEventDirectory(repo, 'lane-fixture');
    const residue = readdirSync(eventDir).filter((entry) => entry.includes('.tmp-'));
    assert.deepEqual(residue, [], 'event writes must not leave temp-file residue');
    mkdirSync(path.join(repo, '.atm/runtime/identity/actors'), { recursive: true });
    writeFileSync(path.join(repo, '.atm/runtime/identity/actors/agent-b.json'), `${JSON.stringify({
        schemaId: 'atm.identityDefault.v1',
        specVersion: '0.1.0',
        actorId: 'agent-b',
        editor: 'codex',
        gitName: 'Codex Agent B',
        gitEmail: 'codex-b@example.invalid',
        provider: 'openai',
        activeSessionId: 'session-b',
        updatedAt: '2026-07-16T00:02:30.000Z'
    }, null, 2)}\n`, 'utf8');
    mintLaneSession({
        cwd: repo,
        actorId: 'agent-a',
        laneId: 'lane-adopt-cli',
        ttlMs: 60_000,
        status: 'handoff',
        timestamp: '2026-07-16T00:02:00.000Z'
    });
    const adoptResult = runLane([
        'adopt',
        'lane-adopt-cli',
        '--cwd', repo,
        '--actor', 'agent-b',
        '--reason', 'handoff accepted',
        '--json'
    ]);
    assert.equal(adoptResult.ok, true);
    const adoptEvidence = adoptResult.evidence;
    assert.equal(adoptEvidence.action, 'adopt');
    assert.equal(adoptEvidence.laneSession.exportHint, 'export ATM_LANE_SESSION_ID="lane-adopt-cli"');
    assert.equal(adoptEvidence.session.status, 'adopted');
    assert.equal(adoptEvidence.event.action, 'adopt');
    assert.ok(existsSync(path.join(repo, adoptEvidence.eventPath)));
}
finally {
    rmSync(repo, { recursive: true, force: true });
}
console.log('[lane-session/events.spec] ok');
