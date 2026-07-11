import type {
  TeamProviderContract,
  TeamProviderSessionRequest,
  TeamProviderStepResult
} from './provider-contract.ts';

export type TeamOrchestrationRequest = TeamProviderSessionRequest & {
  readonly retries?: number;
  readonly env?: Record<string, string | undefined>;
};

export type TeamOrchestrationResult = {
  readonly ok: boolean;
  readonly attempts: number;
  readonly sessionId: string;
  readonly providerId: string;
  readonly coordinatorOwnedAuthority: true;
  readonly stepResult: TeamProviderStepResult;
};

export function runProviderOrchestration(
  provider: TeamProviderContract,
  request: TeamOrchestrationRequest
): Promise<TeamOrchestrationResult> {
  const session = provider.openSession(request);
  const maxAttempts = Math.max(1, request.retries ?? 1);
  let attempts = 0;
  let result: TeamProviderStepResult | null = null;

  return (async () => {
    while (attempts < maxAttempts) {
    attempts += 1;
      const execution = provider.executeStep
        ? await provider.executeStep({
          request,
          sessionId: session.sessionId,
          input: request.input ?? request.instructions ?? `Run Team role ${request.role} for ${request.taskId}.`,
          instructions: request.instructions,
          scopedPaths: [],
          env: request.env
        })
        : {
          ok: true,
          outputText: 'Provider orchestration completed without an executeStep hook.',
          outputArtifacts: ['agent-report'],
          retryable: false,
          summary: 'Provider orchestration completed.',
          executionMode: request.runtimeMode === 'editor-subagent' ? 'editor-cli' as const : 'vendor-api' as const
        };
      result = {
        ok: execution.ok,
        providerId: provider.metadata.providerId,
        role: request.role,
        artifacts: execution.outputArtifacts?.length ? execution.outputArtifacts : ['agent-report'],
        retryable: execution.retryable,
        summary: execution.summary
      };
      if (result.ok || !result.retryable) {
      break;
      }
    }

    provider.closeSession(session.sessionId);
    return {
      ok: result?.ok ?? false,
      attempts,
      sessionId: session.sessionId,
      providerId: provider.metadata.providerId,
      coordinatorOwnedAuthority: true,
      stepResult: result ?? {
        ok: false,
        providerId: provider.metadata.providerId,
        role: request.role,
        artifacts: [],
        retryable: false,
        summary: 'Provider orchestration produced no step result.'
      }
    };
  })();
}
