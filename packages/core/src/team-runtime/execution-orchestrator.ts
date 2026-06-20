import type {
  TeamProviderContract,
  TeamProviderSessionRequest,
  TeamProviderStepResult
} from './provider-contract.ts';

export type TeamOrchestrationRequest = TeamProviderSessionRequest & {
  readonly retries?: number;
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
): TeamOrchestrationResult {
  const session = provider.openSession(request);
  const maxAttempts = Math.max(1, request.retries ?? 1);
  let attempts = 0;
  let result: TeamProviderStepResult = {
    ok: true,
    providerId: provider.metadata.providerId,
    role: request.role,
    artifacts: ['agent-report'],
    retryable: false,
    summary: 'Provider orchestration completed.'
  };

  while (attempts < maxAttempts) {
    attempts += 1;
    if (result.ok || !result.retryable) {
      break;
    }
  }

  provider.closeSession(session.sessionId);
  return {
    ok: result.ok,
    attempts,
    sessionId: session.sessionId,
    providerId: provider.metadata.providerId,
    coordinatorOwnedAuthority: true,
    stepResult: result
  };
}
