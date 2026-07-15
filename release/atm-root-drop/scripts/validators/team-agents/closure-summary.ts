import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createClosurePacket } from '../../../packages/cli/src/commands/framework-development.ts';

export async function runClosureSummaryValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'closure-summary') return false;

  const cwd = process.cwd();
  const teamRunId = 'team-closure-summary-fixture';
  const runtimePath = path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`);
  mkdirSync(path.dirname(runtimePath), { recursive: true });
  writeFileSync(runtimePath, `${JSON.stringify({
    schemaId: 'atm.teamRun.v1',
    teamRunId,
    taskId: 'TASK-TEAM-0016',
    actorId: 'validator',
    status: 'active',
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    captainDecision: { decision: 'close', reason: 'fixture captain decision' },
    agentReports: [{ role: 'validator', status: 'done', recommendation: 'close' }],
    patrolFindings: ['no scope drift found'],
    evidenceCuratorSummary: { summary: 'command-backed evidence remains authoritative' },
    teamSummary: {
      decision: 'close',
      implementationSummary: 'closure summary fixture',
      validators: ['typecheck'],
      evidence: ['fixture command evidence'],
      brokerGovernance: {
        schemaId: 'atm.teamBrokerGovernanceSummary.v1',
        brokerSubagentEnabled: true,
        brokerDecisionSurface: 'brokerLane',
        brokerStewardId: 'neutral-write-steward',
        brokerGoverns: ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane'],
        brokerEvidenceRequired: ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1'],
        commitLaneSerializedBy: 'branch-commit-queue',
        commitLaneOwnerRole: 'coordinator',
        workerGitWrite: false,
        workerTaskLifecycle: false,
        workerSelfClose: false
      },
      risk: 'low',
      closeReady: true
    }
  }, null, 2)}\n`, 'utf8');
  try {
    const packet = createClosurePacket({
      cwd,
      taskId: 'TASK-TEAM-0016',
      actorId: 'validator',
      evidencePath: '.atm/history/evidence/TASK-TEAM-0016.json',
      changedFiles: ['packages/cli/src/commands/team.ts']
    });
    assert.equal(packet.teamSummary?.teamRunId, teamRunId);
    assert.equal((packet.teamSummary?.captainDecision as any)?.decision, 'close');
    assert.equal(packet.teamSummary?.agentReports.length, 1);
    assert.equal(packet.teamSummary?.patrolFindings.length, 1);
    assert.equal((packet.teamSummary?.evidenceCuratorSummary as any)?.summary, 'command-backed evidence remains authoritative');
    assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.schemaId, 'atm.teamBrokerGovernanceSummary.v1');
    assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.brokerSubagentEnabled, true);
    assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.brokerDecisionSurface, 'brokerLane');
    assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.brokerStewardId, 'neutral-write-steward');
    assert.deepEqual((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.brokerGoverns, ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane']);
    assert.deepEqual((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.brokerEvidenceRequired, ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1']);
    assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.commitLaneSerializedBy, 'branch-commit-queue');
    assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.commitLaneOwnerRole, 'coordinator');
    assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.workerGitWrite, false);
    assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.workerTaskLifecycle, false);
    assert.equal((packet.teamSummary?.teamSummary as any)?.brokerGovernance?.workerSelfClose, false);

    const noSummaryPacket = createClosurePacket({
      cwd,
      taskId: 'TASK-TEAM-0016',
      actorId: 'validator',
      evidencePath: '.atm/history/evidence/TASK-TEAM-0016.json',
      changedFiles: ['packages/cli/src/commands/team.ts'],
      teamSummary: null
    });
    assert.equal(noSummaryPacket.teamSummary, null);
  } finally {
    rmSync(runtimePath, { force: true });
  }

  console.log('[validate-team-agents] ok (closure-summary)');
  return true;
}
