import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runLane } from '../../packages/cli/src/commands/lane.ts';
import { mintLaneSession } from '../../packages/cli/src/commands/lane-session/store.ts';
import { upsertActorWorkSession } from '../../packages/cli/src/commands/actor-session.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-lane-adopt-phase-'));

function writeJson(relativePath: string, value: unknown): void {
  const absolutePath = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

try {
  mkdirSync(path.join(repo, '.atm/runtime/identity/actors'), { recursive: true });
  writeJson('.atm/runtime/identity/actors/agent-b.json', {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId: 'agent-b',
    editor: 'cursor',
    gitName: 'Agent B',
    gitEmail: 'agent-b@example.invalid',
    provider: 'cursor',
    activeSessionId: null,
    updatedAt: '2026-07-18T00:00:00.000Z'
  });

  const fresh = mintLaneSession({
    cwd: repo,
    actorId: 'agent-a',
    laneId: 'lane-fresh',
    ttlMs: 86_400_000,
    status: 'active',
    timestamp: new Date().toISOString()
  });

  assert.throws(
    () => runLane(['adopt', fresh.session.laneId, '--cwd', repo, '--actor', 'agent-b', '--json']),
    (error: unknown) => {
      assert.ok(error && typeof error === 'object');
      assert.equal((error as { code?: string }).code, 'ATM_LANE_SESSION_NOT_STALE');
      return true;
    }
  );

  const staleStamp = new Date(Date.now() - 60_000).toISOString();
  const stale = mintLaneSession({
    cwd: repo,
    actorId: 'agent-a',
    laneId: 'lane-stale',
    taskId: 'TASK-ADOPT-1',
    ttlMs: 1_000,
    status: 'active',
    timestamp: staleStamp
  });
  writeJson('.atm/history/tasks/TASK-ADOPT-1.json', {
    schemaId: 'atm.task.v1',
    workItemId: 'TASK-ADOPT-1',
    title: 'TASK-ADOPT-1',
    status: 'running',
    scope: ['scratch/TASK-ADOPT-1.ts'],
    claim: {
      actorId: 'agent-a',
      leaseId: 'lease-adopt-1',
      claimedAt: '2026-07-18T00:00:00.000Z',
      heartbeatAt: '2026-07-18T00:00:00.000Z',
      ttlSeconds: 3600,
      files: ['scratch/TASK-ADOPT-1.ts'],
      state: 'active',
      intent: 'write',
      laneSession: {
        laneSessionId: 'lane-stale',
        status: 'active',
        source: 'env',
        exportHint: 'export ATM_LANE_SESSION_ID="lane-stale"'
      }
    }
  });
  upsertActorWorkSession({
    cwd: repo,
    sessionId: 'session-adopt-1',
    actorId: 'agent-a',
    taskId: 'TASK-ADOPT-1',
    claimLeaseId: 'lease-adopt-1',
    status: 'active',
    guidanceSessionId: 'lane-stale',
    timestamp: '2026-07-18T00:00:00.000Z'
  });

  const adopted = runLane([
    'adopt',
    stale.session.laneId,
    '--cwd', repo,
    '--actor', 'agent-b',
    '--json'
  ]);
  assert.equal(adopted.ok, true);
  const evidence = adopted.evidence as {
    authorization?: string;
    rebind?: { preservedLeaseIds?: string[]; reboundTaskIds?: string[]; reboundSessionIds?: string[] };
  };
  assert.equal(evidence.authorization, 'stale-ttl');
  assert.deepEqual(evidence.rebind?.preservedLeaseIds, ['lease-adopt-1']);
  assert.deepEqual(evidence.rebind?.reboundTaskIds, ['TASK-ADOPT-1']);
  assert.ok(evidence.rebind?.reboundSessionIds?.includes('session-adopt-1'));

  const taskAfter = JSON.parse(readFileSync(path.join(repo, '.atm/history/tasks/TASK-ADOPT-1.json'), 'utf8')) as {
    claim: { actorId: string; leaseId: string; laneSession: { laneSessionId: string; status: string } };
  };
  assert.equal(taskAfter.claim.leaseId, 'lease-adopt-1');
  assert.equal(taskAfter.claim.actorId, 'agent-b');
  assert.equal(taskAfter.claim.laneSession.laneSessionId, 'lane-stale');
  assert.equal(taskAfter.claim.laneSession.status, 'adopted');

  console.log('[lane-adopt-phase] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
