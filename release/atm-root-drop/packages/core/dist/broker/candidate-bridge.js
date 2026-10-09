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
export const ATOM_CID_FORMULA_VERSION = 'cid.v2';
/**
 * Deterministic atom CID (cid.v2, TASK-ASP-0006): SHA-256 over
 * `cid.v2 || languageId || sourcePaths || kind || symbol || ordinal`, where
 * `sourcePaths` is the deduplicated, sorted union of `filePath` and
 * `suggestedSourcePaths`. Line numbers and `detectionMethod` are not part of
 * the identity: inserting lines above an atom or upgrading the detector keeps
 * its CID. Content changes are tracked separately (`computeAtomContentVersion`).
 */
export function computeCandidateAtomCid(candidate) {
    const sourcePaths = [...new Set([candidate.filePath, ...(candidate.suggestedSourcePaths ?? [])].map(normalizePath))].sort();
    const contract = [
        ATOM_CID_FORMULA_VERSION,
        candidate.languageId ?? inferLanguageId(candidate.filePath),
        sourcePaths.join(','),
        candidate.kind,
        candidate.symbol,
        candidate.ordinal == null ? '' : String(candidate.ordinal)
    ].join('||');
    return createHash('sha256').update(contract).digest('hex');
}
const languageIdByExtension = {
    '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.py': 'python', '.cs': 'csharp'
};
export function inferLanguageId(filePath) {
    const match = /\.[^./\\]+$/.exec(filePath);
    return (match && languageIdByExtension[match[0].toLowerCase()]) ?? 'unknown';
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
