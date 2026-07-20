import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
export function buildGovernanceReadinessHintContract(input) {
    const gitReadiness = readFastGitReadiness(input.cwd);
    const currentBranch = gitReadiness.currentBranch;
    const upstreamRef = gitReadiness.upstreamRef;
    const aheadCount = gitReadiness.aheadCount;
    const protectedBranchTarget = Boolean(currentBranch && input.isProtectedFrameworkBranchTarget(currentBranch));
    const needsFrameworkStatus = Boolean(input.frameworkClaimRequired) || input.isFrameworkMaintenancePrompt(input.prompt);
    const frameworkStatus = needsFrameworkStatus ? input.createFrameworkModeStatus({ cwd: input.cwd }) : null;
    const ownFiles = input.uniqueSorted([
        ...(input.ownFiles ?? []),
        ...(input.taskId ? input.readTaskWorkFiles(input.cwd, input.taskId) : [])
    ]);
    const activeWorkSummary = input.buildActiveWorkSummary(input.cwd, input.actorId, ownFiles);
    const earlyPreparation = [
        'Read evidence.nextAction.playbook before editing, closing, or committing.',
        'Resolve explicit actor identity before claim, commit, or report.',
        ...(input.frameworkClaimRequired || (frameworkStatus?.repoIdentity.isFrameworkRepo && input.isFrameworkMaintenancePrompt(input.prompt))
            ? ['Acquire framework-mode claim before editing framework-critical files.']
            : []),
        ...(input.channel === 'batch'
            ? ['Stay on the queue head and expect batch checkpoint before commit.']
            : []),
        ...(protectedBranchTarget
            ? ['Do not wait until push to discover branch-queue or closeout-boundary blockers; rerun doctor and hook pre-push proactively.']
            : [])
    ];
    return {
        schemaId: 'atm.nextGovernanceReadinessHint.v1',
        channel: input.channel,
        currentBranch,
        upstreamRef,
        protectedBranchTarget,
        aheadCount,
        frameworkClaimRequired: Boolean(input.frameworkClaimRequired),
        activeWorkSummary,
        earlyPreparation,
        queueRetryCodes: ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE'],
        perCriticalCommitGitHeadEvidence: {
            enforcement: 'disabled',
            retainedStrictBoundaries: ['same-commit governed provenance', 'closure packet', 'evidence-only repair', 'task closeout']
        },
        protectedPushHint: protectedBranchTarget
            ? 'Protected framework branches no longer require per-critical-commit git-head evidence; same-commit governed provenance and high-risk closeout evidence remain strict.'
            : null
    };
}
function readFastGitReadiness(cwd) {
    const gitDirectory = resolveGitDirectory(cwd);
    const currentBranch = gitDirectory ? readCurrentBranchFromGitDir(gitDirectory) : runGitScalar(cwd, ['branch', '--show-current']);
    const upstreamRef = currentBranch && gitDirectory
        ? readUpstreamFromGitConfig(gitDirectory, currentBranch) ?? runGitScalar(cwd, ['rev-parse', '--abbrev-ref', `${currentBranch}@{upstream}`])
        : (currentBranch ? runGitScalar(cwd, ['rev-parse', '--abbrev-ref', `${currentBranch}@{upstream}`]) : null);
    const aheadCount = currentBranch && upstreamRef && gitDirectory
        ? (readAheadCountFast(gitDirectory, currentBranch, upstreamRef) ?? Number.parseInt(runGitScalar(cwd, ['rev-list', '--count', `${upstreamRef}..HEAD`]) ?? '0', 10)) || 0
        : 0;
    return { currentBranch, upstreamRef, aheadCount };
}
function resolveGitDirectory(cwd) {
    const dotGit = path.join(cwd, '.git');
    if (!existsSync(dotGit))
        return null;
    try {
        const stat = statSync(dotGit);
        if (stat.isDirectory())
            return dotGit;
        if (stat.isFile()) {
            const text = readFileSync(dotGit, 'utf8').trim();
            const match = /^gitdir:\s*(.+)$/i.exec(text);
            if (match?.[1]) {
                const gitdir = match[1].trim();
                return path.isAbsolute(gitdir) ? gitdir : path.resolve(cwd, gitdir);
            }
        }
    }
    catch {
        return null;
    }
    return null;
}
function readCurrentBranchFromGitDir(gitDirectory) {
    try {
        const head = readFileSync(path.join(gitDirectory, 'HEAD'), 'utf8').trim();
        const prefix = 'ref: refs/heads/';
        return head.startsWith(prefix) ? head.slice(prefix.length).trim() || null : null;
    }
    catch {
        return null;
    }
}
function readUpstreamFromGitConfig(gitDirectory, branch) {
    try {
        const config = readFileSync(path.join(gitDirectory, 'config'), 'utf8');
        const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const section = new RegExp(`\\[branch "${escaped}"\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(config)?.[1];
        if (!section)
            return null;
        const remote = /^\s*remote\s*=\s*(.+)\s*$/m.exec(section)?.[1]?.trim();
        const merge = /^\s*merge\s*=\s*refs\/heads\/(.+)\s*$/m.exec(section)?.[1]?.trim();
        return remote && merge ? `${remote}/${merge}` : null;
    }
    catch {
        return null;
    }
}
function readAheadCountFast(gitDirectory, branch, upstreamRef) {
    const localSha = readRefSha(gitDirectory, `refs/heads/${branch}`);
    const upstreamSha = readRefSha(gitDirectory, `refs/remotes/${upstreamRef}`);
    if (!localSha || !upstreamSha)
        return null;
    return localSha === upstreamSha ? 0 : null;
}
function readRefSha(gitDirectory, refPath) {
    try {
        const value = readFileSync(path.join(gitDirectory, ...refPath.split('/')), 'utf8').trim();
        return /^[0-9a-f]{40}$/i.test(value) ? value : null;
    }
    catch {
        return readPackedRefSha(gitDirectory, refPath);
    }
}
function readPackedRefSha(gitDirectory, refPath) {
    try {
        const packedRefs = readFileSync(path.join(gitDirectory, 'packed-refs'), 'utf8');
        for (const line of packedRefs.split(/\r?\n/)) {
            if (!line || line.startsWith('#') || line.startsWith('^'))
                continue;
            const [sha, ref] = line.trim().split(/\s+/, 2);
            if (ref === refPath && /^[0-9a-f]{40}$/i.test(sha))
                return sha;
        }
    }
    catch {
        return null;
    }
    return null;
}
function runGitScalar(cwd, args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return result.status === 0 ? String(result.stdout).trim() || null : null;
}
