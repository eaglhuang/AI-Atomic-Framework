import assert from 'node:assert/strict';

import { buildTeamRuntimeContract } from '../../../packages/cli/src/commands/team.ts';
import { resolveNodejsTeamWorkerAdapter } from '../../../packages/core/src/team-runtime/nodejs-worker-adapter.ts';

export async function runNodejsWorkerAdapterValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'nodejs-worker-adapter') return false;

  const nodeAdapter = resolveNodejsTeamWorkerAdapter({
    runtimeMode: 'real-agent',
    runtimeLanguage: 'node',
    providerId: 'local',
    sdkId: 'nodejs-reference',
    modelId: 'fixture-model'
  });
  assert.equal(nodeAdapter.schemaId, 'atm.teamWorkerAdapterContract.v1');
  assert.equal(nodeAdapter.adapterId, 'atm.node.reference-worker');
  assert.equal(nodeAdapter.executionSurface, 'agent-runtime');
  assert.equal(nodeAdapter.spawnStrategy, 'spawn-worker');
  assert.equal(nodeAdapter.agentsSpawned, true);
  assert.equal(nodeAdapter.authorityBoundary.gitWrite, false);
  assert.equal(nodeAdapter.authorityBoundary.taskLifecycle, false);
  assert.equal(nodeAdapter.authorityBoundary.selfClose, false);
  assert.equal(nodeAdapter.authorityBoundary.evidenceWriteOwner, 'coordinator');
  assert.equal(nodeAdapter.vendorNeutral, true);
  assert.equal(nodeAdapter.artifactContractPreserved, true);
  assert.equal(nodeAdapter.retryContractPreserved, true);

  const brokerFallback = resolveNodejsTeamWorkerAdapter({ runtimeMode: 'broker-only' });
  assert.equal(brokerFallback.adapterId, 'atm.node.broker-only-fallback');
  assert.equal(brokerFallback.executionSurface, 'broker-governance');
  assert.equal(brokerFallback.spawnStrategy, 'disabled');
  assert.equal(brokerFallback.agentsSpawned, false);
  assert.equal(brokerFallback.authorityBoundary.gitWrite, false);
  assert.equal(brokerFallback.authorityBoundary.taskLifecycle, false);
  assert.equal(brokerFallback.authorityBoundary.selfClose, false);
  assert.equal(brokerFallback.brokerFallback.enabled, true);
  for (const preserved of ['broker', 'permission-leases', 'validators', 'police', 'evidence', 'artifact-contract', 'retry-contract']) {
    assert.ok(brokerFallback.brokerFallback.preservesGovernance.includes(preserved), `broker fallback must preserve ${preserved}`);
  }

  const realRuntime = buildTeamRuntimeContract({ runtimeMode: 'real-agent', runtimeLanguage: 'node' });
  assert.equal(realRuntime.runtimeAdapterId, 'atm.node.reference-worker');
  assert.equal(realRuntime.providerId, 'local');
  assert.equal(realRuntime.sdkId, 'nodejs');
  assert.equal(realRuntime.modelId, 'provider-selected');
  assert.equal(realRuntime.workerAdapter.adapterId, 'atm.node.reference-worker');
  assert.equal(realRuntime.workerAdapter.authorityBoundary.gitWrite, false);
  assert.equal(realRuntime.workerAdapter.authorityBoundary.taskLifecycle, false);
  assert.equal(realRuntime.commitLane.workerGitWrite, false);
  assert.equal(realRuntime.commitLane.serializedBy, 'branch-commit-queue');
  assert.equal(realRuntime.brokerSubagent.enabled, true);
  assert.equal(realRuntime.brokerSubagent.authorityBoundary.fileWrite, false);
  assert.equal(realRuntime.brokerSubagent.authorityBoundary.gitWrite, false);
  assert.deepEqual(realRuntime.brokerSubagent.governs, ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane']);
  assert.equal(realRuntime.agentsSpawned, true);
  assert.equal(realRuntime.artifactHandoff.schemaId, 'atm.teamArtifactHandoffContract.v1');
  assert.equal(realRuntime.retryBudget.schemaId, 'atm.teamRetryBudgetContract.v1');

  const brokerRuntime = buildTeamRuntimeContract({ runtimeMode: 'broker-only' });
  assert.equal(brokerRuntime.runtimeAdapterId, 'atm.node.broker-only-fallback');
  assert.equal(brokerRuntime.workerAdapter.brokerFallback.enabled, true);
  assert.equal(brokerRuntime.workerAdapter.authorityBoundary.selfClose, false);
  assert.equal(brokerRuntime.commitLane.ownerRole, 'coordinator');
  assert.equal(brokerRuntime.brokerSubagent.decisionSurface, 'brokerLane');
  assert.equal(brokerRuntime.brokerSubagent.stewardId, 'neutral-write-steward');
  assert.equal(brokerRuntime.brokerSubagent.escalationTarget, 'coordinator');
  assert.equal(brokerRuntime.agentsSpawned, false);
  assert.equal(brokerRuntime.executionSurface, 'broker-governance');
  assert.equal(brokerRuntime.artifactHandoff.schemaId, realRuntime.artifactHandoff.schemaId);
  assert.equal(brokerRuntime.retryBudget.schemaId, realRuntime.retryBudget.schemaId);

  console.log('[validate-team-agents] ok (nodejs-worker-adapter)');
  return true;
}
