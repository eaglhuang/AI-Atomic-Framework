import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTasksClaimLifecycle } from '../../packages/cli/src/commands/tasks/claim-orchestrator.ts';
import { mintLaneSession } from '../../packages/cli/src/commands/lane-session/store.ts';
import {
  evaluateSameTaskClaimOwnership,
  readClaimLaneSessionId
} from '../../packages/cli/src/commands/tasks/claim-ownership.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-lane-claim-conflict-'));

function writeJson(relativePath: string, value: unknown): void {
  const absolutePath = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeTask(taskId: string, claim: Record<string, unknown> | null): void {
  writeJson(`.atm/history/tasks/${taskId}.json`, {
    schemaId: 'atm.task.v1',
    workItemId: taskId,
    title: taskId,
    status: claim ? 'running' : 'open',
    scope: [`scratch/${taskId}.ts`],
    ...(claim ? { claim } : {})
  });
  writeJson(`scratch/${taskId}.ts`, `export const id = '${taskId}';\n`);
}

async function main(): Promise<void> {
  mkdirSync(path.join(repo, '.atm/runtime/identity/actors'), { recursive: true });
  writeJson('.atm/runtime/identity/actors/agent-a.json', {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId: 'agent-a',
    editor: 'cursor',
    gitName: 'Agent A',
    gitEmail: 'agent-a@example.invalid',
    provider: 'cursor',
    activeSessionId: null,
    updatedAt: '2026-07-18T00:00:00.000Z'
  });

  mintLaneSession({
    cwd: repo,
    actorId: 'agent-a',
    laneId: 'lane-a',
    ttlMs: 86_400_000,
    timestamp: new Date().toISOString()
  });
  mintLaneSession({
    cwd: repo,
    actorId: 'agent-a',
    laneId: 'lane-b',
    ttlMs: 86_400_000,
    timestamp: new Date().toISOString()
  });

  const sameLane = evaluateSameTaskClaimOwnership({
    currentActorId: 'agent-a',
    currentLaneSessionId: 'lane-a',
    requestedActorId: 'agent-a',
    requestedLaneSessionId: 'lane-a'
  });
  assert.equal(sameLane.sameOwner, true);
  assert.equal(sameLane.mode, 'lane-id');

  const differentLane = evaluateSameTaskClaimOwnership({
    currentActorId: 'agent-a',
    currentLaneSessionId: 'lane-a',
    requestedActorId: 'agent-a',
    requestedLaneSessionId: 'lane-b'
  });
  assert.equal(differentLane.sameOwner, false);
  assert.equal(differentLane.mode, 'lane-id');

  const actorFallback = evaluateSameTaskClaimOwnership({
    currentActorId: 'agent-a',
    currentLaneSessionId: null,
    requestedActorId: 'agent-a',
    requestedLaneSessionId: null
  });
  assert.equal(actorFallback.sameOwner, true);
  assert.equal(actorFallback.mode, 'actor-fallback');

  writeTask('TASK-LANE-CONFLICT-1', {
    actorId: 'agent-a',
    leaseId: 'lease-hold-1',
    claimedAt: '2026-07-18T00:01:00.000Z',
    heartbeatAt: '2026-07-18T00:01:00.000Z',
    ttlSeconds: 3600,
    files: ['scratch/TASK-LANE-CONFLICT-1.ts'],
    state: 'active',
    intent: 'write',
    laneSession: {
      laneSessionId: 'lane-a',
      status: 'active',
      source: 'env',
      exportHint: 'export ATM_LANE_SESSION_ID="lane-a"'
    }
  });

  const previousLane = process.env.ATM_LANE_SESSION_ID;
  process.env.ATM_LANE_SESSION_ID = 'lane-b';
  await assert.rejects(
    () => runTasksClaimLifecycle('claim', [
      '--cwd', repo,
      '--task', 'TASK-LANE-CONFLICT-1',
      '--actor', 'agent-a',
      '--files', 'scratch/TASK-LANE-CONFLICT-1.ts',
      '--json'
    ]),
    (error: unknown) => {
      assert.ok(error && typeof error === 'object');
      const cliError = error as { code?: string; details?: Record<string, unknown> };
      assert.equal(cliError.code, 'ATM_LOCK_CONFLICT');
      assert.equal(cliError.details?.holdingLaneSessionId, 'lane-a');
      assert.equal(cliError.details?.requestedLaneSessionId, 'lane-b');
      assert.match(String(cliError.details?.laneAdoptCommand ?? ''), /lane adopt lane-a/);
      return true;
    }
  );

  process.env.ATM_LANE_SESSION_ID = 'lane-a';
  const sameLaneReuse = await runTasksClaimLifecycle('claim', [
    '--cwd', repo,
    '--task', 'TASK-LANE-CONFLICT-1',
    '--actor', 'agent-a',
    '--files', 'scratch/TASK-LANE-CONFLICT-1.ts',
    '--json'
  ]);
  assert.equal(sameLaneReuse.ok, true);
  const reusedClaim = (sameLaneReuse.evidence as { claim?: { laneSession?: { laneSessionId?: string } } }).claim;
  assert.equal(readClaimLaneSessionId(reusedClaim ?? null), 'lane-a');

  if (previousLane === undefined) delete process.env.ATM_LANE_SESSION_ID;
  else process.env.ATM_LANE_SESSION_ID = previousLane;

  console.log('[lane-claim-conflict-matrix] ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  rmSync(repo, { recursive: true, force: true });
});
