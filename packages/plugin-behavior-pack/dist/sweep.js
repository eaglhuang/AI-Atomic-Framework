function fail(issue, details) {
    return {
        ok: false,
        issues: [issue],
        evidence: [
            {
                evidenceKind: 'validation',
                summary: 'Sweep behavior failed dry-run preconditions.',
                artifactPaths: [],
                details
            }
        ]
    };
}
export const sweepBehavior = {
    behaviorId: 'builtin-sweep-behavior',
    actionCategories: ['behavior.sweep'],
    execute(_context, input) {
        if (input.action !== 'behavior.sweep') {
            return fail('sweep-action-mismatch', { action: input.action });
        }
        const payload = (input.payload ?? {});
        const callerCount = typeof payload.callerCount === 'number' ? payload.callerCount : 0;
        if (callerCount > 0) {
            return fail('sweep-requires-zero-callers', { callerCount });
        }
        return {
            ok: true,
            registryTransition: {
                fromStatus: 'active',
                toStatus: 'deprecated',
                governanceTier: 'standard',
                notes: 'Sweep marks zero-caller entry as deprecated for lifecycle handling.'
            },
            issues: [],
            evidence: [
                {
                    evidenceKind: 'validation',
                    summary: 'Sweep behavior accepted zero-caller precondition.',
                    artifactPaths: [],
                    details: {
                        callerCount
                    }
                }
            ]
        };
    }
};
export default sweepBehavior;
