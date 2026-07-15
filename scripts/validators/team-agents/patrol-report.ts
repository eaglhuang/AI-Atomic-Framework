import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runTeam } from '../../../packages/cli/src/commands/team.ts';
import { listRelativeFiles } from './artifact-fixtures.ts';

export async function runPatrolReportValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'patrol-report') return false;

    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-patrol');
    const taskId = 'TASK-PATROL-0001';
    const teamRunId = 'team-patrol-fixture';
    const evidenceDriftRunId = 'team-patrol-evidence-drift';
    const evidenceDriftBrokerSubagent = {
      schemaId: 'atm.teamBrokerSubagentContract.v1',
      enabled: true,
      subagentId: 'team-broker-subagent',
      lifecycleOwner: 'atm',
      decisionSurface: 'brokerLane',
      governs: ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane'],
      stewardId: 'neutral-write-steward',
      evidenceRequired: ['atm.teamBrokerLaneEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1'],
      authorityBoundary: {
        fileWrite: false,
        gitWrite: false,
        taskLifecycle: false,
        selfClose: false
      },
      escalationTarget: 'coordinator'
    };
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
    mkdirSync(path.join(cwd, '.atm', 'runtime', 'team-runs'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
      schemaId: 'atm.taskLedger.v1',
      workItemId: taskId,
      title: 'Patrol report fixture',
      status: 'running',
      planningRepo: 'AI-Atomic-Framework',
      targetRepo: 'AI-Atomic-Framework',
      targetAllowedFiles: [
        'packages/cli/src/commands/team.ts',
        'packages/cli/src/commands/command-specs/team.spec.ts',
        'scripts/validate-team-agents.ts',
        'atomic_workbench/atomization-coverage/path-to-atom-map.json'
      ],
      deliverables: ['packages/cli/src/commands/team.ts'],
      validators: ['node --strip-types scripts/validate-team-agents.ts --case patrol-report'],
      acceptance: ['Patrol output is read-only and reports runtime findings.']
    }, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      teamRunId,
      taskId,
      actorId: 'captain',
      status: 'active',
      executionMode: 'manual-team',
      agentsSpawned: false,
      retryBudget: { remaining: 0, limit: 2 },
      reworkRoute: { status: 'needs-rework', retryBudget: { remaining: 0, limit: 2 } },
      runtimeContract: {
        commitLane: {
          schemaId: 'atm.teamCommitLaneContract.v1',
          ownerRole: 'worker',
          workerGitWrite: true,
          serializedBy: 'shared-staging'
        }
      },
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    }, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${evidenceDriftRunId}.json`), `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      teamRunId: evidenceDriftRunId,
      taskId,
      actorId: 'captain',
      status: 'active',
      executionMode: 'manual-team',
      agentsSpawned: false,
      brokerSubagent: evidenceDriftBrokerSubagent,
      runtimeContract: {
        brokerSubagent: evidenceDriftBrokerSubagent,
        commitLane: {
          schemaId: 'atm.teamCommitLaneContract.v1',
          ownerRole: 'coordinator',
          workerGitWrite: false,
          serializedBy: 'branch-commit-queue'
        },
        workerAdapter: {
          authorityBoundary: {
            gitWrite: false,
            taskLifecycle: false,
            selfClose: false
          }
        }
      },
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    }, null, 2)}\n`, 'utf8');

    try {
      const beforeHistory = listRelativeFiles(path.join(cwd, '.atm', 'history'));
      const beforeRuntime = listRelativeFiles(path.join(cwd, '.atm', 'runtime'));
      const patrol = await runTeam(['patrol', '--task', taskId, '--team', teamRunId, '--cwd', cwd, '--json']);
      const evidence = patrol.evidence as any;
      assert.equal(patrol.ok, true);
      assert.equal(evidence?.schemaId, 'atm.teamPatrolReport.v1');
      assert.equal(evidence?.action, 'patrol');
      assert.equal(evidence?.readOnly, true);
      assert.equal(evidence?.runtimeWritten, false);
      assert.equal(evidence?.historyWritten, false);
      assert.equal(evidence?.agentsSpawned, false);
      assert.deepEqual(evidence?.mutations, []);
      assert.equal(evidence?.taskId, taskId);
      assert.equal(evidence?.runId, `patrol-${taskId}-claim-preflight`);
      assert.ok(Array.isArray(evidence?.patrolTeam) && evidence.patrolTeam.includes('atomic-police'));
      assert.equal(evidence?.mode, 'claim-preflight');
      assert.equal(evidence?.severity, 'blocker');
      assert.equal(evidence?.safeToProceed, false);
      assert.ok(evidence?.findings?.some((finding: any) => finding.level === 'blocker' && finding.category === 'broker-governance' && finding.code === 'ATM_TEAM_PATROL_BROKER_SUBAGENT_MISSING'));
      assert.ok(evidence?.findings?.some((finding: any) => finding.level === 'blocker' && finding.category === 'broker-governance' && finding.code === 'ATM_TEAM_PATROL_COMMIT_LANE_DRIFT'));
      assert.ok(evidence?.findings?.some((finding: any) => finding.code === 'ATM_TEAM_PATROL_COMMIT_LANE_DRIFT' && finding.details?.serializedBy === 'shared-staging' && finding.details?.ownerRole === 'worker' && finding.details?.workerGitWrite === true));
      assert.ok(evidence?.findings?.some((finding: any) => finding.level === 'blocker' && finding.category === 'retry-budget'));
      assert.ok(evidence?.findings?.some((finding: any) => finding.level === 'warning' && finding.category === 'rework-state'));
      assert.ok(evidence?.findings?.some((finding: any) => finding.category === 'scope'));
      assert.equal(typeof evidence?.suggestedCommand, 'string');
      assert.ok(Array.isArray(evidence?.followUp) && evidence.followUp.length > 0);
      assert.deepEqual(listRelativeFiles(path.join(cwd, '.atm', 'history')), beforeHistory);
      assert.deepEqual(listRelativeFiles(path.join(cwd, '.atm', 'runtime')), beforeRuntime);

      const evidenceDriftPatrol = await runTeam(['patrol', '--task', taskId, '--team', evidenceDriftRunId, '--cwd', cwd, '--json']);
      const evidenceDrift = evidenceDriftPatrol.evidence as any;
      assert.equal(evidenceDriftPatrol.ok, true);
      assert.equal(evidenceDrift?.severity, 'blocker');
      assert.equal(evidenceDrift?.safeToProceed, false);
      assert.ok(evidenceDrift?.findings?.some((finding: any) => (
        finding.level === 'blocker'
        && finding.category === 'broker-governance'
        && finding.code === 'ATM_TEAM_PATROL_BROKER_EVIDENCE_GATE_DRIFT'
        && finding.details?.missingEvidence?.includes('atm.stewardApplyEvidence.v1')
      )));
      assert.deepEqual(listRelativeFiles(path.join(cwd, '.atm', 'history')), beforeHistory);
      assert.deepEqual(listRelativeFiles(path.join(cwd, '.atm', 'runtime')), beforeRuntime);

      for (const mode of ['close-preflight', 'big-script', 'daily-noon']) {
        const modeResult = await runTeam(['patrol', '--task', taskId, '--mode', mode, '--cwd', cwd, '--json']);
        const modeEvidence = modeResult.evidence as any;
        assert.equal(modeResult.ok, true);
        assert.equal(modeEvidence?.mode, mode);
        assert.deepEqual(modeEvidence?.mutations, []);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (patrol-report)');
    return true;
}
