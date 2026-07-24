import { pathMatchesTaskScope } from './commit-scope-policy.ts';
import type { RepositoryAdapterCommitEvidence } from '../../../../core/src/commit-candidate/commit-candidate-store.ts';

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

/**
 * ATM-GOV-0261: record that the local Git adapter persisted an admitted commit
 * candidate. Pathspec / temporary-index is captured here as an adapter
 * operation tied to a candidate id, never as ATM's authority model.
 */
export function buildGitAdapterCommitEvidence(input: {
  readonly candidateId: string;
  readonly isolationMechanism: string;
  readonly persistedFiles: readonly string[];
  readonly consumedUnrelatedFiles: readonly string[];
  readonly emergencyPathspec: boolean;
  readonly revisionId: string | null;
}): RepositoryAdapterCommitEvidence {
  return {
    schemaId: 'atm.repositoryAdapterCommit.v1',
    adapterTarget: 'local-git',
    candidateId: input.candidateId,
    isolationMechanism: input.isolationMechanism,
    persistedFiles: [...input.persistedFiles].sort(),
    consumedUnrelatedFiles: [...input.consumedUnrelatedFiles].sort(),
    emergencyPathspec: input.emergencyPathspec,
    revisionId: input.revisionId
  };
}

/**
 * A clean adapter operation persists exactly the admitted candidate payload and
 * consumes no unrelated staged files. Emergency pathspec never counts as clean.
 */
export function isPathspecAdapterOperation(evidence: RepositoryAdapterCommitEvidence): boolean {
  return evidence.emergencyPathspec === false && evidence.consumedUnrelatedFiles.length === 0;
}
