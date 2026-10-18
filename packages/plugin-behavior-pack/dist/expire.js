function fail(issue, details) {
    return {
        ok: false,
        issues: [issue],
        evidence: [
            {
                evidenceKind: 'validation',
                summary: 'Expire behavior failed TTL precondition.',
                artifactPaths: [],
                details
            }
        ]
    };
}
export const expireBehavior = {
    behaviorId: 'builtin-expire-behavior',
    actionCategories: ['behavior.expire'],
    execute(_context, input) {
        if (input.action !== 'behavior.expire') {
            return fail('expire-action-mismatch', { action: input.action });
        }
        const payload = (input.payload ?? {});
        if (payload.ttlExpired !== true) {
            return fail('expire-requires-ttl-expired', {
                ttlExpired: payload.ttlExpired ?? null
            });
        }
        return {
            ok: true,
            registryTransition: {
                fromStatus: 'deprecated',
                toStatus: 'expired',
                governanceTier: 'standard',
                notes: 'Expire finalizes deprecated entries after TTL expiration.'
            },
            issues: [],
            evidence: [
                {
                    evidenceKind: 'validation',
                    summary: 'Expire behavior accepted TTL-expired evidence for dry-run expiration.',
                    artifactPaths: [],
                    details: {
                        ttlExpired: true
                    }
                }
            ]
        };
    }
};
export default expireBehavior;
