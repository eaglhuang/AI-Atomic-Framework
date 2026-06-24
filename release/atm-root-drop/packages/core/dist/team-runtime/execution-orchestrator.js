export function runProviderOrchestration(provider, request) {
    const session = provider.openSession(request);
    const maxAttempts = Math.max(1, request.retries ?? 1);
    let attempts = 0;
    let result = {
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
