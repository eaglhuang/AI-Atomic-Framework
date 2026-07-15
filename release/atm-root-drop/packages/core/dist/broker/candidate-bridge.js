import { createHash } from 'node:crypto';
import { emptyGovernanceSharedSurfaces, mergeSharedSurfaces, projectGovernanceSharedSurfacesFromPaths } from './global-resource-projection.js';
/**
 * Convert discovered atom candidates into a well-formed `WriteIntent` for
 * `calculateBrokerDecision()` (TASK-ASP-0004). Pure and deterministic: no
 * LLM calls, no language semantics, and the candidate input is never mutated.
 */
export function candidatesToWriteIntent(candidates, ctx) {
    if (candidates.length === 0) {
        throw new TypeError('candidatesToWriteIntent requires at least one atom candidate.');
    }
    const atomRefs = candidates.map((candidate) => {
        const atomCid = computeCandidateAtomCid(candidate);
        return {
            atomId: candidate.suggestedAtomId ?? `ATM-AUTO-${atomCid.slice(0, 8)}`,
            atomCid,
            operation: 'create',
            ...computeCandidateSourceRange(candidate)
        };
    });
    const targetFiles = [...new Set(candidates.flatMap((candidate) => [
            candidate.filePath,
            ...(candidate.suggestedSourcePaths ?? [])
        ]).map(normalizePath))].sort();
    const projectedSharedSurfaces = projectGovernanceSharedSurfacesFromPaths(targetFiles, ctx.governanceResources);
    return {
        schemaId: 'atm.writeIntent.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
        taskId: ctx.taskId,
        actorId: ctx.actorId,
        baseCommit: ctx.baseCommit,
        targetFiles,
        atomRefs,
        sharedSurfaces: mergeSharedSurfaces(mergeSharedSurfaces(emptyGovernanceSharedSurfaces(), projectedSharedSurfaces), ctx.sharedSurfaces),
        requestedLane: ctx.requestedLane ?? 'auto'
    };
}
/**
 * Deterministic atom CID: SHA-256 over the canonical candidate contract
 * `(kind || symbol || sourcePaths || detectionMethod)`, where `sourcePaths`
 * is the deduplicated, sorted union of `filePath` and `suggestedSourcePaths`.
 * The same candidate always produces the same CID across runs and processes.
 */
export function computeCandidateAtomCid(candidate) {
    const sourcePaths = [...new Set([candidate.filePath, ...(candidate.suggestedSourcePaths ?? [])].map(normalizePath))].sort();
    const lineSignature = `${candidate.lineStart ?? ''}:${candidate.lineEnd ?? ''}`;
    const contract = [
        candidate.kind,
        candidate.symbol,
        sourcePaths.join(','),
        lineSignature,
        candidate.detectionMethod
    ].join('||');
    return createHash('sha256').update(contract).digest('hex');
}
function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/');
}
function computeCandidateSourceRange(candidate) {
    if (candidate.lineStart == null ||
        candidate.lineEnd == null ||
        Number.isNaN(candidate.lineStart) ||
        Number.isNaN(candidate.lineEnd)) {
        return undefined;
    }
    const start = Math.max(1, candidate.lineStart);
    const end = Math.max(start, candidate.lineEnd);
    return {
        sourceRange: {
            filePath: normalizePath(candidate.filePath),
            lineStart: start,
            lineEnd: end
        }
    };
}
