/**
 * Typed compatibility facade for the bounded git-governance implementation map.
 * Policy and transaction lifecycle live in the owner modules below.
 */
export { resolveCommitLaneSessionId, runAtmGit } from './implementation/command-router.ts';
export { resolveTaskScopedCommitBundle } from './implementation/commit-bundle-resolution.ts';
export { captureGitHeadEvidencePreparation, reconcileResolvedCrossTaskMutationIncident, rollbackFailedGitHeadEvidencePreparation } from './implementation/git-head-evidence-transaction.ts';
export { listTaskOwnedProtectedOverrideAuditFiles } from './implementation/git-index-transaction.ts';
export { resolveGitExecutable } from './implementation/git-process-port.ts';
export { evaluateGitGovernanceCheck, resolveActorGitIdentityForCommit } from './implementation/identity-check-command.ts';
