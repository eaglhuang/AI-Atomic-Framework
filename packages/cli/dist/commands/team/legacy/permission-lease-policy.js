import path from 'node:path';
import { coordinatorExclusivePermissions, readOnlyTeamRoles, teamPermissionCatalog, writeTeamPermissions } from './types.js';
export function validateTeamPermissionModel(recipe, writePaths, options = {}) {
    const agentRoles = new Map(recipe.agents.map((agent) => [agent.agentId, agent.role]));
    return mergeValidation(validateTeamRecipe(recipe, agentRoles), validatePermissionLeases(buildSuggestedPermissionLeases(recipe, writePaths, options), agentRoles, options));
}
export function buildProposalFirstParityFindings(input) {
    const admission = input.brokerLaneResult.evidence?.decision?.admission;
    if (input.brokerLaneResult.ok || admission?.state !== 'proposal-submitted') {
        return [];
    }
    const hotFiles = Array.isArray(admission.hotFiles) ? admission.hotFiles.map((entry) => String(entry)) : [];
    return [buildPermissionFinding({
            level: input.advisoryOnly ? 'warning' : 'error',
            code: 'proposal-first-required',
            detail: input.advisoryOnly
                ? `Read-only team plan projection: hot shared surface would require a validated bounded proposal (schema atm.patchProposal.v1) before team start. Author the proposal, then rerun: node atm.mjs team plan --task ${input.taskId} --broker-proposal-file <proposal.json> --json and node atm.mjs team start --task ${input.taskId} --broker-proposal-file <proposal.json> --json. This read-only projection did not persist broker registry state.`
                : `Hot shared surface requires a validated bounded proposal (schema atm.patchProposal.v1) before this team may plan or start. Author the proposal, then rerun: node atm.mjs team plan --task ${input.taskId} --broker-proposal-file <proposal.json> --json (readiness preview) and node atm.mjs team start --task ${input.taskId} --broker-proposal-file <proposal.json> --json (fail-closed execution). To pre-activate through the Broker instead: node atm.mjs broker runtime activate --proposal-file <proposal.json> --json.`,
            paths: hotFiles
        })];
}
export function buildPermissionFinding(input) {
    return {
        level: input.level,
        code: input.code,
        summary: permissionFindingSummary(input),
        detail: input.detail,
        role: input.role,
        permission: input.permission,
        agentIds: input.agentIds,
        paths: input.paths,
        suggestedFix: permissionFindingSuggestedFix(input)
    };
}
function permissionFindingSummary(input) {
    switch (input.code) {
        case 'ATM_TEAM_PERMISSION_UNKNOWN':
            return input.permission
                ? `Unknown permission ${input.permission}.`
                : 'Unknown team permission.';
        case 'ATM_TEAM_PERMISSION_CONFLICT':
            return input.permission
                ? `Exclusive permission ${input.permission} has multiple recipe owners.`
                : 'Exclusive permission has multiple recipe owners.';
        case 'ATM_TEAM_UNIQUE_OWNER_REQUIRED':
            return input.permission
                ? `${input.permission} must stay with the coordinator.`
                : 'Coordinator-only permission has an invalid owner.';
        case 'ATM_TEAM_READONLY_ROLE_WRITE_FORBIDDEN':
            return input.role
                ? `Read-only role ${input.role} must not receive write permissions.`
                : 'Read-only role received a write permission.';
        case 'ATM_TEAM_PERMISSION_SCOPE_REQUIRED':
            return input.permission
                ? `${input.permission} requires explicit scoped paths.`
                : 'Scoped permission is missing lease paths.';
        case 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN':
            return 'Write lease targets forbidden runtime paths.';
        case 'ATM_TEAM_WRITE_SCOPE_OUT_OF_BOUNDS':
            return 'Write lease includes paths outside the task write scope.';
        case 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL':
            return 'Write lease includes unsafe path traversal.';
        case 'ATM_TEAM_PERMISSION_LEASE_CONFLICT':
            return input.permission
                ? `Exclusive permission lease ${input.permission} has multiple owners.`
                : 'Exclusive permission lease has multiple owners.';
        case 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED':
            return 'Team start is blocked by task claim dependency gates.';
        default:
            return input.detail;
    }
}
function permissionFindingSuggestedFix(input) {
    switch (input.code) {
        case 'ATM_TEAM_PERMISSION_UNKNOWN':
            return 'Remove the unknown permission or add it to the team permission catalog before team start.';
        case 'ATM_TEAM_PERMISSION_CONFLICT':
            return input.permission
                ? `Keep ${input.permission} on one role only and remove it from the other agent recipe entries.`
                : 'Assign each exclusive permission to exactly one agent in the recipe.';
        case 'ATM_TEAM_UNIQUE_OWNER_REQUIRED':
            return input.permission
                ? `Grant ${input.permission} only to the coordinator agent and remove it from other roles.`
                : 'Move coordinator-only permissions back to the coordinator agent.';
        case 'ATM_TEAM_READONLY_ROLE_WRITE_FORBIDDEN':
            return input.role
                ? `Remove write permissions from ${input.role}; keep read-only roles on file.read or exec.validator only.`
                : 'Remove write permissions from read-only roles in the recipe.';
        case 'ATM_TEAM_PERMISSION_SCOPE_REQUIRED':
            return input.permission
                ? `Add explicit scoped paths to the ${input.permission} lease before team start.`
                : 'Provide scoped paths for permissions that require a lease boundary.';
        case 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN':
            return 'Remove .atm/runtime/** paths from write leases; runtime state is managed by team start, not leased writes.';
        case 'ATM_TEAM_WRITE_SCOPE_OUT_OF_BOUNDS':
            return 'Request a governed scope amendment or remove the path before team start.';
        case 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL':
            return 'Use repository-relative paths without .. segments or absolute drive roots.';
        case 'ATM_TEAM_PERMISSION_LEASE_CONFLICT':
            return input.permission
                ? `Rebuild suggested leases so only one agent owns ${input.permission}.`
                : 'Ensure each exclusive lease has a single owner before team start.';
        case 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED':
            return 'Close, verify, or reopen the dependency through the normal task lifecycle, then rerun team plan/start.';
        default:
            return 'Review the recipe permissions and suggested leases, then rerun team validate.';
    }
}
function resolveFindingRole(agentRoles, agentIds) {
    const primaryAgentId = agentIds?.[0];
    if (!primaryAgentId)
        return undefined;
    return agentRoles.get(primaryAgentId);
}
function validateTeamRecipe(recipe, agentRoles) {
    const permissionDefinitions = new Map(teamPermissionCatalog.map((entry) => [entry.id, entry]));
    const ownersByPermission = new Map();
    const findings = [];
    for (const agent of recipe.agents) {
        for (const permission of agent.permissions) {
            if (!permissionDefinitions.has(permission)) {
                findings.push(buildPermissionFinding({
                    level: 'error',
                    code: 'ATM_TEAM_PERMISSION_UNKNOWN',
                    detail: `Unknown team permission: ${permission}`,
                    permission,
                    agentIds: [agent.agentId],
                    role: agent.role
                }));
            }
            if (readOnlyTeamRoles.has(agent.role) && writeTeamPermissions.has(permission)) {
                findings.push(buildPermissionFinding({
                    level: 'error',
                    code: 'ATM_TEAM_READONLY_ROLE_WRITE_FORBIDDEN',
                    detail: `Read-only role ${agent.role} must not receive write permission ${permission}.`,
                    permission,
                    agentIds: [agent.agentId],
                    role: agent.role
                }));
            }
            ownersByPermission.set(permission, [...(ownersByPermission.get(permission) ?? []), agent.agentId]);
        }
    }
    for (const permission of teamPermissionCatalog.filter((entry) => entry.mode === 'exclusive')) {
        const owners = ownersByPermission.get(permission.id) ?? [];
        if (owners.length > 1) {
            findings.push(buildPermissionFinding({
                level: 'error',
                code: 'ATM_TEAM_PERMISSION_CONFLICT',
                detail: `Exclusive permission ${permission.id} has multiple owners.`,
                permission: permission.id,
                agentIds: owners,
                role: resolveFindingRole(agentRoles, owners)
            }));
        }
    }
    const coordinator = recipe.agents.find((agent) => agent.role === 'coordinator');
    for (const permission of coordinatorExclusivePermissions) {
        const owners = ownersByPermission.get(permission) ?? [];
        if (owners.length !== 1 || owners[0] !== coordinator?.agentId) {
            findings.push(buildPermissionFinding({
                level: 'error',
                code: 'ATM_TEAM_UNIQUE_OWNER_REQUIRED',
                detail: `${permission} must have exactly one owner and it must be the coordinator.`,
                permission,
                agentIds: owners,
                role: resolveFindingRole(agentRoles, owners)
            }));
        }
    }
    return {
        ok: findings.every((finding) => finding.level !== 'error'),
        findings
    };
}
function validatePermissionLeases(leases, agentRoles, options = {}) {
    const permissionDefinitions = new Map(teamPermissionCatalog.map((entry) => [entry.id, entry]));
    const findings = [];
    const ownersByExclusivePermission = new Map();
    const allowedWritePathSet = new Set((options.allowedWritePaths ?? []).map((entry) => normalizeTeamLeasePath(entry, options.repoRoot)).filter(Boolean));
    for (const lease of leases) {
        const definition = permissionDefinitions.get(lease.permission);
        const role = agentRoles.get(lease.agentId);
        if (!definition) {
            findings.push(buildPermissionFinding({
                level: 'error',
                code: 'ATM_TEAM_PERMISSION_UNKNOWN',
                detail: `Unknown team permission lease: ${lease.permission}`,
                permission: lease.permission,
                agentIds: [lease.agentId],
                role
            }));
            continue;
        }
        if (definition.mode === 'exclusive') {
            ownersByExclusivePermission.set(lease.permission, [
                ...(ownersByExclusivePermission.get(lease.permission) ?? []),
                lease.agentId
            ]);
        }
        if (definition.scopeRequired && (!Array.isArray(lease.paths) || lease.paths.length === 0) && !options.allowEmptyWriteScope) {
            findings.push(buildPermissionFinding({
                level: 'error',
                code: 'ATM_TEAM_PERMISSION_SCOPE_REQUIRED',
                detail: `${lease.permission} requires explicit scoped paths.`,
                permission: lease.permission,
                agentIds: [lease.agentId],
                role
            }));
        }
        const normalizedLeasePaths = (lease.paths ?? []).map((entry) => ({
            raw: entry,
            normalized: normalizeTeamLeasePath(entry, options.repoRoot)
        }));
        const unsafeTraversalPaths = normalizedLeasePaths
            .filter((entry) => isUnsafeTeamLeasePath(entry.raw, entry.normalized, options.repoRoot))
            .map((entry) => entry.raw);
        if (unsafeTraversalPaths.length > 0) {
            findings.push(buildPermissionFinding({
                level: 'error',
                code: 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL',
                detail: `${lease.permission} cannot lease path traversal or absolute paths: ${unsafeTraversalPaths.join(', ')}`,
                permission: lease.permission,
                agentIds: [lease.agentId],
                role,
                paths: unsafeTraversalPaths
            }));
        }
        const forbiddenRuntimePaths = normalizedLeasePaths
            .filter((entry) => entry.normalized.startsWith('.atm/runtime/') || entry.normalized === '.atm/runtime')
            .map((entry) => entry.raw);
        const forbiddenHistoryPaths = normalizedLeasePaths
            .filter((entry) => entry.normalized.startsWith('.atm/history/') || entry.normalized === '.atm/history')
            .map((entry) => entry.raw);
        const forbiddenWritePaths = uniqueStrings([...forbiddenRuntimePaths, ...forbiddenHistoryPaths]);
        if (forbiddenWritePaths.length > 0) {
            findings.push(buildPermissionFinding({
                level: 'error',
                code: 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN',
                detail: `${lease.permission} cannot lease ATM managed runtime/history paths: ${forbiddenWritePaths.join(', ')}`,
                permission: lease.permission,
                agentIds: [lease.agentId],
                role,
                paths: forbiddenWritePaths
            }));
        }
        if (lease.permission === 'file.write' && allowedWritePathSet.size > 0) {
            const outOfBoundsPaths = normalizedLeasePaths
                .filter((entry) => entry.normalized && !allowedWritePathSet.has(entry.normalized))
                .map((entry) => entry.raw);
            if (outOfBoundsPaths.length > 0) {
                findings.push(buildPermissionFinding({
                    level: 'error',
                    code: 'ATM_TEAM_WRITE_SCOPE_OUT_OF_BOUNDS',
                    detail: `file.write lease paths are outside task allowedFiles/deliverables: ${outOfBoundsPaths.join(', ')}`,
                    permission: lease.permission,
                    agentIds: [lease.agentId],
                    role,
                    paths: outOfBoundsPaths
                }));
            }
        }
    }
    return finalizeLeaseValidation(findings, ownersByExclusivePermission, agentRoles);
}
function finalizeLeaseValidation(findings, ownersByExclusivePermission, agentRoles) {
    for (const [permission, owners] of ownersByExclusivePermission.entries()) {
        if (new Set(owners).size > 1) {
            findings.push(buildPermissionFinding({
                level: 'error',
                code: 'ATM_TEAM_PERMISSION_LEASE_CONFLICT',
                detail: `Exclusive permission lease ${permission} has multiple owners.`,
                permission,
                agentIds: owners,
                role: resolveFindingRole(agentRoles, owners)
            }));
        }
    }
    return {
        ok: findings.every((finding) => finding.level !== 'error'),
        findings
    };
}
export function normalizeTeamLeasePath(value, repoRoot) {
    const raw = String(value).trim();
    const repoRelative = normalizeRepoAbsoluteLeasePath(raw, repoRoot);
    const normalized = path.posix.normalize((repoRelative ?? raw).replace(/\\/g, '/'));
    return normalized === '.' ? '' : normalized.replace(/^\.\//, '');
}
export function normalizeRepoAbsoluteLeasePath(rawPath, repoRoot) {
    if (!repoRoot)
        return null;
    const raw = String(rawPath).trim();
    const normalizedRaw = raw.replace(/\\/g, '/');
    if (!/^[A-Za-z]:\//.test(normalizedRaw) && !normalizedRaw.startsWith('/'))
        return null;
    const root = path.resolve(repoRoot);
    const candidate = path.resolve(raw);
    const relative = path.relative(root, candidate);
    if (!relative || relative === '')
        return '';
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        return null;
    return relative.replace(/\\/g, '/');
}
function isUnsafeTeamLeasePath(rawPath, normalizedPath, repoRoot) {
    const raw = String(rawPath).trim().replace(/\\/g, '/');
    const repoRelative = normalizeRepoAbsoluteLeasePath(rawPath, repoRoot);
    const unsafeAbsolute = (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) && repoRelative === null;
    return unsafeAbsolute
        || raw === '..'
        || raw.startsWith('../')
        || raw.includes('/../')
        || normalizedPath === '..'
        || normalizedPath.startsWith('../');
}
export function deriveAllowedWriteScope(task, repoRoot) {
    const explicitAllowed = normalizeTaskPathArray(task?.targetAllowedFiles, repoRoot);
    if (explicitAllowed.length > 0) {
        return uniqueStrings(explicitAllowed);
    }
    return normalizeTaskWriteScope([
        ...normalizeTaskPathArray(task?.deliverables, repoRoot),
        ...normalizeTaskPathArray(task?.scopePaths, repoRoot)
    ], repoRoot);
}
export function normalizeTaskWriteScope(paths, repoRoot) {
    return uniqueStrings(paths.map((entry) => normalizeTeamLeasePath(entry, repoRoot)).filter(Boolean));
}
export function mergeValidation(...reports) {
    const findings = reports.flatMap((report) => report.findings);
    return {
        ok: findings.every((finding) => finding.level !== 'error'),
        findings
    };
}
export function buildSuggestedPermissionLeases(recipe, writePaths, options = {}) {
    const coordinator = recipe.agents.find((agent) => agent.role === 'coordinator') ?? null;
    const fileWriteOwner = recipe.agents.find((agent) => agent.permissions.includes('file.write')) ?? null;
    return [
        ...(coordinator ? [
            { permission: 'task.lifecycle', agentId: coordinator.agentId },
            { permission: 'git.write', agentId: coordinator.agentId },
            { permission: 'evidence.write', agentId: coordinator.agentId },
            { permission: 'handoff.read', agentId: coordinator.agentId, paths: writePaths },
            { permission: 'handoff.materialize', agentId: coordinator.agentId, paths: writePaths }
        ] : []),
        ...(fileWriteOwner && (writePaths.length > 0 || !options.allowEmptyWriteScope) ? [{
                permission: 'file.write',
                agentId: fileWriteOwner.agentId,
                paths: writePaths
            }] : [])
    ];
}
function normalizeTaskPathArray(value, repoRoot) {
    if (!Array.isArray(value))
        return [];
    return value.map((entry) => normalizeTeamLeasePath(String(entry), repoRoot)).filter(Boolean);
}
function uniqueStrings(values) {
    return [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))];
}
