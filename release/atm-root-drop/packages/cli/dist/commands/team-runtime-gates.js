import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
export function evaluateTeamPreToolGate(input) {
    const actorId = normalizeOptional(input.actorId);
    const files = normalizePaths(input.files);
    if (files.length === 0)
        return [];
    const activeRuns = listActiveTeamRunProjections(input.cwd);
    const findings = [];
    for (const run of activeRuns) {
        const fileWriteLeases = run.permissionLeases.filter((lease) => lease.permission === 'file.write');
        if (fileWriteLeases.length === 0)
            continue;
        const actorLeases = actorId
            ? fileWriteLeases.filter((lease) => lease.agentId === actorId)
            : fileWriteLeases;
        const allowedPaths = actorLeases.flatMap((lease) => lease.paths);
        const blockedFiles = files.filter((file) => !isPathAllowedByAny(file, allowedPaths));
        if (blockedFiles.length > 0) {
            findings.push({
                code: 'ATM_TEAM_WRITE_SCOPE_EXCEEDED',
                detail: `Active Team run ${run.teamRunId} requires write tools to stay inside file.write lease paths.`,
                teamRunId: run.teamRunId,
                taskId: run.taskId,
                actorId,
                files: blockedFiles,
                requiredCommand: `node atm.mjs team lease --team ${run.teamRunId} --actor ${actorId ?? '<actor>'} --permission file.write --paths "<paths>" --json`
            });
        }
    }
    return findings;
}
export function evaluateTeamPreCommitGate(input) {
    const actorId = normalizeOptional(input.actorId);
    const stagedFiles = normalizePaths(input.stagedFiles);
    if (stagedFiles.length === 0)
        return [];
    const activeRuns = listActiveTeamRunProjections(input.cwd);
    const findings = [];
    const gitOwnerBlockedRuns = [];
    for (const run of activeRuns) {
        const relevantFiles = findTeamRunStagedScopeOverlap(run, stagedFiles);
        if (relevantFiles.length === 0)
            continue;
        const gitOwners = new Set(run.permissionLeases
            .filter((lease) => lease.permission === 'git.write')
            .map((lease) => lease.agentId));
        gitOwners.add('coordinator');
        if (run.actorId)
            gitOwners.add(run.actorId);
        if (!actorId || !gitOwners.has(actorId)) {
            gitOwnerBlockedRuns.push({ run, relevantFiles });
        }
    }
    if (gitOwnerBlockedRuns.length === 1) {
        const { run, relevantFiles } = gitOwnerBlockedRuns[0];
        findings.push({
            code: 'ATM_TEAM_GIT_OWNER_REQUIRED',
            detail: `Active Team run ${run.teamRunId} only allows Coordinator/git.write owner to commit because staged files overlap its file.write lease: ${relevantFiles.join(', ')}.`,
            teamRunId: run.teamRunId,
            teamRunIds: [run.teamRunId],
            taskId: run.taskId,
            taskIds: normalizePaths(run.taskId ? [run.taskId] : []),
            actorId,
            files: stagedFiles,
            relevantFiles,
            requiredCommand: `ATM_COMMIT_ACTOR_ID=coordinator git commit`
        });
    }
    else if (gitOwnerBlockedRuns.length > 1) {
        const teamRunIds = normalizePaths(gitOwnerBlockedRuns.map(({ run }) => run.teamRunId));
        const taskIds = normalizePaths(gitOwnerBlockedRuns.map(({ run }) => run.taskId ?? '').filter(Boolean));
        const relevantFiles = normalizePaths(gitOwnerBlockedRuns.flatMap((entry) => entry.relevantFiles));
        findings.push({
            code: 'ATM_TEAM_GIT_OWNER_REQUIRED',
            detail: `Multiple active Team runs only allow Coordinator/git.write owners to commit because staged files overlap their file.write leases. Runs: ${teamRunIds.join(', ')}. Overlapping files: ${relevantFiles.join(', ')}.`,
            teamRunId: teamRunIds[0],
            teamRunIds,
            taskId: taskIds[0] ?? null,
            taskIds,
            actorId,
            files: stagedFiles,
            relevantFiles,
            requiredCommand: `ATM_COMMIT_ACTOR_ID=coordinator git commit`
        });
    }
    return findings;
}
function findTeamRunStagedScopeOverlap(run, stagedFiles) {
    const writeScope = run.permissionLeases
        .filter((lease) => lease.permission === 'file.write')
        .flatMap((lease) => lease.paths);
    return writeScope.length > 0
        ? stagedFiles.filter((file) => isPathAllowedByAny(file, writeScope))
        : [];
}
function listActiveTeamRunProjections(cwd) {
    const directory = path.join(path.resolve(cwd), '.atm', 'runtime', 'team-runs');
    if (!existsSync(directory))
        return [];
    return readdirSync(directory)
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => readTeamRunProjection(path.join(directory, entry)))
        .filter((run) => run !== null && run.status === 'active');
}
function readTeamRunProjection(filePath) {
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        return {
            teamRunId: String(parsed.teamRunId ?? '').trim(),
            taskId: normalizeOptional(parsed.taskId),
            actorId: normalizeOptional(parsed.actorId),
            status: String(parsed.status ?? '').trim(),
            permissionLeases: normalizePermissionLeases(parsed.permissionLeases ?? parsed.leases)
        };
    }
    catch {
        return null;
    }
}
function normalizePermissionLeases(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((entry) => {
        const record = entry;
        const permission = String(record.permission ?? '').trim();
        const agentId = String(record.agentId ?? '').trim();
        if (!permission || !agentId)
            return null;
        return {
            permission,
            agentId,
            paths: normalizePaths(Array.isArray(record.paths) ? record.paths.map(String) : [])
        };
    }).filter((entry) => entry !== null);
}
function normalizePaths(paths) {
    return [...new Set(paths.map((entry) => String(entry).trim().replace(/\\/g, '/')).filter(Boolean))].sort();
}
function normalizeOptional(value) {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : null;
}
function isPathAllowedByAny(file, allowedPaths) {
    return allowedPaths.some((allowed) => isPathAllowed(file, allowed));
}
function isPathAllowed(file, allowed) {
    const normalizedFile = file.replace(/\\/g, '/');
    const normalizedAllowed = allowed.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalizedAllowed)
        return false;
    if (normalizedAllowed.endsWith('/**')) {
        const prefix = normalizedAllowed.slice(0, -3).replace(/\/+$/, '');
        return normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`);
    }
    return normalizedFile === normalizedAllowed || normalizedFile.startsWith(`${normalizedAllowed}/`);
}
