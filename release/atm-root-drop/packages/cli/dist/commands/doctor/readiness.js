import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inspectTrackedActorRegistryState } from '../actor-registry.js';
import { relativePathFrom } from '../shared.js';
import { createCheck } from './utilities.js';
export function createGovernanceEntryReadinessCheck(root, repoIdentity, gitHeadEvidenceCheck) {
    const branch = runGitScalar(root, ['branch', '--show-current']);
    const upstream = branch ? runGitScalar(root, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]) : null;
    const aheadCount = upstream ? Number.parseInt(runGitScalar(root, ['rev-list', '--count', `${upstream}..HEAD`]) ?? '0', 10) || 0 : 0;
    const protectedBranchPatterns = ['main', 'master', 'trunk', 'release/*'];
    const protectedBranchTarget = branch ? isProtectedFrameworkBranchTarget(branch) : false;
    const details = gitHeadEvidenceCheck.details;
    const latestGitHeadStatus = (details && typeof details === 'object' && 'status' in details)
        ? details.status
        : null;
    const actorRegistryState = inspectTrackedActorRegistryState(root);
    const requiresProtectedPushReadiness = repoIdentity.isFrameworkRepo && protectedBranchTarget && aheadCount > 0;
    const protectedPushReadiness = !repoIdentity.isFrameworkRepo
        ? 'not-applicable'
        : !protectedBranchTarget
            ? 'non-protected-branch'
            : !upstream
                ? 'no-upstream'
                : aheadCount === 0
                    ? 'no-ahead-commits'
                    : 'ready';
    const ok = !actorRegistryState.blocking;
    return createCheck('governance-entry-readiness', ok, {
        schemaId: 'atm.governanceEntryReadiness.v1',
        repoRole: repoIdentity.isFrameworkRepo ? 'framework' : 'host',
        currentBranch: branch,
        upstreamRef: upstream,
        aheadCount,
        protectedBranchPatterns,
        protectedBranchTarget,
        requiresProtectedPushReadiness,
        protectedPushReadiness,
        latestGitHeadStatus: latestGitHeadStatus,
        perCriticalCommitGitHeadEvidence: {
            enforcement: 'disabled',
            reason: 'Per-critical-commit git-head evidence created protected-push deadlocks and is no longer a readiness gate.',
            retainedStrictBoundaries: ['same-commit governed provenance', 'closure packet', 'evidence-only repair', 'task closeout']
        },
        actorRegistryState: actorRegistryState,
        queueRetryCodes: ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE'],
        branchQueueSummary: 'Governed framework commits may serialize through the branch commit queue and retry on safe HEAD drift instead of surfacing raw Git races.',
        recommendedAction: actorRegistryState.blocking
            ? `Actor registry is a tracked governance surface and currently has unstaged drift at ${actorRegistryState.path}. Stage and commit it with the matching identity/governance change, or restore it before continuing.`
            : protectedPushReadiness === 'no-upstream'
                ? 'Set or fetch the upstream branch before relying on protected push readiness diagnostics.'
                : 'Before editing or pushing framework changes, confirm actor identity, framework claim, doctor readiness, same-commit governed provenance, and closeout evidence where applicable.'
    });
}
export function createBacklogSyncCheck(root, repoIdentity) {
    const backlogPath = path.join(root, 'docs', 'governance', 'atm-bug-and-optimization-backlog.md');
    if (!repoIdentity.isFrameworkRepo || !existsSync(backlogPath)) {
        return createCheck('backlog-sync', true, {
            schemaId: 'atm.backlogSyncCheck.v1',
            backlogPath: relativePathFrom(root, backlogPath),
            suspiciousRows: []
        });
    }
    const suspiciousRows = parseBacklogRows(readFileSync(backlogPath, 'utf8'))
        .filter((row) => row.status === 'Open')
        .filter((row) => /(current source now satisfies|repaired on|closed on|landed in|verified by|regression coverage now lives)/i.test(`${row.evidence} ${row.followUp}`))
        .map((row) => ({
        id: row.id,
        area: row.area,
        status: row.status
    }));
    return createCheck('backlog-sync', suspiciousRows.length === 0, {
        schemaId: 'atm.backlogSyncCheck.v1',
        backlogPath: relativePathFrom(root, backlogPath),
        suspiciousRows: suspiciousRows,
        recommendedAction: suspiciousRows.length > 0
            ? 'Update the backlog status to match current source reality, or land the missing validator/documentation closeout referenced by the row.'
            : 'Backlog open rows appear consistent with current source reality.'
    });
}
export function parseBacklogRows(markdown) {
    return markdown
        .split(/\r?\n/)
        .filter((line) => /^\|\s*(ATM|PROJECT)-BUG-/.test(line))
        .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
        .filter((cells) => cells.length >= 11)
        .map((cells) => ({
        id: cells[0],
        status: cells[5],
        area: cells[6],
        evidence: cells[9],
        followUp: cells[10]
    }));
}
export function runGitScalar(cwd, args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0)
        return null;
    const value = String(result.stdout ?? '').trim();
    return value.length > 0 ? value : null;
}
export function isProtectedFrameworkBranchTarget(branch) {
    return branch === 'main'
        || branch === 'master'
        || branch === 'trunk'
        || /^release\/.+/.test(branch);
}
export function hasRequiredScripts(scripts = {}) {
    const required = ['build', 'typecheck', 'lint', 'test', 'validate:quick', 'validate:standard', 'validate:full'];
    return required.every((name) => typeof scripts[name] === 'string' && scripts[name].length > 0);
}
export function isFrameworkContractExpected(repoIdentity) {
    return repoIdentity.isFrameworkRepo === true;
}
