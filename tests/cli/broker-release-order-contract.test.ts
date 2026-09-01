import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runTeamBrokerConflictResolve } from '../../packages/cli/src/commands/team/legacy/broker-observability.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-release-order-'));
const primaryTaskId = 'TASK-PRIMARY-0001';
const conflictTaskId = 'TASK-CONFLICT-0002';

try {
  assert.throws(
    () => runTeamBrokerConflictResolve([
      '--task', primaryTaskId,
      '--conflict', conflictTaskId,
      '--path', 'packages/cli/src/fixture.ts',
      '--decision-reason', 'The conflicting task must run first.'
    ], cwd),
    (error: unknown) => (error as { code?: string }).code === 'ATM_TEAM_BROKER_RESOLVE_RELEASE_ORDER_REQUIRED',
    'a reason must never be mistaken for an ordering instruction'
  );

  assert.throws(
    () => runTeamBrokerConflictResolve([
      '--task', primaryTaskId,
      '--conflict', conflictTaskId,
      '--path', 'packages/cli/src/fixture.ts',
      '--release-order', primaryTaskId,
      '--decision-reason', 'The conflicting task must run first.'
    ], cwd),
    (error: unknown) => (error as { code?: string }).code === 'ATM_TEAM_BROKER_RESOLVE_RELEASE_ORDER_INVALID',
    'the explicit order must cover every participant exactly once'
  );

  const resolved = runTeamBrokerConflictResolve([
    '--task', primaryTaskId,
    '--conflict', conflictTaskId,
    '--path', 'packages/cli/src/fixture.ts',
    '--release-order', `${conflictTaskId},${primaryTaskId}`,
    '--decision-reason', 'The conflicting task must run first.'
  ], cwd);
  const artifact = resolved.evidence.artifact as { releaseOrder: readonly string[]; currentAllowedTaskId: string; conflictUx: { nextSafeResolutionCommand: string } };
  assert.deepEqual(artifact.releaseOrder, [conflictTaskId, primaryTaskId]);
  assert.equal(artifact.currentAllowedTaskId, conflictTaskId);
  assert.match((resolved.evidence.conflictUx as { nextSafeResolutionCommand: string }).nextSafeResolutionCommand, /--release-order TASK-CONFLICT-0002,TASK-PRIMARY-0001/);

  console.log('broker-release-order-contract: PASS');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
