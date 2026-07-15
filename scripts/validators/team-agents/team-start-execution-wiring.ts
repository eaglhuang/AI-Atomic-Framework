import assert from 'node:assert/strict';
import { createTeamProviderMetadata } from '../../../packages/core/src/team-runtime/provider-contract.ts';
import { runProviderOrchestration } from '../../../packages/core/src/team-runtime/execution-orchestrator.ts';

export async function runTeamStartExecutionWiringValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'team-start-execution-wiring') return false;

  let attemptCount = 0;
  const provider = {
    schemaId: 'atm.teamProviderContract.v1' as const,
    metadata: createTeamProviderMetadata('openai'),
    sessionLifecycle: {
      createSession: true as const,
      closeSession: true as const,
      cancelSession: true as const,
      retryStep: true as const
    },
    openSession(request: any) {
      return { sessionId: `${request.taskId}:${request.role}:${request.providerId}:${request.modelId}`, providerId: 'openai' as const };
    },
    executeStep(input: any) {
      attemptCount += 1;
      return {
        ok: attemptCount > 1,
        outputText: `attempt ${attemptCount} for ${input.request.role}`,
        outputArtifacts: ['agent-report', `role-${input.request.role}`],
        retryable: attemptCount === 1,
        summary: attemptCount > 1 ? 'fake provider completed' : 'fake provider retry requested',
        executionMode: 'vendor-api' as const
      };
    },
    closeSession(sessionId: string) {
      return { closed: true as const, sessionId };
    },
    cancelSession(sessionId: string, reason: string) {
      return { cancelled: true as const, sessionId, reason };
    }
  };
  const orchestration = await runProviderOrchestration(provider, {
    taskId: 'TASK-TEAM-0050',
    role: 'implementer',
    runtimeMode: 'real-agent',
    providerId: 'openai',
    sdkId: 'openai-responses',
    modelId: 'gpt-5-mini',
    retries: 2
  });
  assert.equal(orchestration.ok, true);
  assert.equal(orchestration.attempts, 2);
  assert.equal(attemptCount, 2);
  assert.equal(orchestration.sessionId, 'TASK-TEAM-0050:implementer:openai:gpt-5-mini');
  assert.deepEqual(orchestration.stepResult.artifacts, ['agent-report', 'role-implementer']);
  console.log('[validate-team-agents] ok (team-start-execution-wiring)');
  return true;
}
