import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { evaluateTeamRequiredCompletionGate, runTeam } from '../../../packages/cli/src/commands/team.ts';

export async function runTeamRequiredCloseGateValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'team-required-close-gate') return false;

  const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-required-close-gate');
  const taskId = 'TASK-TEAM-REQUIRED-0001';
  const teamRunId = 'team-required-fixture';
  const taskDocument = {
    schemaId: 'atm.taskLedger.v1',
    workItemId: taskId,
    status: 'running',
    team: { required: true }
  };
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(path.join(cwd, '.atm', 'runtime', 'team-runs'), { recursive: true });

  try {
    const missing = evaluateTeamRequiredCompletionGate({ cwd, taskId, taskDocument });
    assert.equal(missing.ok, false);
    assert.equal(missing.required, true);
    assert.ok(missing.requiredCommand?.includes('team complete'));

    writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      teamRunId,
      taskId,
      actorId: 'coordinator',
      status: 'active',
      teamSummary: { closeReady: false },
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z'
    }, null, 2)}\n`, 'utf8');
    const activeOnly = evaluateTeamRequiredCompletionGate({ cwd, taskId, taskDocument });
    assert.equal(activeOnly.ok, false);

    const complete = await runTeam([
      'complete',
      '--team',
      teamRunId,
      '--actor',
      'coordinator',
      '--reason',
      'required close gate fixture',
      '--cwd',
      cwd,
      '--json'
    ]);
    assert.equal(complete.ok, true);
    const ready = evaluateTeamRequiredCompletionGate({ cwd, taskId, taskDocument });
    assert.equal(ready.ok, true);
    assert.equal((ready.teamRun as any)?.teamRunId, teamRunId);
    assert.equal((ready.teamRun as any)?.status, 'completed');

    const notRequired = evaluateTeamRequiredCompletionGate({
      cwd,
      taskId: 'TASK-NO-TEAM',
      taskDocument: { schemaId: 'atm.taskLedger.v1', workItemId: 'TASK-NO-TEAM', status: 'running' }
    });
    assert.equal(notRequired.ok, true);
    assert.equal(notRequired.required, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  console.log('[validate-team-agents] ok (team-required-close-gate)');
  return true;
}
