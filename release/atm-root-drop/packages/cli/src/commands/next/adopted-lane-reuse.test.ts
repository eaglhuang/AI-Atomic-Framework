import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { upsertActorWorkSession } from '../actor-session.ts';
import { resolveCurrentLaneSessionIdForFreshReservation } from './claim-lane-session.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-adopted-lane-reuse-'));
const previousLane = process.env.ATM_LANE_SESSION_ID;
try {
  delete process.env.ATM_LANE_SESSION_ID;
  upsertActorWorkSession({
    cwd: repo,
    actorId: 'captain',
    taskId: 'TASK-EXAMPLE',
    guidanceSessionId: 'lane-adopted-example',
    timestamp: '2026-09-06T00:00:00.000Z'
  });
  assert.equal(
    resolveCurrentLaneSessionIdForFreshReservation(repo, 'captain'),
    'lane-adopted-example',
    'adopted lane must be reusable without ambient environment propagation'
  );
  process.env.ATM_LANE_SESSION_ID = 'lane-explicit-example';
  assert.equal(
    resolveCurrentLaneSessionIdForFreshReservation(repo, 'captain'),
    'lane-explicit-example',
    'an explicit lane must remain the highest-precedence input'
  );
  console.log('[adopted-lane-reuse] ok');
} finally {
  if (previousLane === undefined) delete process.env.ATM_LANE_SESSION_ID;
  else process.env.ATM_LANE_SESSION_ID = previousLane;
  rmSync(repo, { recursive: true, force: true });
}
