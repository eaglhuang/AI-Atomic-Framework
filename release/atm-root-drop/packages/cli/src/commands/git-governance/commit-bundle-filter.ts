import { pathMatchesTaskScope } from './commit-scope-policy.ts';

export function isFileAllowedInTaskBundle(input: {
  readonly filePath: string;
  readonly declaredScope: readonly string[];
  readonly allowedGovernanceArtifact: boolean;
}): boolean {
  if (input.allowedGovernanceArtifact) return true;
  return input.declaredScope.some((scope) => pathMatchesTaskScope(input.filePath, scope));
}

export function buildTaskScopedCommitFileSet(input: {
  readonly inScopeStagedFiles: readonly string[];
  readonly inScopeStagedDeletions: readonly string[];
  readonly stageCandidates: readonly string[];
  readonly uniqueSorted: (values: readonly string[]) => readonly string[];
}): readonly string[] {
  return input.uniqueSorted([
    ...input.inScopeStagedFiles,
    ...input.inScopeStagedDeletions,
    ...input.stageCandidates
  ]);
}
