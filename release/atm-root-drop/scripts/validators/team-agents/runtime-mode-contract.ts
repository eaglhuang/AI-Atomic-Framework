import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

import { CliError } from '../../../packages/cli/src/commands/shared.ts';
import { buildTeamRuntimeContract, runTeam } from '../../../packages/cli/src/commands/team.ts';

export async function runRuntimeModeContractValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'runtime-mode-contract') return false;

  const runtimeContractSchema = JSON.parse(readFileSync(path.join(process.cwd(), 'schemas', 'team-agents', 'team-runtime-contract.schema.json'), 'utf8'));
  const validateRuntimeContract = new Ajv2020({ allErrors: true }).compile(runtimeContractSchema);
  const assertRuntimeContractSchema = (contract: unknown, label: string) => {
    assert.ok(validateRuntimeContract(contract), `${label} runtime contract must match schema: ${JSON.stringify(validateRuntimeContract.errors)}`);
  };

  const defaultContract = buildTeamRuntimeContract({});
  assertRuntimeContractSchema(defaultContract, 'default');
  assert.equal(defaultContract.runtimeMode, 'broker-only');
  assert.equal(defaultContract.runtimeLanguage, 'node');
  assert.equal(defaultContract.executionSurface, 'broker-governance');
  assert.equal(defaultContract.agentsSpawned, false);
  assert.equal(defaultContract.commitLane.schemaId, 'atm.teamCommitLaneContract.v1');
  assert.equal(defaultContract.commitLane.ownerRole, 'coordinator');
  assert.deepEqual(defaultContract.commitLane.ownerPermissions, ['task.lifecycle', 'git.write', 'evidence.write']);
  assert.equal(defaultContract.commitLane.workerGitWrite, false);
  assert.equal(defaultContract.commitLane.serializedBy, 'branch-commit-queue');
  assert.equal(defaultContract.commitLane.lockSchemaId, 'atm.branchCommitQueueLock.v1');
  assert.deepEqual(defaultContract.commitLane.retryableCodes, ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE']);
  assert.equal(defaultContract.brokerSubagent.schemaId, 'atm.teamBrokerSubagentContract.v1');
  assert.equal(defaultContract.brokerSubagent.enabled, true);
  assert.equal(defaultContract.brokerSubagent.subagentId, 'team-broker-subagent');
  assert.equal(defaultContract.brokerSubagent.lifecycleOwner, 'atm');
  assert.equal(defaultContract.brokerSubagent.decisionSurface, 'brokerLane');
  assert.deepEqual(defaultContract.brokerSubagent.governs, ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane']);
  assert.equal(defaultContract.brokerSubagent.stewardId, 'neutral-write-steward');
  assert.deepEqual(defaultContract.brokerSubagent.evidenceRequired, ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1']);
  assert.equal(defaultContract.brokerSubagent.authorityBoundary.fileWrite, false);
  assert.equal(defaultContract.brokerSubagent.authorityBoundary.gitWrite, false);
  assert.equal(defaultContract.brokerSubagent.authorityBoundary.taskLifecycle, false);
  assert.equal(defaultContract.brokerSubagent.authorityBoundary.selfClose, false);
  assert.equal(defaultContract.brokerSubagent.escalationTarget, 'coordinator');
  assert.ok(defaultContract.selectionReason.includes('broker-only selected'));

  const realAgentContract = buildTeamRuntimeContract({
    runtimeMode: 'real-agent',
    runtimeLanguage: 'python',
    runtimeAdapterId: 'atm.node.reference',
    providerId: 'local',
    sdkId: 'node-sdk',
    modelId: 'model-a'
  });
  assertRuntimeContractSchema(realAgentContract, 'real-agent');
  assert.equal(realAgentContract.runtimeMode, 'real-agent');
  assert.equal(realAgentContract.runtimeLanguage, 'python');
  assert.equal(realAgentContract.runtimeAdapterId, 'atm.node.reference');
  assert.equal(realAgentContract.providerId, 'local');
  assert.equal(realAgentContract.sdkId, 'node-sdk');
  assert.equal(realAgentContract.modelId, 'model-a');
  assert.equal(realAgentContract.executionSurface, 'agent-runtime');
  assert.equal(realAgentContract.agentsSpawned, true);

  const editorContract = buildTeamRuntimeContract({ runtimeMode: 'editor-subagent' });
  assertRuntimeContractSchema(editorContract, 'editor-subagent');
  assert.equal(editorContract.executionSurface, 'editor-subagent');
  assert.equal(editorContract.runtimeLanguage, 'node');

  assert.throws(
    () => buildTeamRuntimeContract({ runtimeMode: 'unsupported-mode' }),
    (error: unknown) => error instanceof CliError && error.code === 'ATM_TEAM_RUNTIME_MODE_INVALID'
  );

  const start = await runTeam([
    'start',
    '--task',
    'TASK-TEAM-0031',
    '--actor',
    'codex-runtime-validator',
    '--runtime-mode',
    'broker-only',
    '--runtime-adapter',
    'atm.node.broker',
    '--provider',
    'local',
    '--sdk',
    'none',
    '--model',
    'none',
    '--cwd',
    process.cwd(),
    '--json'
  ]);
  const evidence = start.evidence as any;
  const validationCodes = evidence?.validation?.findings?.map((finding: any) => finding.code) ?? [];
  const blockedByProposalFirst = start.ok === false
    && start.messages?.some((message: any) => message.code === 'ATM_TEAM_START_BLOCKED')
    && validationCodes.includes('blocked-broker-cid-conflict')
    && validationCodes.includes('proposal-first-required');
  assert.equal(start.ok === true || blockedByProposalFirst, true);
  assert.equal(evidence?.runtimeContract?.schemaId, 'atm.teamRuntimeContract.v1');
  assert.equal(evidence?.runtimeContract?.runtimeMode, 'broker-only');
  assert.equal(evidence?.runtimeContract?.runtimeLanguage, 'node');
  assert.equal(evidence?.runtimeContract?.runtimeAdapterId, 'atm.node.broker');
  assert.equal(evidence?.runtimeContract?.providerId, 'local');
  assert.equal(evidence?.runtimeContract?.sdkId, 'none');
  assert.equal(evidence?.runtimeContract?.modelId, 'none');
  assert.equal(evidence?.runtimeContract?.executionSurface, 'broker-governance');
  assert.equal(evidence?.runtimeContract?.agentsSpawned, false);
  assert.equal(evidence?.agentsSpawned, false);
  if (start.ok === true) {
    assert.equal(evidence?.teamRun?.runtimeMode, 'broker-only');
    assert.equal(evidence?.teamRun?.runtimeLanguage, 'node');
    assert.equal(evidence?.teamRun?.runtimeAdapterId, 'atm.node.broker');
    assert.equal(evidence?.teamRun?.providerId, 'local');
    assert.equal(evidence?.teamRun?.sdkId, 'none');
    assert.equal(evidence?.teamRun?.modelId, 'none');
    assert.equal(evidence?.teamRun?.executionMode, 'manual-team');
    assert.equal(evidence?.teamRun?.executionSurface, 'broker-governance');
    assert.equal(evidence?.teamRun?.agentsSpawned, false);
    assert.ok(String(evidence?.teamRun?.teamSummary?.implementationSummary).includes('broker-only selected'));
  } else {
    assert.equal(evidence?.runtimeWritten, false);
    assert.equal(evidence?.teamRun, undefined);
  }

  console.log('[validate-team-agents] ok (runtime-mode-contract)');
  return true;
}
