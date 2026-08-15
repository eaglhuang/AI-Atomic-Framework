/**
 * git-governance/implementation/dry-run-purity.ts
 *
 * ATM-GOV-0394 — the dry-run purity contract for governed commits.
 *
 * `--dry-run` is the flag an operator uses to look before acting, so it must be
 * inert on every path. Before this module the flag was consulted inside two
 * branch-local guards: the task-scoped branch checked it plainly, the
 * framework branch checked it only alongside `--auto-stage`, and a request
 * matching neither branch reached the commit executor, which never asked. That
 * is how a `--dry-run` against a closed, released task advanced HEAD to
 * 60ced0732.
 *
 * Purity therefore lives here, decided from the request alone. Branch
 * selection cannot grant it, forget it, or override it.
 */
import { CliError } from '../../shared.js';
/**
 * Decide purity from the request, before authority resolution picks a branch.
 *
 * A pure request may observe and report, but may not change HEAD, the index,
 * the worktree, the ledger, lease consumption, receipts, or artifacts. Only the
 * boolean flag grants purity: a truthy string is a caller error, not consent.
 */
export function resolveDryRunPurity(request) {
    return request?.dryRun === true;
}
/**
 * The last line of the contract, asserted at the single executor call site.
 *
 * Arriving here while pure means every branch declined to preview and the
 * request fell through to execution. Fail closed and name the authority that
 * was missing: an operator who asked to look must never be silently upgraded
 * into having acted, and must not be handed an empty success either, which
 * reads the same as a preview that found nothing to do.
 */
export function assertDryRunReachedNoExecutor(dryRunPurity, context) {
    if (!dryRunPurity)
        return;
    throw new CliError('ATM_GIT_COMMIT_DRY_RUN_PURITY_VIOLATED', 'git commit --dry-run resolved no previewable authority and reached the commit executor; refusing to commit. Re-run with a live task claim or framework claim to obtain a preview.', {
        exitCode: 1,
        details: {
            dryRun: true,
            taskId: context.taskId,
            usesFrameworkClaimCommit: context.usesFrameworkClaimCommit,
            missingAuthority: context.taskId
                ? 'no live claim for the named task, and no live framework claim for this actor'
                : 'no live framework claim for this actor',
            statusCommand: context.taskId
                ? `node atm.mjs tasks status --task ${context.taskId} --json`
                : 'node atm.mjs framework-mode claim --actor <id> --files "<paths>" --json'
        }
    });
}
