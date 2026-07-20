import { pathMatchesTaskScope } from './commit-scope-policy.js';
export function isFileAllowedInTaskBundle(input) {
    if (input.allowedGovernanceArtifact)
        return true;
    return input.declaredScope.some((scope) => pathMatchesTaskScope(input.filePath, scope));
}
export function buildTaskScopedCommitFileSet(input) {
    return input.uniqueSorted([
        ...input.inScopeStagedFiles,
        ...input.inScopeStagedDeletions,
        ...input.stageCandidates
    ]);
}
