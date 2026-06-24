import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { brokerAdapterMigration } from '../broker/types.js';
export function collectGitDiffMutationRequests(input) {
    const branch = resolveBranch(input);
    const remote = (input.remote?.trim() || 'origin');
    const remoteRef = `${remote}/${branch}`;
    if (input.fetch !== false) {
        runGit(input.cwd, ['fetch', '--quiet', '--no-tags', remote, branch], input.gitExecutable);
    }
    const headSha = runGitScalar(input.cwd, ['rev-parse', 'HEAD'], input.gitExecutable);
    const remoteSha = runGitScalar(input.cwd, ['rev-parse', remoteRef], input.gitExecutable);
    const mergeBaseSha = runGitScalar(input.cwd, ['merge-base', 'HEAD', remoteRef], input.gitExecutable);
    const localDiff = parseGitNameStatusZ(runGit(input.cwd, ['diff', '--name-status', '-z', `${mergeBaseSha}..HEAD`], input.gitExecutable));
    const remoteDiff = parseGitNameStatusZ(runGit(input.cwd, ['diff', '--name-status', '-z', `${mergeBaseSha}..${remoteRef}`], input.gitExecutable));
    const topology = {
        branch,
        remote,
        remoteRef,
        headSha,
        remoteSha,
        mergeBaseSha,
        fetched: input.fetch !== false
    };
    return {
        topology,
        localDiff,
        remoteDiff,
        localRequests: buildGitDiffMutationRequests({
            actorId: input.actorId,
            taskId: input.taskId ?? null,
            topology,
            side: 'local',
            entries: localDiff
        }),
        remoteRequests: buildGitDiffMutationRequests({
            actorId: `virtual:git-remote@${remoteSha}`,
            taskId: input.taskId ?? null,
            topology,
            side: 'remote',
            entries: remoteDiff
        })
    };
}
export function buildGitDiffMutationRequests(input) {
    return input.entries.map((entry) => {
        const requestId = buildRequestId(input.side, entry);
        return {
            schemaId: 'atm.mutationRequest.v1',
            specVersion: '0.1.0',
            migration: brokerAdapterMigration(),
            requestId,
            actorId: input.actorId,
            ...(input.taskId ? { taskId: input.taskId } : {}),
            filePath: entry.filePath,
            op: entry.status,
            target: entry.filePath,
            value: {
                source: 'git-diff',
                side: input.side,
                branch: input.topology.branch,
                remote: input.topology.remote,
                remoteRef: input.topology.remoteRef,
                mergeBaseSha: input.topology.mergeBaseSha,
                compareRef: input.side === 'local' ? 'HEAD' : input.topology.remoteRef,
                headSha: input.topology.headSha,
                remoteSha: input.topology.remoteSha,
                previousFilePath: entry.previousFilePath,
                rawStatus: entry.rawStatus,
                similarityScore: entry.similarityScore
            }
        };
    });
}
export function parseGitNameStatusZ(output) {
    if (!output)
        return [];
    const tokens = output.split('\0').filter((token) => token.length > 0);
    const entries = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const rawStatus = tokens[index] ?? '';
        if (!rawStatus)
            continue;
        const decoded = decodeStatus(rawStatus);
        if (decoded.status === 'renamed' || decoded.status === 'copied') {
            const previousFilePath = tokens[index + 1] ?? '';
            const filePath = tokens[index + 2] ?? '';
            entries.push({
                filePath,
                previousFilePath: previousFilePath || null,
                status: decoded.status,
                rawStatus,
                similarityScore: decoded.similarityScore
            });
            index += 2;
            continue;
        }
        const filePath = tokens[index + 1] ?? '';
        entries.push({
            filePath,
            previousFilePath: null,
            status: decoded.status,
            rawStatus,
            similarityScore: decoded.similarityScore
        });
        index += 1;
    }
    return entries.filter((entry) => entry.filePath.trim().length > 0);
}
function buildRequestId(side, entry) {
    const hash = createHash('sha256')
        .update(side)
        .update('\0')
        .update(entry.rawStatus)
        .update('\0')
        .update(entry.previousFilePath ?? '')
        .update('\0')
        .update(entry.filePath)
        .digest('hex')
        .slice(0, 16);
    return `git-${side}-${hash}`;
}
function decodeStatus(rawStatus) {
    const code = rawStatus.trim().charAt(0).toUpperCase();
    const similarity = rawStatus.length > 1 ? Number.parseInt(rawStatus.slice(1), 10) : Number.NaN;
    const similarityScore = Number.isFinite(similarity) ? similarity : null;
    switch (code) {
        case 'A':
            return { status: 'added', similarityScore };
        case 'M':
            return { status: 'modified', similarityScore };
        case 'D':
            return { status: 'deleted', similarityScore };
        case 'R':
            return { status: 'renamed', similarityScore };
        case 'C':
            return { status: 'copied', similarityScore };
        case 'T':
            return { status: 'typechanged', similarityScore };
        case 'U':
            return { status: 'unmerged', similarityScore };
        default:
            return { status: 'unknown', similarityScore };
    }
}
function resolveBranch(input) {
    const explicit = input.branch?.trim();
    if (explicit)
        return explicit;
    return runGitScalar(input.cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], input.gitExecutable);
}
function runGit(cwd, args, gitExecutable = 'git') {
    return execFileSync(gitExecutable, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
}
function runGitScalar(cwd, args, gitExecutable = 'git') {
    return runGit(cwd, args, gitExecutable).trim();
}
