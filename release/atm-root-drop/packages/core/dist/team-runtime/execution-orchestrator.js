export function runProviderOrchestration(provider, request) {
    const session = provider.openSession(request);
    const maxAttempts = Math.max(1, request.retries ?? 1);
    let attempts = 0;
    let result = null;
    return (async () => {
        while (attempts < maxAttempts) {
            attempts += 1;
            const execution = provider.executeStep
                ? await provider.executeStep({
                    request,
                    sessionId: session.sessionId,
                    input: request.input ?? request.instructions ?? `Run Team role ${request.role} for ${request.taskId}.`,
                    instructions: request.instructions,
                    scopedPaths: []
                })
                : {
                    ok: true,
                    outputText: 'Provider orchestration completed without an executeStep hook.',
                    outputArtifacts: ['agent-report'],
                    retryable: false,
                    summary: 'Provider orchestration completed.',
                    executionMode: request.runtimeMode === 'editor-subagent' ? 'editor-cli' : 'vendor-api'
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
