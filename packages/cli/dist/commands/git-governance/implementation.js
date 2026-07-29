/**
 * Typed compatibility facade for the bounded git-governance implementation map.
 * Policy and transaction lifecycle live in the owner modules below.
 */
export { resolveCommitLaneSessionId, runAtmGit } from './implementation/command-router.js';
export { resolveTaskScopedCommitBundle } from './implementation/commit-bundle-resolution.js';
export { captureGitHeadEvidencePreparation, reconcileResolvedCrossTaskMutationIncident, rollbackFailedGitHeadEvidencePreparation } from './implementation/git-head-evidence-transaction.js';
export { listTaskOwnedProtectedOverrideAuditFiles } from './implementation/git-index-transaction.js';
export { resolveGitExecutable } from './implementation/git-process-port.js';
export { evaluateGitGovernanceCheck, resolveActorGitIdentityForCommit } from './implementation/identity-check-command.js';
