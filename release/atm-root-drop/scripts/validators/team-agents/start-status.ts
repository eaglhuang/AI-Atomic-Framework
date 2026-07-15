import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runTeam } from '../../../packages/cli/src/commands/team.ts';
import { createTempWorkspace, initializeGitRepository } from '../../temp-root.ts';

export async function runStartStatusValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'start-status') return false;

  const cwd = createTempWorkspace('atm-team-start-status-');
  try {
    initializeGitRepository(cwd);
    const taskId = 'TASK-TEAM-0011';
    mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: taskId,
      title: 'Team start/status runtime',
      status: 'running',
      targetRepo: 'AI-Atomic-Framework',
      scopePaths: ['src/team-start-status-fixture.ts'],
      deliverables: ['src/team-start-status-fixture.ts'],
      validators: ['node --strip-types scripts/validate-team-agents.ts --case start-status'],
      atomizationImpact: { ownerAtomOrMap: 'atm.team-agents-map' }
    }, null, 2)}\n`, 'utf8');
    mkdirSync(path.join(cwd, 'src'), { recursive: true });
    writeFileSync(path.join(cwd, 'src', 'team-start-status-fixture.ts'), 'export const teamStartStatusFixture = true;\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fixture: initialize team start status workspace'], {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'ATM Test Fixture',
        GIT_AUTHOR_EMAIL: 'atm-test-fixture@example.invalid',
        GIT_COMMITTER_NAME: 'ATM Test Fixture',
        GIT_COMMITTER_EMAIL: 'atm-test-fixture@example.invalid'
      },
      stdio: 'ignore'
    });
    const start = await runTeam(['start', '--task', taskId, '--actor', 'codex-main', '--cwd', cwd, '--json']);
    const startEvidence = start.evidence as any;
    assert.equal(start.ok, true);
    assert.equal(startEvidence?.action, 'start');
    assert.equal(startEvidence?.runtimeWritten, true);
    assert.equal(startEvidence?.agentsSpawned, false);
    assert.match(startEvidence?.teamRunPath, /^\.atm\/runtime\/team-runs\/team-[a-f0-9]{12}\.json$/);

    const teamRun = startEvidence?.teamRun;
    assert.equal(teamRun?.schemaId, 'atm.teamRun.v1');
    assert.match(teamRun?.teamRunId, /^team-[a-f0-9]{12}$/);
    assert.equal(teamRun?.taskId, taskId);
    assert.equal(teamRun?.actorId, 'codex-main');
    assert.equal(teamRun?.recipeId, 'atm.default.normal.typescript');
    assert.equal(teamRun?.status, 'active');
    assert.equal(teamRun?.executionMode, 'manual-team');
    assert.equal(teamRun?.agentsSpawned, false);
    assert.equal(teamRun?.runtimeWritten, true);
    assert.equal(teamRun?.brokerSubagent?.schemaId, 'atm.teamBrokerSubagentContract.v1');
    assert.equal(teamRun?.brokerSubagent?.enabled, true);
    assert.equal(teamRun?.brokerSubagent?.decisionSurface, 'brokerLane');
    assert.equal(teamRun?.brokerSubagent?.stewardId, 'neutral-write-steward');
    assert.equal(teamRun?.runtimeContract?.brokerSubagent?.schemaId, teamRun?.brokerSubagent?.schemaId);
    assert.equal(teamRun?.runtimeContract?.brokerSubagent?.subagentId, teamRun?.brokerSubagent?.subagentId);
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.schemaId, 'atm.teamBrokerGovernanceSummary.v1');
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.brokerSubagentEnabled, true);
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.brokerDecisionSurface, 'brokerLane');
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.brokerStewardId, 'neutral-write-steward');
    assert.deepEqual(teamRun?.teamSummary?.brokerGovernance?.brokerGoverns, ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane']);
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.commitLaneSerializedBy, 'branch-commit-queue');
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.workerGitWrite, false);
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.workerTaskLifecycle, false);
    assert.equal(teamRun?.teamSummary?.brokerGovernance?.workerSelfClose, false);
    assert.ok(Array.isArray(teamRun?.roles) && teamRun.roles.length > 0);
    assert.ok(Array.isArray(teamRun?.leases) && teamRun.leases.length > 0);
    assert.deepEqual(teamRun?.leases, teamRun?.permissionLeases);
    assert.ok(teamRun.roles.some((role: any) => role.agentId === 'coordinator' && role.role === 'coordinator'));
    assert.ok(teamRun.leases.some((lease: any) => lease.permission === 'file.write' && Array.isArray(lease.paths)));
    assert.match(teamRun?.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(teamRun?.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    const status = await runTeam(['status', '--compact', '--cwd', cwd, '--json']);
    const statusEvidence = status.evidence as any;
    assert.equal(status.ok, true);
    assert.equal(statusEvidence?.action, 'status');
    assert.ok(statusEvidence?.teamRunCount >= 1);
    const summary = statusEvidence?.teamRuns?.find((entry: any) => entry.teamRunId === teamRun.teamRunId);
    assert.equal(summary?.taskId, taskId);
    assert.equal(summary?.actorId, 'codex-main');
    assert.equal(summary?.recipeId, 'atm.default.normal.typescript');
    assert.equal(summary?.status, 'active');
    assert.equal(summary?.roleCount, teamRun.roles.length);
    assert.equal(summary?.leaseCount, teamRun.leases.length);
    assert.equal(summary?.brokerSubagentEnabled, true);
    assert.equal(summary?.brokerDecisionSurface, 'brokerLane');
    assert.equal(summary?.brokerStewardId, 'neutral-write-steward');
    assert.equal(summary?.brokerGovernanceSummaryId, 'atm.teamBrokerGovernanceSummary.v1');
    assert.deepEqual(summary?.brokerEvidenceRequired, ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1']);
    assert.equal(summary?.commitLaneSerializedBy, 'branch-commit-queue');
    assert.equal(summary?.commitLaneOwnerRole, 'coordinator');
    assert.equal(summary?.workerGitWrite, false);
    assert.equal(summary?.workerTaskLifecycle, false);
    assert.equal(summary?.workerSelfClose, false);
    assert.equal(summary?.agentsSpawned, false);

    const runtimePath = path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRun.teamRunId}.json`);
    assert.equal(existsSync(runtimePath), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  console.log('[validate-team-agents] ok (start-status)');
  return true;
}
