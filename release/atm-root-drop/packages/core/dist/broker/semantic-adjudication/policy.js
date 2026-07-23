/**
 * Pure semantic revalidation adjudicator.
 * Targeted validator availability/failure signals here remain advisory algebra
 * for publish intent; exact post-compose ErrorCode selection for composed
 * candidates is owned by post-compose-semantic-validation-policy.ts.
 */
const MIGRATION = Object.freeze({
    strategy: 'none',
    fromVersion: null,
    notes: 'semantic revalidation adjudicator baseline'
});
export function adjudicateSemanticRevalidation(request) {
    const validatorUnavailable = request.validators.some((validator) => !validator.available);
    const failingValidator = request.validators.some((validator) => validator.available && validator.result === 'fail');
    const staleReads = findStaleReadAnchors(request.readSet, request.publishedWriteSet);
    const operationConflicts = findOperationConflicts(request.publishedWriteSet);
    const reasons = [];
    if (!request.publishIntent || request.domain !== 'code') {
        return resultFor(request, 'valid', 'keep-read-lane', [
            'Semantic revalidation is advisory for non-code or non-publish work; reads are never queued by this policy.'
        ], staleReads, operationConflicts);
    }
    if (failingValidator) {
        reasons.push('A targeted semantic validator failed.');
    }
    if (validatorUnavailable) {
        reasons.push('A targeted semantic validator was unavailable.');
    }
    if (staleReads.length > 0) {
        reasons.push('Published writes intersect the declared read set; proposal reasoning must be recomputed.');
    }
    if (operationConflicts.length > 0) {
        reasons.push('Published write operations include noncommutative or precondition-sensitive combinations.');
    }
    if (failingValidator || operationConflicts.length > 0) {
        return resultFor(request, 'steward-required', 'steward-review', reasons, staleReads, operationConflicts);
    }
    if (validatorUnavailable) {
        return resultFor(request, 'inconclusive', 'steward-review', reasons, staleReads, operationConflicts);
    }
    if (staleReads.length > 0) {
        return resultFor(request, 'recompute-required', 'recompute', reasons, staleReads, operationConflicts);
    }
    return resultFor(request, 'valid', 'publish', ['Semantic read set and operation algebra are clear.'], staleReads, operationConflicts);
}
export function findStaleReadAnchors(readSet, publishedWriteSet) {
    const stale = new Set();
    for (const read of readSet) {
        for (const write of publishedWriteSet) {
            if (sameSemanticAnchor(read, write)) {
                stale.add(read.anchorId ?? `${read.atomCid}:${read.filePath}`);
            }
        }
    }
    return Array.from(stale).sort();
}
export function canComposeOperations(left, right) {
    if (!sameWriteSurface(left, right)) {
        return true;
    }
    if (left.algebra === 'commutative' && right.algebra === 'commutative') {
        return true;
    }
    return false;
}
function findOperationConflicts(writes) {
    const conflicts = new Set();
    for (let leftIndex = 0; leftIndex < writes.length; leftIndex += 1) {
        const left = writes[leftIndex];
        if (!left) {
            continue;
        }
        for (let rightIndex = leftIndex + 1; rightIndex < writes.length; rightIndex += 1) {
            const right = writes[rightIndex];
            if (!right || canComposeOperations(left, right)) {
                continue;
            }
            conflicts.add(`${operationPair(left, right)}:${left.atomCid}:${left.anchorId ?? left.filePath}`);
        }
    }
    return Array.from(conflicts).sort();
}
function sameSemanticAnchor(read, write) {
    if (read.anchorId && write.anchorId && read.anchorId === write.anchorId) {
        return true;
    }
    return read.atomCid === write.atomCid && read.filePath === write.filePath;
}
function sameWriteSurface(left, right) {
    if (left.anchorId && right.anchorId) {
        return left.anchorId === right.anchorId && left.filePath === right.filePath;
    }
    return left.atomCid === right.atomCid && left.filePath === right.filePath;
}
function operationPair(left, right) {
    return [left.operation, right.operation].sort().join('+');
}
function resultFor(request, verdict, ticketNextAction, reasons, staleReadAnchors, operationConflicts) {
    return {
        schemaId: 'atm.semanticRevalidationResult.v1',
        specVersion: '0.1.0',
        migration: MIGRATION,
        requestId: request.requestId,
        taskId: request.taskId,
        domain: request.domain,
        verdict,
        ticketNextAction,
        digests: request.digests,
        assumptions: request.assumptions,
        validatorRefs: normalizeValidators(request.validators),
        reasons,
        staleReadAnchors,
        operationConflicts
    };
}
function normalizeValidators(validators) {
    return validators.map((validator) => ({
        command: validator.command,
        available: validator.available,
        result: validator.result ?? (validator.available ? 'not-run' : undefined)
    }));
}
