import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  authorizeLaneCapability,
  evaluateLaneCapability,
  type LaneCommandClass
} from '../../packages/cli/src/commands/lane-session/capability-authority.ts';
import { CliError } from '../../packages/cli/src/commands/shared.ts';

/**
 * Regression replay of the 2026-07-24 Plan captain overreach as a generic
 * fixture: a captain executing from its own lane borrows a worker `--actor`
 * value to mutate a worker-owned active task. No task id, actor id, date, or
 * path is special-cased here — the gate is exercised purely through lane
 * capability binding (INV-ATM-009).
 */

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-borrowed-actor-'));

const mutationCommandClasses: readonly LaneCommandClass[] = [
  'taskflow-close-write',
  'governed-commit',
  'framework-mode',
  'runner-sync',
  'push'
];

function writeJson(relativePath: string, value: unknown): void {
  const absolutePath = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeLaneSession(laneId: string, actorId: string, extra: Record<string, unknown> = {}): void {
  writeJson(`.atm/runtime/lane-sessions/${laneId}.json`, {
    schemaId: 'atm.laneSession.v1',
    specVersion: '0.1.0',
    laneId,
    actorId,
    taskId: null,
    status: 'active',
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    expiresAt: '2999-01-01T00:00:00.000Z',
    ttlMs: 1800000,
    identity: { actorId, editor: null, gitName: null, gitEmail: null, provider: null, activeSessionId: null },
    adoptionSource: { kind: 'mint', sourceLaneId: null, sourceActorId: null, reason: null },
    handoffTokenHash: null,
    lastCommand: null,
    lastHeartbeatAt: '2026-07-24T00:00:00.000Z',
    ...extra
  });
}

function writeLaneBoundClaim(taskId: string, ownerActorId: string, ownerLaneId: string): void {
  writeJson(`.atm/history/tasks/${taskId}.json`, {
    id: taskId,
    status: 'in_progress',
    claim: {
      actorId: ownerActorId,
      leaseId: 'lease-worker-secret-000',
      claimedAt: '2026-07-24T00:00:00.000Z',
      heartbeatAt: '2026-07-24T00:00:00.000Z',
      ttlSeconds: 1800,
      files: ['packages/cli/src/commands/example.ts'],
      state: 'active',
      laneSession: {
        laneSessionId: ownerLaneId,
        status: 'active',
        source: 'option',
        exportHint: `export ATM_LANE_SESSION_ID=${JSON.stringify(ownerLaneId)}`
      }
    }
  });
}

try {
  const workerLane = 'lane-worker-alpha-aaaaaaaaaa';
  const captainLane = 'lane-captain-beta-bbbbbbbbbb';
  const workerActor = 'worker-alpha';
  const captainActor = 'captain-beta';
  const taskId = 'WORK-ITEM-0001';

  writeLaneSession(workerLane, workerActor);
  writeLaneSession(captainLane, captainActor);
  writeLaneBoundClaim(taskId, workerActor, workerLane);

  // 1. Borrowed actor from a different active lane is blocked for every mutation
  //    command class, regardless of the --actor string presented.
  for (const commandClass of mutationCommandClasses) {
    const decision = evaluateLaneCapability({
      cwd: repo,
      taskId,
      actorId: workerActor, // captain borrows the worker's attribution
      commandClass,
      executingLaneSessionId: captainLane // but executes from the captain lane
    });
    assert.equal(decision.allowed, false, `${commandClass} borrowed-actor attempt must be blocked`);
    assert.equal(decision.decisionClass, 'borrowed-actor-blocked', `${commandClass} decision class`);
    // The block leaks only fingerprints, never the replayable owner lane key.
    assert.ok(decision.ownerLaneFingerprint && decision.ownerLaneFingerprint.startsWith('lanefp:'));
    assert.ok(!JSON.stringify(decision).includes(workerLane), `${commandClass} decision must not expose owner lane key`);
  }

  // 2. authorizeLaneCapability throws a fail-closed CliError for the borrowed attempt.
  let threw = false;
  try {
    authorizeLaneCapability({
      cwd: repo,
      taskId,
      actorId: workerActor,
      commandClass: 'taskflow-close-write',
      executingLaneSessionId: captainLane
    });
  } catch (error) {
    threw = true;
    assert.ok(error instanceof CliError);
    assert.equal((error as CliError).code, 'ATM_LANE_BORROWED_ACTOR_BLOCKED');
    assert.equal((error as CliError).exitCode, 1);
  }
  assert.ok(threw, 'borrowed actor close/write must fail closed');

  // 3. Owner lane execution passes even when the presented actor metadata has
  //    drifted away from the recorded owner actor — authority follows the lane.
  for (const commandClass of mutationCommandClasses) {
    const decision = evaluateLaneCapability({
      cwd: repo,
      taskId,
      actorId: 'drifted-display-name', // actor drift
      commandClass,
      executingLaneSessionId: workerLane // owner lane capability held
    });
    assert.equal(decision.allowed, true, `${commandClass} owner-lane must pass`);
    assert.equal(decision.decisionClass, 'owner-lane', `${commandClass} owner-lane class`);
  }

  // 4. Missing executing lane capability cannot be substituted by an actor string.
  const noLane = evaluateLaneCapability({
    cwd: repo,
    taskId,
    actorId: workerActor,
    commandClass: 'push',
    executingLaneSessionId: null
  });
  assert.equal(noLane.allowed, false);
  assert.equal(noLane.decisionClass, 'borrowed-actor-blocked');

  // 5. Generalization guard: no Plan3.1/0263/claude-002/codex-plan31/date/path
  //    literal appears in the production gate source.
  const gateSource = readGateSource();
  for (const forbidden of ['0263', 'claude-002', 'codex-plan31', 'Plan3.1', 'plan31']) {
    assert.ok(!gateSource.includes(forbidden), `gate source must not special-case ${forbidden}`);
  }

  console.log('borrowed-actor-authority-hard-gate.test.ts passed');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

function readGateSource(): string {
  const gatePath = path.join(process.cwd(), 'packages/cli/src/commands/lane-session/capability-authority.ts');
  return readFileSync(gatePath, 'utf8');
}
