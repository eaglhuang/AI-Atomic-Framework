import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runIntegrationHookInvocationInProcess } from '../../../packages/cli/src/commands/integration-hooks.ts';
import { evaluateTeamPreCommitGate, evaluateTeamPreToolGate } from '../../../packages/cli/src/commands/team-runtime-gates.ts';

export async function runHookTeamGateValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'hook-team-gate') return false;

  const cwd = path.join(process.cwd(), '.atm-temp', 'validate-hook-team-gate');
  const teamRunId = 'team-hook-fixture';
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(path.join(cwd, '.atm', 'runtime', 'team-runs'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), `${JSON.stringify({
    schemaId: 'atm.teamRun.v1',
    teamRunId,
    taskId: 'TASK-HOOK-TEAM-0001',
    actorId: 'coordinator',
    status: 'active',
    permissionLeases: [
      { permission: 'git.write', agentId: 'coordinator' },
      { permission: 'file.write', agentId: 'implementer-typescript', paths: ['packages/cli/src/commands/team.ts'] }
    ],
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z'
  }, null, 2)}\n`, 'utf8');

  try {
    const allowedTool = evaluateTeamPreToolGate({
      cwd,
      actorId: 'implementer-typescript',
      files: ['packages/cli/src/commands/team.ts'],
      command: null,
      toolName: 'apply_patch'
    });
    assert.equal(allowedTool.length, 0);

    const blockedTool = evaluateTeamPreToolGate({
      cwd,
      actorId: 'implementer-typescript',
      files: ['scripts/validate-team-agents.ts'],
      command: null,
      toolName: 'apply_patch'
    });
    assert.equal(blockedTool.length, 1);
    assert.equal(blockedTool[0].code, 'ATM_TEAM_WRITE_SCOPE_EXCEEDED');
    assert.equal(blockedTool[0].teamRunId, teamRunId);

    const integrationBlocked = runIntegrationHookInvocationInProcess([
      'pre-tool',
      '--editor',
      'codex',
      '--tool-name',
      'apply_patch',
      '--files',
      'scripts/validate-team-agents.ts',
      '--cwd',
      cwd,
      '--json'
    ]);
    assert.equal(integrationBlocked.ok, false);
    assert.equal(integrationBlocked.messages[0]?.code, 'ATM_TEAM_WRITE_SCOPE_EXCEEDED');

    writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', 'team-hook-fixture-secondary.json'), `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      teamRunId: 'team-hook-fixture-secondary',
      taskId: 'TASK-HOOK-TEAM-0002',
      actorId: 'coordinator',
      status: 'active',
      permissionLeases: [
        { permission: 'git.write', agentId: 'coordinator' }
      ],
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z'
    }, null, 2)}\n`, 'utf8');

    const blockedCommit = evaluateTeamPreCommitGate({
      cwd,
      actorId: 'implementer-typescript',
      stagedFiles: ['packages/cli/src/commands/team.ts']
    });
    assert.equal(blockedCommit.length, 1);
    assert.equal(blockedCommit[0].code, 'ATM_TEAM_GIT_OWNER_REQUIRED');
    assert.deepEqual(blockedCommit[0].teamRunIds, ['team-hook-fixture']);
    assert.deepEqual(blockedCommit[0].files, ['packages/cli/src/commands/team.ts']);
    assert.deepEqual(blockedCommit[0].relevantFiles, ['packages/cli/src/commands/team.ts']);

    const unrelatedCommit = evaluateTeamPreCommitGate({
      cwd,
      actorId: 'implementer-typescript',
      stagedFiles: ['scripts/validate-team-agents.ts']
    });
    assert.equal(unrelatedCommit.length, 0, 'unrelated active Team runs must not block a framework commit outside their file.write lease');

    const allowedCommit = evaluateTeamPreCommitGate({
      cwd,
      actorId: 'coordinator',
      stagedFiles: ['packages/cli/src/commands/team.ts']
    });
    assert.equal(allowedCommit.length, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  console.log('[validate-team-agents] ok (hook-team-gate)');
  return true;
}
