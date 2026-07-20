import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CliError, readJsonFile, writeJsonFile } from '../../shared.js';
export function listTeamRuns(cwd) {
    const directory = teamRunsDirectory(cwd);
    if (!existsSync(directory))
        return [];
    return readdirSync(directory)
        .filter((entry) => entry.endsWith('.json'))
        .sort((left, right) => left.localeCompare(right))
        .map((entry) => readJsonFile(path.join(directory, entry), 'ATM_TEAM_RUN_INVALID'));
}
export function findLatestTeamRunForTask(cwd, taskId) {
    const runs = listTeamRuns(cwd)
        .filter((run) => typeof run === 'object' && run !== null && run.taskId === taskId)
        .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? '').localeCompare(String(left.updatedAt ?? left.createdAt ?? '')));
    return runs[0] ?? null;
}
export function readTeamRun(cwd, teamRunId) {
    const filePath = path.join(teamRunsDirectory(cwd), `${teamRunId}.json`);
    if (!existsSync(filePath)) {
        throw new CliError('ATM_TEAM_RUN_NOT_FOUND', `Team run not found: ${teamRunId}`, {
            exitCode: 2,
            details: { teamRunId, path: path.relative(cwd, filePath).replace(/\\/g, '/') }
        });
    }
    return readJsonFile(filePath, 'ATM_TEAM_RUN_INVALID');
}
export function writeExistingTeamRun(cwd, teamRunId, run) {
    const filePath = path.join(teamRunsDirectory(cwd), `${teamRunId}.json`);
    if (!existsSync(filePath)) {
        throw new CliError('ATM_TEAM_RUN_NOT_FOUND', `Team run not found: ${teamRunId}`, {
            exitCode: 2,
            details: { teamRunId, path: path.relative(cwd, filePath).replace(/\\/g, '/') }
        });
    }
    writeJsonFile(filePath, run);
}
export function teamRunsDirectory(cwd) {
    return path.join(cwd, '.atm', 'runtime', 'team-runs');
}
export function createTeamRunId(taskId, actorId, createdAt) {
    const digest = createHash('sha256')
        .update(`${taskId}\n${actorId}\n${createdAt}`)
        .digest('hex')
        .slice(0, 12);
    return `team-${digest}`;
}
export function compactTeamRun(run) {
    if (!run)
        return {};
    const r = run;
    const brokerGovernance = r.teamSummary?.brokerGovernance ?? null;
    const roles = r.roles;
    const agents = r.agents;
    const leases = r.leases;
    const permissionLeases = r.permissionLeases;
    const brokerSubagent = r.brokerSubagent;
    const runtimeContract = r.runtimeContract;
    const governanceRuntime = r.governanceRuntime ?? null;
    return {
        teamRunId: r.teamRunId,
        taskId: r.taskId,
        recipeId: r.recipeId,
        actorId: r.actorId,
        status: r.status,
        roleCount: Array.isArray(roles) ? roles.length : Array.isArray(agents) ? agents.length : 0,
        leaseCount: Array.isArray(leases) ? leases.length : Array.isArray(permissionLeases) ? permissionLeases.length : 0,
        brokerSubagentEnabled: brokerSubagent?.enabled === true || runtimeContract?.brokerSubagent?.enabled === true,
        brokerDecisionSurface: brokerSubagent?.decisionSurface ?? runtimeContract?.brokerSubagent?.decisionSurface ?? null,
        brokerStewardId: brokerSubagent?.stewardId ?? runtimeContract?.brokerSubagent?.stewardId ?? null,
        brokerGovernanceSummaryId: brokerGovernance?.schemaId ?? null,
        runtimePilotMode: run?.runtimePilot?.pilotMode ?? null,
        runtimePilotRoles: normalizeStringArray(r.runtimePilot?.selectedRoles),
        decisionClass: governanceRuntime?.decisionClass ?? r.decisionClass ?? null,
        decisionReason: governanceRuntime?.decisionReason ?? r.decisionReason ?? null,
        requiresHumanSignoff: governanceRuntime?.requiresHumanSignoff ?? r.requiresHumanSignoff ?? false,
        requiresAdr: governanceRuntime?.requiresAdr ?? r.requiresAdr ?? false,
        violationStatus: governanceRuntime?.violationStatus ?? r.violationStatus ?? null,
        escalationTarget: governanceRuntime?.escalationTarget ?? r.escalationTarget ?? null,
        brokerEvidenceRequired: normalizeStringArray(brokerGovernance?.brokerEvidenceRequired ?? brokerSubagent?.evidenceRequired ?? runtimeContract?.brokerSubagent?.evidenceRequired),
        commitLaneSerializedBy: brokerGovernance?.commitLaneSerializedBy ?? runtimeContract?.commitLane?.serializedBy ?? null,
        commitLaneOwnerRole: brokerGovernance?.commitLaneOwnerRole ?? runtimeContract?.commitLane?.ownerRole ?? null,
        workerGitWrite: brokerGovernance?.workerGitWrite ?? runtimeContract?.workerAdapter?.authorityBoundary?.gitWrite ?? null,
        workerTaskLifecycle: brokerGovernance?.workerTaskLifecycle ?? runtimeContract?.workerAdapter?.authorityBoundary?.taskLifecycle ?? null,
        workerSelfClose: brokerGovernance?.workerSelfClose ?? runtimeContract?.workerAdapter?.authorityBoundary?.selfClose ?? null,
        agentsSpawned: r.agentsSpawned === true,
        completedAt: r.completedAt ?? null,
        completedBy: r.completedBy ?? null,
        abandonedAt: r.abandonedAt ?? null,
        abandonedBy: r.abandonedBy ?? null,
        lifecycleEventCount: Array.isArray(r.lifecycleEvents) ? r.lifecycleEvents.length : 0,
        createdAt: r.createdAt ?? null,
        updatedAt: r.updatedAt ?? null
    };
}
export function summarizeTeamPermissionLeases(input) {
    return input.leases
        .filter((lease) => lease.permission === input.permission)
        .map((lease) => ({
        permission: lease.permission,
        agentId: lease.agentId,
        paths: [...(lease.paths ?? [])],
        releaseCommand: `node atm.mjs team release --team ${input.teamRunId} --actor ${lease.agentId} --permission ${lease.permission} --json`
    }));
}
export function buildTeamLeaseConflictDetails(input) {
    const activeLeases = summarizeTeamPermissionLeases({
        teamRunId: input.teamRunId,
        permission: input.permission,
        leases: input.currentLeases
    });
    const currentOwnerPaths = [...(input.conflict.paths ?? [])];
    const currentOwnerReleaseCommand = `node atm.mjs team release --team ${input.teamRunId} --actor ${input.conflict.agentId} --permission ${input.permission} --json`;
    return {
        teamRunId: input.teamRunId,
        permission: input.permission,
        currentOwner: input.conflict.agentId,
        currentOwnerPaths,
        currentOwnerReleaseCommand,
        requestedOwner: input.requestedOwner,
        activeLeases,
        requiredCommand: currentOwnerReleaseCommand
    };
}
export function buildTeamLeaseNotFoundDetails(input) {
    const activeLeases = summarizeTeamPermissionLeases({
        teamRunId: input.teamRunId,
        permission: input.permission,
        leases: input.currentLeases
    });
    return {
        teamRunId: input.teamRunId,
        permission: input.permission,
        actorId: input.actorId,
        activeLeases,
        holderCount: activeLeases.length,
        requiredCommand: activeLeases[0]?.releaseCommand ?? null
    };
}
export function normalizePermissionLeaseRecords(value) {
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
            paths: normalizeStringArray(record.paths)
        };
    }).filter((entry) => entry !== null);
}
function normalizeStringArray(value) {
    return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}
