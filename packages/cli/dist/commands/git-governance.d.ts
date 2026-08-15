import { resolveWorkAdmissionTicket } from './git-governance/work-admission-check.ts';
import { captureGitHeadEvidencePreparation, evaluateGitGovernanceCheck, listTaskOwnedProtectedOverrideAuditFiles, inspectGitIndexLock, recoverGitIndexLock, resolveActorGitIdentityForCommit, resolveGitExecutable, resolveTaskScopedCommitBundle, reconcileResolvedCrossTaskMutationIncident, rollbackFailedGitHeadEvidencePreparation } from './git-governance/implementation.ts';
export { captureGitHeadEvidencePreparation, evaluateGitGovernanceCheck, listTaskOwnedProtectedOverrideAuditFiles, inspectGitIndexLock, recoverGitIndexLock, resolveActorGitIdentityForCommit, resolveGitExecutable, resolveTaskScopedCommitBundle, reconcileResolvedCrossTaskMutationIncident, rollbackFailedGitHeadEvidencePreparation };
/**
 * The public git facade is the coverage seam for claim-issued admission.
 * It intentionally delegates all Git behaviour to the established module and
 * adds no independent policy; task-bound commit/push only proceed after the
 * ticket authority accepts the observed operation.
 */
export declare function runAtmGit(argv: string[]): Promise<import("./shared.ts").CommandResult>;
/**
 * Decide which staged paths a governed commit is admitted against.
 *
 * Admission has to judge the paths the commit will actually write. Once any
 * in-scope path is staged, the commit resolves a task-scoped bundle and runs it
 * through a sealed candidate index, which is exactly the mechanism that keeps
 * unrelated staged entries out of the commit. Judging that commit against those
 * entries rejects it for something it cannot do.
 *
 * That mattered more than it looks. Scoping used to be conditional on
 * `--defer-foreign-staged`, so a commit whose own bundle was fully in scope was
 * denied whenever any other lane had something staged, and the only documented
 * way forward was the flag — which unstages the other lane's paths. A gate
 * meant to stop one lane from touching another lane's index bytes was making
 * that touch the only route past it. Scoping now follows transaction state, and
 * the flag governs only whether foreign entries are snapshotted and unstaged.
 *
 * `--auto-stage` reaches admission before it has staged anything, so nothing in
 * scope is staged yet even though the commit is provably task-scoped: the flag
 * is a declaration that exactly the ticket bundle will be staged. Admission
 * therefore judges that bundle. Keying this on the deferral flag instead would
 * reintroduce the same conflation in the other branch.
 *
 * The final fallback is the safety property, not a leftover. With nothing in
 * scope staged and no declared bundle, the commit falls back to the whole
 * staged surface; admission must then see that whole surface, or an
 * out-of-scope path would be committed unjudged.
 */
export declare function selectTicketValidatedCommitFiles(stagedFiles: readonly string[], ticket: ReturnType<typeof resolveWorkAdmissionTicket>, deferForeignStaged: boolean, stagesExactlyTheTicketBundle?: boolean): readonly string[];
