const TERMINAL_STATUSES = new Set(['completed', 'reconciled']);
export function buildCloseSideEffectIdempotencyKey(input) {
    return [
        'atm-close-side-effect',
        input.taskId.trim().toUpperCase(),
        input.actorId.trim() || 'unknown-actor',
        input.sideEffect,
        input.beforeDigest ?? 'no-before-digest'
    ].join(':');
}
export function reconcileCloseSideEffects(input) {
    const completedSideEffects = input.sideEffects.filter((entry) => TERMINAL_STATUSES.has(entry.status));
    const recoveryCommand = `node atm.mjs tasks status --task ${input.taskId} --json`;
    if (!input.planningSourceIdentityDrift) {
        return {
            schemaId: 'atm.closeSideEffectReconcile.v1',
            taskId: input.taskId,
            ok: true,
            disposition: completedSideEffects.length === input.sideEffects.length ? 'completed' : 'reconciled',
            code: null,
            summary: 'Close side effects are admissible; no planning source identity drift was detected.',
            replayAllowed: false,
            completedSideEffects,
            recoveryCommand
        };
    }
    if (completedSideEffects.length === 0) {
        return {
            schemaId: 'atm.closeSideEffectReconcile.v1',
            taskId: input.taskId,
            ok: false,
            disposition: 'fail-closed',
            code: 'ATM_PLANNING_SOURCE_IDENTITY_DRIFT',
            summary: 'Planning source identity drift was detected before any declared close side effect completed.',
            replayAllowed: false,
            completedSideEffects,
            recoveryCommand
        };
    }
    return {
        schemaId: 'atm.closeSideEffectReconcile.v1',
        taskId: input.taskId,
        ok: true,
        disposition: 'reconciled',
        code: 'ATM_PLANNING_SOURCE_IDENTITY_DRIFT',
        summary: 'Planning source identity drift occurred after terminal close side effects; ATM reports a reconciled receipt instead of replaying commit, close, push, or planning closeback.',
        replayAllowed: false,
        completedSideEffects,
        recoveryCommand
    };
}
