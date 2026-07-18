import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  adoptLaneSession,
  classifyLaneSessionTtl,
  hashHandoffToken,
  mintLaneSession,
  readLaneSession,
  runtimeLaneSessionsRootRelativePath
} from '../store.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-lane-session-store-'));

try {
  writeJson(path.join(repo, '.atm/runtime/identity/actors/agent-a.json'), {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId: 'agent-a',
    editor: 'codex',
    gitName: 'Codex Agent',
    gitEmail: 'codex@example.invalid',
    provider: 'openai',
    activeSessionId: 'session-a',
    updatedAt: '2026-07-16T00:00:00.000Z'
  });

  const minted = mintLaneSession({
    cwd: repo,
    actorId: 'agent-a',
    taskId: 'TASK-LANE-0010',
    laneId: 'lane-fixture',
    ttlMs: 60_000,
    timestamp: '2026-07-16T00:00:00.000Z',
    handoffToken: 'secret-token',
    lastCommand: {
      command: 'node atm.mjs lane status --json',
      executedAt: '2026-07-16T00:00:01.000Z',
      exitCode: 0
    }
  });

  assert.equal(minted.sessionPath, '.atm/runtime/lane-sessions/lane-fixture.json');
  assert.equal(minted.session.schemaId, 'atm.laneSession.v1');
  assert.equal(minted.session.identity.editor, 'codex');
  assert.equal(minted.session.identity.gitEmail, 'codex@example.invalid');
  assert.equal(minted.session.handoffTokenHash, hashHandoffToken('secret-token'));
  assert.equal(minted.session.lastCommand?.command, 'node atm.mjs lane status --json');

  const readBack = readLaneSession(repo, 'lane-fixture');
  assert.deepEqual(readBack, minted.session, 'mint/read must preserve lane session document');

  assert.equal(
    classifyLaneSessionTtl({ now: '2026-07-16T00:00:30.000Z', expiresAt: minted.session.expiresAt, graceMs: 10_000 }),
    'fresh'
  );
  assert.equal(
    classifyLaneSessionTtl({ now: '2026-07-16T00:01:05.000Z', expiresAt: minted.session.expiresAt, graceMs: 10_000 }),
    'grace'
  );
  assert.equal(
    classifyLaneSessionTtl({ now: '2026-07-16T00:01:11.000Z', expiresAt: minted.session.expiresAt, graceMs: 10_000 }),
    'expired'
  );

  const storeDir = path.join(repo, runtimeLaneSessionsRootRelativePath);
  const residue = readdirSync(storeDir).filter((entry) => entry.includes('.tmp-'));
  assert.deepEqual(residue, [], 'atomic write must not leave temp-file residue');
  assert.ok(existsSync(path.join(storeDir, 'lane-fixture.json')));
  assert.match(readFileSync(path.join(storeDir, 'lane-fixture.json'), 'utf8'), /"schemaId": "atm\.laneSession\.v1"/);

  const adoptable = mintLaneSession({
    cwd: repo,
    actorId: 'agent-a',
    laneId: 'lane-adoptable',
    ttlMs: 60_000,
    status: 'handoff',
    timestamp: '2026-07-16T00:02:00.000Z'
  });
  writeJson(path.join(repo, '.atm/runtime/identity/actors/agent-b.json'), {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId: 'agent-b',
    editor: 'codex',
    gitName: 'Codex Agent B',
    gitEmail: 'codex-b@example.invalid',
    provider: 'openai',
    activeSessionId: 'session-b',
    updatedAt: '2026-07-16T00:02:30.000Z'
  });

  const adopted = adoptLaneSession({
    cwd: repo,
    laneId: adoptable.session.laneId,
    actorId: 'agent-b',
    reason: 'handoff accepted',
    timestamp: '2026-07-16T00:03:00.000Z'
  });
  assert.equal(adopted.ok, true);
  assert.equal(adopted.session.status, 'adopted');
  assert.equal(adopted.session.actorId, 'agent-b');
  assert.equal(adopted.session.identity.gitEmail, 'codex-b@example.invalid');
  assert.equal(adopted.session.adoptionSource.kind, 'adoption');
  assert.equal(adopted.session.adoptionSource.sourceLaneId, 'lane-adoptable');
  assert.equal(adopted.session.adoptionSource.sourceActorId, 'agent-a');
  assert.equal(adopted.session.adoptionSource.reason, 'handoff accepted');
  assert.equal(adopted.previousSession.status, 'handoff');
  assert.equal(readLaneSession(repo, 'lane-adoptable')?.status, 'adopted');

  mintLaneSession({
    cwd: repo,
    actorId: 'agent-a',
    laneId: 'lane-closed',
    ttlMs: 60_000,
    status: 'released',
    timestamp: '2026-07-16T00:04:00.000Z'
  });
  const closedAdoption = adoptLaneSession({
    cwd: repo,
    laneId: 'lane-closed',
    actorId: 'agent-b',
    timestamp: '2026-07-16T00:05:00.000Z'
  });
  assert.equal(closedAdoption.ok, false);
  assert.equal(closedAdoption.reason, 'closed');

  const unknownAdoption = adoptLaneSession({
    cwd: repo,
    laneId: 'lane-missing',
    actorId: 'agent-b',
    timestamp: '2026-07-16T00:06:00.000Z'
  });
  assert.equal(unknownAdoption.ok, false);
  assert.equal(unknownAdoption.reason, 'not-found');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('[lane-session/store.spec] ok');
