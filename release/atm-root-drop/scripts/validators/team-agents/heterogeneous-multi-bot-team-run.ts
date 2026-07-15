import assert from 'node:assert/strict';

import { createTeamProviderMetadata } from '../../../packages/core/src/team-runtime/provider-contract.ts';
import { runProviderOrchestration } from '../../../packages/core/src/team-runtime/execution-orchestrator.ts';

export async function runHeterogeneousMultiBotTeamRunValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'heterogeneous-multi-bot-team-run') return false;

  const makeProvider = (providerId: 'openai' | 'claude-code') => ({
    schemaId: 'atm.teamProviderContract.v1' as const,
    metadata: createTeamProviderMetadata(providerId),
    sessionLifecycle: {
      createSession: true as const,
      closeSession: true as const,
      cancelSession: true as const,
      retryStep: true as const
    },
    openSession(request: any) {
      return { sessionId: `${request.taskId}:${request.role}:${request.providerId}:${request.modelId}`, providerId };
    },
    executeStep(input: any) {
      if (input.request.role === 'validator') {
        return {
          ok: false,
          outputText: 'broker-conflict-blocked',
          outputArtifacts: ['atm.brokerConflictResolution.v1'],
          retryable: false,
          summary: 'single role blocked by broker conflict',
          executionMode: 'vendor-api' as const
        };
      }
      return {
        ok: true,
        outputText: `completed ${input.request.role}`,
        outputArtifacts: ['atm.teamProviderRunArtifact.v1', `role-${input.request.role}`],
        retryable: false,
        summary: `${providerId} fake executor completed`,
        executionMode: providerId === 'openai' ? 'vendor-api' as const : 'editor-cli' as const
      };
    },
    closeSession(sessionId: string) {
      return { closed: true as const, sessionId };
    },
    cancelSession(sessionId: string, reason: string) {
      return { cancelled: true as const, sessionId, reason };
    }
  });
  const requests = [
    { role: 'implementer', providerId: 'openai' as const, sdkId: 'responses', modelId: 'gpt-5-mini' },
    { role: 'reader', providerId: 'claude-code' as const, sdkId: 'claude-code', modelId: 'claude-sonnet' },
    { role: 'validator', providerId: 'openai' as const, sdkId: 'responses', modelId: 'gpt-5-mini' }
  ];
  const results = await Promise.all(requests.map((request) => runProviderOrchestration(makeProvider(request.providerId), {
    taskId: 'TASK-TEAM-0052',
    role: request.role,
    runtimeMode: request.providerId === 'openai' ? 'real-agent' : 'editor-subagent',
    providerId: request.providerId,
    sdkId: request.sdkId,
    modelId: request.modelId,
    retries: 1
  })));
  assert.equal(new Set(results.map((result) => result.providerId)).size, 2);
  assert.deepEqual(results.map((result) => result.sessionId), [
    'TASK-TEAM-0052:implementer:openai:gpt-5-mini',
    'TASK-TEAM-0052:reader:claude-code:claude-sonnet',
    'TASK-TEAM-0052:validator:openai:gpt-5-mini'
  ]);
  assert.equal(results.filter((result) => result.ok).length, 2);
  assert.equal(results.find((result) => result.stepResult.role === 'validator')?.stepResult.summary, 'single role blocked by broker conflict');
  assert.ok(results.filter((result) => result.ok).every((result) => result.stepResult.artifacts.includes('atm.teamProviderRunArtifact.v1')));

  console.log('[validate-team-agents] ok (heterogeneous-multi-bot-team-run)');
  return true;
}
