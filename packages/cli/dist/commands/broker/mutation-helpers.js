export function classifyExplicitMutationRequest(request) {
    const missingInputs = [];
    const filePath = typeof request.filePath === 'string' ? request.filePath : '';
    const normalizedFilePath = filePath.trim();
    const op = typeof request.op === 'string' ? request.op.trim() : '';
    const target = typeof request.target === 'string' ? request.target.trim() : '';
    const requestId = typeof request.requestId === 'string' && request.requestId.trim()
        ? request.requestId.trim()
        : [
            normalizedFilePath || 'unknown-file',
            op || 'unknown-op',
            target || 'unknown-target'
        ].join(':');
    const kind = resolveExplicitMutationIntentKind(request, filePath, op, target);
    if (!normalizedFilePath) {
        missingInputs.push({
            requestId,
            filePath,
            kind: kind ?? 'unknown',
            field: 'filePath',
            reason: 'filePath is required for broker mutation intent.'
        });
    }
    if (!op) {
        missingInputs.push({
            requestId,
            filePath,
            kind: kind ?? 'unknown',
            field: 'op',
            reason: 'operation is required; broker does not infer operations from prose.'
        });
    }
    if (!target) {
        missingInputs.push({
            requestId,
            filePath,
            kind: kind ?? 'unknown',
            field: 'target',
            reason: 'target/region is required; broker does not guess write regions.'
        });
    }
    if (missingInputs.length > 0 || !kind) {
        return { explicitInputs: [], missingInputs };
    }
    return {
        explicitInputs: [
            {
                requestId,
                filePath,
                kind,
                op,
                target
            }
        ],
        missingInputs
    };
}
function resolveExplicitMutationIntentKind(request, filePath, op, target) {
    const explicitKind = request.intentKind;
    if (explicitKind) {
        return explicitKind;
    }
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
    if (normalizedPath.includes('/path-to-atom-map-shards/owner-shard-') && target) {
        return 'owner-shard-row-target';
    }
    if ((normalizedPath.endsWith('.scalars.json') || normalizedPath.endsWith('.counter.json')) && target) {
        return 'scalar-operation';
    }
    if ((normalizedPath.endsWith('.md') || normalizedPath.endsWith('.txt')) && target) {
        return 'text-range';
    }
    if (normalizedPath.endsWith('.json') && target.startsWith('/')) {
        return 'json-pointer';
    }
    if (op && target) {
        return 'mutation-request';
    }
    return null;
}
export function buildMutationEvidence(adapterId, request, baseHash, resultHash, mergeDecision, verdict, conflictKeys) {
    return {
        requestId: request.requestId,
        actorId: request.actorId,
        adapterId,
        filePath: request.filePath,
        baseHash,
        resultHash,
        conflictKeys,
        mergeDecision,
        verdict
    };
}
export function extractMutationRequestTransactionIds(request) {
    const source = request;
    const values = [
        source.transactionId,
        ...(Array.isArray(source.transactionIds) ? source.transactionIds : [source.transactionIds]),
        ...(Array.isArray(source.transaction_ids) ? source.transaction_ids : [source.transaction_ids])
    ];
    return [...new Set(values
            .map((value) => typeof value === 'string' ? value.trim() : '')
            .filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}
