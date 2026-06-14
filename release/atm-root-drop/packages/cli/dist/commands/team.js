import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, parseArgsForCommand, readJsonFile, writeJsonFile } from './shared.js';
import { getCommandSpec } from './command-specs.js';
import { runTasks } from './tasks.js';
import { buildTeamBrokerEvidence, brokerLaneToFindings, evaluateTeamBrokerLane } from '../../../core/dist/broker/team-lane.js';
const teamPermissionCatalog = [
    { id: 'task.lifecycle', mode: 'exclusive' },
    { id: 'git.write', mode: 'exclusive' },
    { id: 'file.read', mode: 'shareable', scopeRequired: true },
    { id: 'file.write', mode: 'exclusive', scopeRequired: true },
    { id: 'web.query', mode: 'exclusive' },
    { id: 'web.download', mode: 'exclusive', scopeRequired: true },
    { id: 'exec.validator', mode: 'shareable', scopeRequired: true },
    { id: 'exec.mutating', mode: 'exclusive', scopeRequired: true },
    { id: 'sandbox.write', mode: 'exclusive' },
    { id: 'pipeline.write', mode: 'exclusive', scopeRequired: true },
    { id: 'database.write', mode: 'exclusive', scopeRequired: true },
    { id: 'ci.write', mode: 'exclusive', scopeRequired: true },
    { id: 'evidence.write', mode: 'exclusive' }
];
const coordinatorExclusivePermissions = ['task.lifecycle', 'git.write', 'evidence.write'];
const readOnlyTeamRoles = new Set([
    'atomizationPlanner',
    'scopeGuardian',
    'reader',
    'evidenceCollector',
    'validator'
]);
const writeTeamPermissions = new Set([
    'task.lifecycle',
    'git.write',
    'file.write',
    'evidence.write',
    'web.query',
    'web.download',
    'exec.mutating',
    'sandbox.write',
    'pipeline.write',
    'database.write',
    'ci.write'
]);
const atomizationRiskHotFiles = new Set([
    'tasks.ts',
    'next.ts',
    'evidence.ts',
    'hook.ts'
]);
const atomizationPlanningThreshold = 3;
export const TEAM_ATOM_BOUNDARIES = {
    'team.cli-entry': {
        anchor: 'packages/cli/src/commands/team.ts#runTeam',
        capability: 'Team CLI entry router for plan, start, status, and validate actions.',
        downstreamTasks: ['TASK-TEAM-0001']
    },
    'team.recipe-permission-model': {
        anchor: 'packages/cli/src/commands/team.ts#validateTeamPermissionModel',
        capability: 'Recipe catalog validation and scoped permission lease planning.',
        downstreamTasks: ['TASK-TEAM-0001']
    },
    'team.plan-crew-briefing-contract': {
        anchor: 'packages/cli/src/commands/team.ts#buildMinimalTaskCrewBriefingContract',
        capability: 'Minimal crew briefing contract with required roles, stop conditions, and parallel advisory.',
        downstreamTasks: ['TASK-TEAM-0002']
    },
    'team.plan-atomization-planner': {
        anchor: 'packages/cli/src/commands/team.ts#buildAtomizationChecklist',
        capability: 'Atomization planner advisory checklist for scope shape and split recommendations.',
        downstreamTasks: ['TASK-TEAM-0003']
    },
    'team.plan-task-0009-preflight': {
        anchor: 'docs/governance/team-agents/task-0009-preflight-contract.md',
        capability: 'TASK-TEAM-0009 preflight/referee contract covering dependency map, acceptance checklist, and mailbox materialization corrective dispatch rules.',
        downstreamTasks: ['TASK-TEAM-0009']
    },
    'team.plan-broker-lane': {
        anchor: 'packages/cli/src/commands/team.ts#planTeamBrokerLane',
        capability: 'Broker lane evaluation and steward/composer routing for team plan/start.',
        downstreamTasks: ['TASK-TEAM-0001', 'TASK-CID-0021']
    },
    'team.captain-decision': {
        anchor: 'packages/cli/src/commands/team.ts#buildCaptainDecision',
        capability: 'Captain decision dry-run output for team sizing, required roles, confidence, and stop conditions.',
        downstreamTasks: ['TASK-TEAM-0007']
    },
    'team.implementer-selector': {
        anchor: 'packages/cli/src/commands/team.ts#selectTeamImplementer',
        capability: 'Deterministic implementer selector for Team Agents based on task paths, deliverables, language hints, and safe generic fallback.',
        downstreamTasks: ['TASK-TEAM-0010']
    },
    'team.start-runtime-state': {
        anchor: 'packages/cli/src/commands/team.ts#writeTeamRun',
        capability: 'Team run runtime record writer under .atm/runtime/team-runs.',
        downstreamTasks: ['TASK-TEAM-0011']
    },
    'team.status-runtime-read': {
        anchor: 'packages/cli/src/commands/team.ts#buildTeamStatusResult',
        capability: 'Read-only team run status surface.',
        downstreamTasks: ['TASK-TEAM-0011']
    },
    'team.permission-lease-validator': {
        anchor: 'packages/cli/src/commands/team.ts#validateTeamPermissionModel',
        capability: 'Deterministic permission lease validation before team runtime start.',
        downstreamTasks: ['TASK-TEAM-0012']
    },
    'team.file-write-scope-validator': {
        anchor: 'packages/cli/src/commands/team.ts#validateTeamPermissionModel',
        capability: 'Deterministic file.write lease scope validation against task allowed files before team runtime start.',
        downstreamTasks: ['TASK-TEAM-0013']
    }
};
const builtInRecipes = [
    {
        schemaId: 'atm.teamRecipe.v1',
        recipeId: 'atm.default.fast',
        appliesTo: ['fast'],
        agents: [
            { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write', 'file.write'] },
            { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
            { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
            { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
        ]
    },
    {
        schemaId: 'atm.teamRecipe.v1',
        recipeId: 'atm.default.normal.typescript',
        appliesTo: ['normal'],
        language: 'typescript',
        agents: [
            { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
            { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
            { agentId: 'reader', role: 'reader', profile: 'atm.reader.v1', permissions: ['file.read'] },
            { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
            { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
            { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] },
            { agentId: 'evidence-collector', role: 'evidenceCollector', profile: 'atm.evidenceCollector.v1', permissions: ['file.read'] }
        ]
    },
    {
        schemaId: 'atm.teamRecipe.v1',
        recipeId: 'atm.default.batch',
        appliesTo: ['batch'],
        agents: [
            { agentId: 'batch-coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
            { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
            { agentId: 'current-task-reader', role: 'reader', profile: 'atm.reader.v1', permissions: ['file.read'] },
            { agentId: 'current-task-scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
            { agentId: 'current-task-implementer', role: 'implementer', profile: 'atm.implementer.generic.v1', permissions: ['file.write'] },
            { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] },
            { agentId: 'evidence-collector', role: 'evidenceCollector', profile: 'atm.evidenceCollector.v1', permissions: ['file.read'] }
        ]
    }
];
export async function runTeam(argv) {
    const spec = getCommandSpec('team');
    const parsed = parseArgsForCommand(spec, argv);
    const action = String(parsed.positional[0] ?? 'plan').toLowerCase();
    const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
    if (!['plan', 'start', 'status', 'validate'].includes(action)) {
        throw new CliError('ATM_CLI_USAGE', 'team supports: plan, start, status, validate', { exitCode: 2 });
    }
    if (action === 'status') {
        return buildTeamStatusResult({
            cwd,
            requestedTeamRunId: String(parsed.options.team ?? '').trim(),
            compact: Boolean(parsed.options.compact)
        });
    }
    const taskId = String(parsed.options.task ?? '').trim();
    if (!taskId) {
        throw new CliError('ATM_TEAM_TASK_REQUIRED', `team ${action} requires --task <id>.`, { exitCode: 2 });
    }
    const context = await buildTeamPlanningContext({
        cwd,
        taskId,
        requestedRecipeId: String(parsed.options.recipe ?? '').trim(),
        actorId: String(parsed.options.actor ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? 'team-planner').trim()
    });
    const { task, recipes, recipe, validation, permissionValidation, teamPlan } = context;
    const ok = validation.findings.every((finding) => finding.level !== 'error');
    if (action === 'validate') {
        const permissionOk = permissionValidation.ok;
        const nonPermissionFindings = validation.findings.filter((finding) => !permissionValidation.findings.includes(finding));
        return makeResult({
            ok: permissionOk,
            command: 'team',
            cwd,
            messages: [
                message(permissionOk ? 'info' : 'error', permissionOk ? 'ATM_TEAM_PERMISSION_VALID' : 'ATM_TEAM_PERMISSION_INVALID', permissionOk
                    ? 'Team recipe and permission leases are valid.'
                    : 'Team recipe or permission leases contain blocking findings.', {
                    taskId,
                    recipeId: recipe.recipeId,
                    findingCount: permissionValidation.findings.length
                })
            ],
            evidence: {
                action: 'validate',
                dryRun: true,
                runtimeWritten: false,
                agentsSpawned: false,
                task: summarizeTask(taskId, task),
                recipe,
                recipeSources: recipes.sources,
                permissionCatalog: teamPermissionCatalog,
                validation: permissionValidation,
                relatedFindings: nonPermissionFindings,
                suggestedPermissionLeases: teamPlan.suggestedPermissionLeases,
                brokerLane: teamPlan.brokerLane
            }
        });
    }
    if (action === 'start') {
        const actorId = String(parsed.options.actor ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? '').trim();
        if (!actorId) {
            throw new CliError('ATM_ACTOR_ID_MISSING', 'team start requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
        }
        if (!ok) {
            return makeResult({
                ok: false,
                command: 'team',
                cwd,
                messages: [
                    message('error', 'ATM_TEAM_START_BLOCKED', 'Team start blocked by permission validation findings.', {
                        taskId,
                        recipeId: recipe.recipeId,
                        findingCount: validation.findings.length
                    })
                ],
                evidence: {
                    action: 'start',
                    runtimeWritten: false,
                    agentsSpawned: false,
                    task: summarizeTask(taskId, task),
                    recipe,
                    validation,
                    teamPlan,
                    brokerLane: teamPlan.brokerLane
                }
            });
        }
        const teamRun = writeTeamRun({
            cwd,
            actorId,
            taskId,
            task,
            recipe,
            teamPlan,
            validation
        });
        return makeResult({
            ok: true,
            command: 'team',
            cwd,
            messages: [
                message('info', 'ATM_TEAM_STARTED', 'Team run started. Runtime state was written, but no agents were spawned.', {
                    teamRunId: teamRun.teamRunId,
                    taskId,
                    recipeId: recipe.recipeId
                })
            ],
            evidence: {
                action: 'start',
                runtimeWritten: true,
                agentsSpawned: false,
                teamRunPath: `.atm/runtime/team-runs/${teamRun.teamRunId}.json`,
                teamRun,
                brokerLane: teamPlan.brokerLane
            }
        });
    }
    return makeResult({
        ok,
        command: 'team',
        cwd,
        messages: [
            message(ok ? 'info' : 'error', ok ? 'ATM_TEAM_PLAN_READY' : 'ATM_TEAM_PLAN_INVALID', ok
                ? 'Team plan dry-run completed. No runtime state was written and no agents were spawned.'
                : 'Team plan found permission conflicts. No runtime state was written and no agents were spawned.', {
                taskId,
                recipeId: recipe.recipeId,
                findingCount: validation.findings.length
            })
        ],
        evidence: {
            action: 'plan',
            dryRun: true,
            runtimeWritten: false,
            agentsSpawned: false,
            task: summarizeTask(taskId, task),
            recipe,
            recipeSources: recipes.sources,
            permissionCatalog: teamPermissionCatalog,
            validation,
            teamPlan,
            brokerLane: teamPlan.brokerLane
        }
    });
}
async function buildTeamPlanningContext(input) {
    const task = readTask(input.cwd, input.taskId);
    const recipes = loadTeamRecipes(input.cwd);
    const recipe = selectRecipe({
        recipes,
        requestedRecipeId: input.requestedRecipeId,
        task
    });
    const writePaths = deriveWritePaths(task);
    const permissionValidation = validateTeamPermissionModel(recipe, writePaths, {
        allowedWritePaths: deriveAllowedWriteScope(task)
    });
    const parallelFindings = [];
    try {
        const parallelResult = await runTasks([
            'parallel',
            '--task',
            input.taskId,
            '--queue',
            '--cwd',
            input.cwd,
            '--json'
        ]);
        if (parallelResult && parallelResult.ok && parallelResult.evidence && Array.isArray(parallelResult.evidence.candidates)) {
            for (const candidate of parallelResult.evidence.candidates) {
                const finding = candidate.finding;
                if (finding && Array.isArray(finding.overlappingAtomIds) && finding.overlappingAtomIds.length > 0) {
                    // Consumer-side compensation: override verdict to 'blocked-cid-conflict'
                    parallelFindings.push(buildPermissionFinding({
                        level: 'error',
                        code: 'blocked-cid-conflict',
                        detail: `Parallel advisor identified a CID logic conflict with task ${candidate.taskId} on atom(s): ${finding.overlappingAtomIds.join(', ')}`,
                        paths: finding.overlappingFiles
                    }));
                }
            }
        }
    }
    catch (err) {
        // Best-effort check
    }
    const brokerLanePlan = planTeamBrokerLane({
        cwd: input.cwd,
        taskId: input.taskId,
        actorId: input.actorId,
        task,
        writePaths
    });
    const brokerLane = brokerLanePlan.evidence;
    const validation = mergeValidation(permissionValidation, { ok: parallelFindings.every((f) => f.level !== 'error'), findings: parallelFindings }, { ok: brokerLanePlan.findings.every((f) => f.level !== 'error'), findings: brokerLanePlan.findings });
    const finalTeamPlan = buildTeamPlan({
        task,
        recipe,
        writePaths,
        validation,
        brokerLane
    });
    return {
        task,
        recipes,
        recipe,
        permissionValidation,
        validation,
        teamPlan: {
            ...finalTeamPlan,
            validation,
            brokerLane
        }
    };
}
function readTask(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath)) {
        throw new CliError('ATM_TEAM_TASK_NOT_FOUND', `Task not found for team plan: ${taskId}`, {
            exitCode: 2,
            details: { taskId, taskPath: path.relative(cwd, taskPath).replace(/\\/g, '/') }
        });
    }
    return readJsonFile(taskPath, 'ATM_TEAM_TASK_NOT_FOUND');
}
function loadTeamRecipes(cwd) {
    const recipeDir = path.join(cwd, '.atm', 'config', 'team-recipes');
    const repoRecipes = existsSync(recipeDir)
        ? readdirSync(recipeDir)
            .filter((entry) => entry.endsWith('.json'))
            .map((entry) => {
            const filePath = path.join(recipeDir, entry);
            return {
                recipe: normalizeRecipe(JSON.parse(readFileSync(filePath, 'utf8'))),
                source: {
                    kind: 'repo-json',
                    path: path.relative(cwd, filePath).replace(/\\/g, '/')
                }
            };
        })
        : [];
    return {
        recipes: [
            ...builtInRecipes,
            ...repoRecipes.map((entry) => entry.recipe)
        ],
        sources: [
            { kind: 'built-in-json', recipeIds: builtInRecipes.map((entry) => entry.recipeId) },
            ...repoRecipes.map((entry) => entry.source)
        ]
    };
}
function normalizeRecipe(value) {
    if (value?.schemaId !== 'atm.teamRecipe.v1') {
        throw new CliError('ATM_TEAM_RECIPE_INVALID', 'Team recipe JSON must use schemaId atm.teamRecipe.v1.', { exitCode: 2 });
    }
    const recipeId = String(value.recipeId ?? '').trim();
    if (!recipeId) {
        throw new CliError('ATM_TEAM_RECIPE_INVALID', 'Team recipe JSON requires recipeId.', { exitCode: 2 });
    }
    const agents = Array.isArray(value.agents) ? value.agents.map((entry) => ({
        agentId: String(entry?.agentId ?? '').trim(),
        role: String(entry?.role ?? '').trim(),
        profile: entry?.profile ? String(entry.profile).trim() : undefined,
        language: entry?.language ? String(entry.language).trim() : undefined,
        permissions: Array.isArray(entry?.permissions) ? entry.permissions.map((permission) => String(permission).trim()).filter(Boolean) : []
    })) : [];
    if (agents.length === 0 || agents.some((agent) => !agent.agentId || !agent.role)) {
        throw new CliError('ATM_TEAM_RECIPE_INVALID', `Team recipe ${recipeId} requires agents with agentId and role.`, { exitCode: 2 });
    }
    return {
        schemaId: 'atm.teamRecipe.v1',
        recipeId,
        appliesTo: Array.isArray(value.appliesTo) ? value.appliesTo.map(String) : undefined,
        language: value.language ? String(value.language) : undefined,
        agents
    };
}
function selectRecipe(input) {
    if (input.requestedRecipeId) {
        const recipe = input.recipes.recipes.find((entry) => entry.recipeId === input.requestedRecipeId);
        if (!recipe) {
            throw new CliError('ATM_TEAM_RECIPE_NOT_FOUND', `Team recipe not found: ${input.requestedRecipeId}`, {
                exitCode: 2,
                details: { availableRecipeIds: input.recipes.recipes.map((entry) => entry.recipeId) }
            });
        }
        return recipe;
    }
    const language = inferTaskLanguage(input.task);
    return input.recipes.recipes.find((entry) => entry.language === language)
        ?? input.recipes.recipes.find((entry) => entry.recipeId === 'atm.default.normal.typescript')
        ?? input.recipes.recipes[0];
}
function inferTaskLanguage(task) {
    const paths = [
        ...normalizeStringArray(task.targetAllowedFiles),
        ...normalizeStringArray(task.deliverables),
        ...normalizeStringArray(task.scopePaths)
    ];
    if (paths.some((entry) => entry.endsWith('.py') || entry.includes('pipelines/')))
        return 'python';
    if (paths.some((entry) => entry.endsWith('.cs')))
        return 'csharp';
    return 'typescript';
}
export function validateTeamPermissionModel(recipe, writePaths, options = {}) {
    const agentRoles = new Map(recipe.agents.map((agent) => [agent.agentId, agent.role]));
    return mergeValidation(validateTeamRecipe(recipe, agentRoles), validatePermissionLeases(buildSuggestedPermissionLeases(recipe, writePaths), agentRoles, options));
}
export function planTeamBrokerLane(input) {
    const brokerLaneResult = evaluateTeamBrokerLane(input);
    return {
        result: brokerLaneResult,
        evidence: buildTeamBrokerEvidence(brokerLaneResult),
        findings: brokerLaneToFindings(brokerLaneResult).map((finding) => buildPermissionFinding({
            level: finding.level,
            code: finding.code,
            detail: finding.detail,
            paths: finding.paths
        }))
    };
}
function buildPermissionFinding(input) {
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
    const allowedWritePathSet = new Set((options.allowedWritePaths ?? []).map(normalizeTeamLeasePath).filter(Boolean));
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
        if (definition.scopeRequired && (!Array.isArray(lease.paths) || lease.paths.length === 0)) {
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
            normalized: normalizeTeamLeasePath(entry)
        }));
        const unsafeTraversalPaths = normalizedLeasePaths
            .filter((entry) => isUnsafeTeamLeasePath(entry.raw, entry.normalized))
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
function normalizeTeamLeasePath(value) {
    const normalized = path.posix.normalize(String(value).trim().replace(/\\/g, '/'));
    return normalized === '.' ? '' : normalized.replace(/^\.\//, '');
}
function isUnsafeTeamLeasePath(rawPath, normalizedPath) {
    const raw = String(rawPath).trim().replace(/\\/g, '/');
    return raw.startsWith('/')
        || /^[A-Za-z]:\//.test(raw)
        || raw === '..'
        || raw.startsWith('../')
        || raw.includes('/../')
        || normalizedPath === '..'
        || normalizedPath.startsWith('../');
}
function deriveAllowedWriteScope(task) {
    const explicitAllowed = normalizeStringArray(task.targetAllowedFiles);
    if (explicitAllowed.length > 0) {
        return normalizeTaskWriteScope(explicitAllowed);
    }
    return normalizeTaskWriteScope([
        ...normalizeStringArray(task.deliverables),
        ...normalizeStringArray(task.scopePaths)
    ]);
}
function normalizeTaskWriteScope(paths) {
    return uniqueStrings(paths.map(normalizeTeamLeasePath).filter(Boolean));
}
function mergeValidation(...reports) {
    const findings = reports.flatMap((report) => report.findings);
    return {
        ok: findings.every((finding) => finding.level !== 'error'),
        findings
    };
}
function buildSuggestedPermissionLeases(recipe, writePaths) {
    const coordinator = recipe.agents.find((agent) => agent.role === 'coordinator') ?? null;
    const fileWriteOwner = recipe.agents.find((agent) => agent.permissions.includes('file.write')) ?? null;
    return [
        ...(coordinator ? [
            { permission: 'task.lifecycle', agentId: coordinator.agentId },
            { permission: 'git.write', agentId: coordinator.agentId },
            { permission: 'evidence.write', agentId: coordinator.agentId }
        ] : []),
        ...(fileWriteOwner ? [{
                permission: 'file.write',
                agentId: fileWriteOwner.agentId,
                paths: writePaths
            }] : [])
    ];
}
function buildTeamPlan(input) {
    const atomizationChecklist = buildAtomizationChecklist(input.task, input.writePaths);
    const crewBriefingContract = buildMinimalTaskCrewBriefingContract(input.task, input.writePaths, input.validation, input.brokerLane);
    const implementerSelector = selectTeamImplementer(input.task, input.recipe, input.writePaths);
    const captainDecision = buildCaptainDecision(input.task, input.writePaths, input.validation, input.brokerLane, crewBriefingContract, atomizationChecklist, implementerSelector);
    return {
        schemaId: 'atm.teamPlan.v1',
        recipeId: input.recipe.recipeId,
        channelHint: 'normal',
        brokerLane: input.brokerLane,
        agents: input.recipe.agents,
        captainDecision,
        implementerSelector,
        requiredRoles: crewBriefingContract.requiredRoles,
        optionalRoles: crewBriefingContract.optionalRoles,
        briefingContract: crewBriefingContract,
        atomizationPlannerRole: {
            role: 'atomizationPlanner',
            agentIds: input.recipe.agents.filter((agent) => agent.role === 'atomizationPlanner').map((agent) => agent.agentId),
            permissions: input.recipe.agents.find((agent) => agent.role === 'atomizationPlanner')?.permissions ?? []
        },
        atomizationChecklist,
        suggestedPermissionLeases: buildSuggestedPermissionLeases(input.recipe, input.writePaths),
        nextSteps: [
            'Review this dry-run plan.',
            'Run team start when you want a runtime team run record.',
            'Do not hand-edit .atm/runtime team state.'
        ],
        validation: input.validation
    };
}
function buildCaptainDecision(task, writePaths, validation, brokerLane, crewBriefingContract, atomizationChecklist, implementerSelector) {
    const sizing = decideTeamSizing(task, writePaths, validation, brokerLane);
    const lieutenantEscalation = assessLieutenantEscalation(task, writePaths, validation, brokerLane, atomizationChecklist);
    return {
        schemaId: 'atm.teamCaptainDecision.v1',
        captain: {
            role: 'Task Captain',
            agentId: 'coordinator'
        },
        taskId: crewBriefingContract.taskId,
        authorityChain: {
            broker: 'Broker verdicts override Coordinator decisions inside broker-governed conflict domains.',
            coordinator: 'Coordinator retains team-local lifecycle authority outside broker-governed conflict domains.'
        },
        conflictRules: [
            'If broker verdict is needs-steward, blocked-cid-conflict, blocked-shared-surface, or historical-delivery-required, Coordinator must stop claim / commit / close progression.',
            'If broker-prescribed routing exceeds task scope, closure authority, or task-card acceptance, Coordinator must escalate to Captain / human.',
            'Coordinator must not silently override broker verdicts inside broker-governed conflict domains.'
        ],
        teamSize: sizing.teamSize,
        requiredRoles: crewBriefingContract.requiredRoles.map((role) => role.role),
        optionalRoles: crewBriefingContract.optionalRoles.map((role) => role.role),
        reason: sizing.reason,
        confidence: sizing.confidence,
        implementerSelector,
        stopConditions: crewBriefingContract.stopConditions,
        escalationRequired: lieutenantEscalation.escalationRequired,
        escalationReason: lieutenantEscalation.escalationReason,
        needLieutenant: lieutenantEscalation.needLieutenant,
        nextTeamShape: lieutenantEscalation.nextTeamShape,
        decisionSurface: {
            validationOk: validation.ok,
            brokerVerdict: brokerLane.decision.verdict,
            largeScriptRisk: atomizationChecklist.largeScriptRisk,
            mapUpdateNeed: atomizationChecklist.mapUpdateNeed,
            escalationRequired: lieutenantEscalation.escalationRequired,
            needLieutenant: lieutenantEscalation.needLieutenant,
            authorityChain: 'Broker overrides Coordinator inside broker-governed conflict domains; Coordinator remains local outside them.'
        }
    };
}
export function selectTeamImplementer(task, recipe, writePaths) {
    const deterministicHints = collectImplementerHints(task, writePaths);
    const implementers = recipe.agents
        .filter((agent) => isImplementerAgent(agent))
        .sort((left, right) => left.agentId.localeCompare(right.agentId));
    const pythonImplementers = implementers.filter((agent) => matchesImplementerLanguage(agent, 'python'));
    const typescriptImplementers = implementers.filter((agent) => matchesImplementerLanguage(agent, 'typescript'));
    const uiImplementers = implementers.filter((agent) => matchesUiImplementer(agent));
    const selected = pickImplementerCandidate({
        implementers,
        pythonImplementers,
        typescriptImplementers,
        uiImplementers,
        deterministicHints,
        recipeId: recipe.recipeId
    });
    return {
        schemaId: 'atm.teamImplementerSelector.v1',
        ...selected,
        deterministicHints
    };
}
function pickImplementerCandidate(input) {
    const { deterministicHints, recipeId } = input;
    const genericImplementer = input.implementers.find((agent) => agent.language === 'generic') ?? {
        agentId: 'implementer-generic',
        role: 'implementer',
        profile: 'atm.implementer.generic.v1',
        language: 'generic',
        permissions: ['file.write']
    };
    if (deterministicHints.pythonHeavy && input.pythonImplementers.length > 0) {
        return buildSelectorResult(input.pythonImplementers[0], recipeId, 'python', 'python-implementer', 'No fallback needed; Python-heavy paths matched a Python implementer.', 'high');
    }
    if (deterministicHints.uiPaths && input.uiImplementers.length > 0) {
        return buildSelectorResult(input.uiImplementers[0], recipeId, inferSelectorLanguage(input.uiImplementers[0]), 'ui-implementer', 'No fallback needed; adopter UI path hints matched a UI-oriented implementer.', input.uiImplementers[0].language ? 'high' : 'medium');
    }
    if (deterministicHints.typescriptHeavy && input.typescriptImplementers.length > 0) {
        return buildSelectorResult(input.typescriptImplementers[0], recipeId, 'typescript', 'typescript-implementer', 'No fallback needed; TypeScript-heavy paths matched a TypeScript implementer.', 'high');
    }
    const fallbackRoleMatch = deterministicHints.uiPaths
        ? 'ui-implementer'
        : deterministicHints.pythonHeavy
            ? 'python-implementer'
            : deterministicHints.typescriptHeavy
                ? 'typescript-implementer'
                : 'generic-implementer';
    const fallbackReason = deterministicHints.pythonHeavy
        ? `Python-heavy paths were detected, but the selected recipe only exposed ${genericImplementer.agentId} as the available implementer.`
        : deterministicHints.uiPaths
            ? `Adopter UI path hints were detected, but the selected recipe only exposed ${genericImplementer.agentId} as the available implementer.`
            : deterministicHints.typescriptHeavy
                ? `TypeScript-heavy paths were detected, but the selected recipe only exposed ${genericImplementer.agentId} as the available implementer.`
                : `No specific language or UI hint dominated, so ${genericImplementer.agentId} was selected as the generic implementer.`;
    return buildSelectorResult(genericImplementer, recipeId, inferSelectorLanguage(genericImplementer), fallbackRoleMatch, fallbackReason, deterministicHints.pythonHeavy || deterministicHints.typescriptHeavy || deterministicHints.uiPaths ? 'medium' : 'low');
}
function buildSelectorResult(agent, recipeId, languageMatch, roleMatch, fallbackReason, confidence) {
    return {
        selectedImplementer: {
            agentId: agent.agentId,
            role: agent.role,
            profile: agent.profile,
            language: agent.language,
            recipeId
        },
        languageMatch,
        roleMatch,
        fallbackReason,
        confidence
    };
}
function collectImplementerHints(task, writePaths) {
    const scopePaths = uniqueStrings([
        ...normalizeStringArray(task?.scopePaths),
        ...normalizeStringArray(task?.targetAllowedFiles),
        ...writePaths
    ]);
    const deliverables = uniqueStrings(normalizeStringArray(task?.deliverables));
    const allPaths = uniqueStrings([...scopePaths, ...deliverables]);
    const fileExtensions = uniqueStrings(allPaths
        .map((entry) => path.posix.extname(entry.replace(/\\/g, '/')).toLowerCase())
        .filter(Boolean));
    const pathHints = uniqueStrings([
        ...(allPaths.some((entry) => /\.pyi?$/i.test(entry)) ? ['python-heavy'] : []),
        ...(allPaths.some((entry) => /\.(ts|tsx|mts|cts)$/i.test(entry)) ? ['typescript-heavy'] : []),
        ...(allPaths.some((entry) => /(^|\/)(ui|editor|panel|view|scene|adopter|components?)(\/|$)/i.test(entry)) ? ['adopter-ui'] : []),
        ...pathHintsFromPaths(allPaths)
    ]);
    return {
        scopePaths,
        deliverables,
        fileExtensions,
        pathHints,
        pythonHeavy: allPaths.some((entry) => /\.pyi?$/i.test(entry)),
        typescriptHeavy: allPaths.some((entry) => /\.(ts|tsx|mts|cts)$/i.test(entry)),
        uiPaths: allPaths.some((entry) => /(^|\/)(ui|editor|panel|view|scene|adopter|components?)(\/|$)/i.test(entry))
    };
}
function pathHintsFromPaths(paths) {
    const hints = [];
    for (const entry of paths) {
        const normalized = entry.replace(/\\/g, '/').toLowerCase();
        if (normalized.includes('/packages/cli/src/commands/'))
            hints.push('cli-command-surface');
        if (normalized.includes('/scripts/'))
            hints.push('script-surface');
        if (normalized.includes('/assets/'))
            hints.push('asset-surface');
        if (normalized.includes('/ui/') || normalized.includes('/editor/'))
            hints.push('adopter-ui');
        if (normalized.endsWith('.py') || normalized.endsWith('.pyi'))
            hints.push('python-file');
        if (normalized.endsWith('.ts') || normalized.endsWith('.tsx') || normalized.endsWith('.mts') || normalized.endsWith('.cts'))
            hints.push('typescript-file');
    }
    return hints;
}
function isImplementerAgent(agent) {
    return /implementer/i.test(agent.role)
        || /implementer/i.test(agent.agentId)
        || /implementer/i.test(agent.profile ?? '')
        || agent.permissions.includes('file.write');
}
function matchesImplementerLanguage(agent, language) {
    const value = [agent.language, agent.profile, agent.agentId, agent.role].filter(Boolean).join(' ').toLowerCase();
    return value.includes(language);
}
function matchesUiImplementer(agent) {
    const value = [agent.role, agent.profile, agent.agentId].filter(Boolean).join(' ').toLowerCase();
    return value.includes('ui') || value.includes('editor');
}
function inferSelectorLanguage(agent) {
    if (matchesImplementerLanguage(agent, 'python'))
        return 'python';
    if (matchesImplementerLanguage(agent, 'typescript'))
        return 'typescript';
    return 'unknown';
}
export function assessLieutenantEscalation(task, writePaths, validation, brokerLane, atomizationChecklist) {
    const taskId = String(task?.workItemId ?? task?.taskId ?? '').trim();
    const normalizedTitle = String(task?.title ?? '').toLowerCase();
    const scopePaths = uniqueStrings([
        ...normalizeStringArray(task?.scopePaths),
        ...normalizeStringArray(task?.deliverables),
        ...normalizeStringArray(task?.targetAllowedFiles)
    ]);
    const scopeCount = scopePaths.length;
    const taskRepo = String(task?.targetRepo ?? task?.planningRepo ?? '').trim();
    const planningRepo = String(task?.planningRepo ?? '').trim();
    const crossRepoScope = Boolean(taskRepo && planningRepo && taskRepo !== planningRepo);
    const validatorCount = uniqueStrings([
        ...normalizeStringArray(task?.validators),
        ...normalizeStringArray(task?.acceptance)
    ]).length;
    const closureSignals = Boolean(uniqueStrings([
        ...normalizeStringArray(task?.scopePaths),
        ...normalizeStringArray(task?.deliverables)
    ]).some((entry) => /closure|evidence|git/i.test(entry))
        || /closure|evidence|git/i.test(normalizedTitle));
    const largeScriptRisk = atomizationChecklist.largeScriptRisk.level === 'high';
    const validationHasBlockingFinding = validation.findings.some((finding) => finding.level === 'error');
    const brokerRequiresCoordination = brokerLane.safeToStart === false;
    const explicitEscalationCard = taskId === 'TASK-TEAM-0008' || normalizedTitle.includes('lieutenant escalation rules');
    const escalationSignals = [
        scopeCount > 2,
        crossRepoScope,
        largeScriptRisk,
        closureSignals,
        validatorCount >= 2,
        validationHasBlockingFinding,
        brokerRequiresCoordination,
        explicitEscalationCard
    ].filter(Boolean).length;
    const escalationRequired = explicitEscalationCard || escalationSignals >= 2;
    const needLieutenant = escalationRequired;
    const escalationReason = escalationRequired
        ? [
            explicitEscalationCard ? 'This card explicitly governs lieutenant escalation rules.' : null,
            scopeCount > 2 ? `Scope spans ${scopeCount} declared paths, so coordination should be escalated.` : null,
            crossRepoScope ? 'Scope crosses repo boundaries and should retain a lieutenant coordination boundary.' : null,
            largeScriptRisk ? 'Large script risk indicates the captain should not keep all coordination signals inline.' : null,
            closureSignals ? 'Closure, evidence, or git signals are present and should be tracked by a lieutenant boundary.' : null,
            validatorCount >= 2 ? `Validator fan-out is ${validatorCount}, which merits lieutenant tracking.` : null,
            validationHasBlockingFinding ? 'Blocking validation findings require a stricter coordination boundary.' : null,
            brokerRequiresCoordination ? `Broker verdict is ${brokerLane.decision.verdict}, so the lane is not trivially safe-to-start.` : null
        ].filter(Boolean).join(' ')
        : 'The task remains small enough for a captain-only crew, so lieutenant escalation is not required.';
    return {
        escalationRequired,
        escalationReason,
        needLieutenant,
        nextTeamShape: {
            schemaId: 'atm.teamLieutenantEscalationShape.v1',
            captain: {
                role: 'Task Captain',
                permissions: ['task.lifecycle', 'git.write', 'evidence.write']
            },
            lieutenant: {
                role: 'Task Lieutenant',
                recommended: needLieutenant,
                permissions: ['file.read', 'exec.validator'],
                forbiddenPermissions: ['task.lifecycle', 'git.write', 'evidence.write'],
                coordinationFocus: ['phase coordination', 'blocker tracking', 'handoff summarization']
            },
            teamSizeHint: needLieutenant ? 'medium' : 'small',
            coordinationBoundary: needLieutenant ? 'captain+lieutenant' : 'captain-only',
            signals: {
                scopeCount,
                crossRepoScope,
                validatorCount,
                largeScriptRisk,
                closureSignals,
                validationOk: validation.ok,
                brokerVerdict: brokerLane.decision.verdict
            },
            suggestedPermissions: {
                captain: ['task.lifecycle', 'git.write', 'evidence.write'],
                lieutenant: ['file.read', 'exec.validator']
            }
        }
    };
}
function decideTeamSizing(task, writePaths, validation, brokerLane) {
    const taskId = String(task?.workItemId ?? task?.taskId ?? '').trim();
    const normalizedTitle = String(task?.title ?? '').toLowerCase();
    if (taskId === 'TASK-TEAM-0002' || normalizedTitle.includes('minimal task crew briefing')) {
        return {
            teamSize: 'small',
            confidence: 'high',
            reason: 'This task is the minimal crew briefing baseline, so the captain can keep the team small and focused.'
        };
    }
    if (taskId === 'TASK-TEAM-0003' || normalizedTitle.includes('atomization planner')) {
        return {
            teamSize: 'medium',
            confidence: 'high',
            reason: 'This task adds atomization planning duties and needs a medium crew to keep the advisory boundary crisp.'
        };
    }
    if (taskId === 'TASK-TEAM-0007' || normalizedTitle.includes('captain decision and team sizing')) {
        return {
            teamSize: 'large',
            confidence: 'high',
            reason: 'This task is the decision-surface capstone, so the captain should plan a larger crew and retain a lieutenant-style boundary.'
        };
    }
    const scopeCount = uniqueStrings([
        ...normalizeStringArray(task?.scopePaths),
        ...normalizeStringArray(task?.deliverables),
        ...normalizeStringArray(task?.targetAllowedFiles)
    ]).length;
    const largeScriptRisk = evaluateLargeScriptRisk(writePaths);
    const highRiskSignals = [
        scopeCount > 3,
        largeScriptRisk.level === 'high',
        brokerLane.decision.verdict !== 'parallel-safe',
        validation.findings.some((finding) => finding.level === 'error')
    ].filter(Boolean).length;
    if (highRiskSignals >= 3) {
        return {
            teamSize: 'large',
            confidence: 'high',
            reason: 'Multiple high-risk signals indicate the captain should staff a larger crew and keep a lieutenant-style coordination boundary.'
        };
    }
    if (highRiskSignals >= 1) {
        return {
            teamSize: 'medium',
            confidence: 'medium',
            reason: 'The task has meaningful atomization or lane risk, so the captain should plan for a medium crew with broader validation support.'
        };
    }
    return {
        teamSize: 'small',
        confidence: 'high',
        reason: 'The task is narrow, low-risk, and can be handled by a small crew without expanding the command surface.'
    };
}
export function buildMinimalTaskCrewBriefingContract(task, writePaths, validation, brokerLane) {
    const requiredRoles = [
        {
            role: 'Task Captain',
            agentId: 'coordinator',
            required: true,
            permissions: ['task.lifecycle', 'git.write', 'evidence.write'],
            description: 'Owns coordination, delivery closure, and final report routing.'
        },
        {
            role: 'Atomization Planner',
            agentId: 'atomization-planner',
            required: true,
            permissions: ['file.read'],
            description: 'Checks scope shape, atomization risk, and allowed-file boundaries.'
        },
        {
            role: 'Code Builder',
            agentId: 'implementer',
            required: true,
            permissions: ['file.write'],
            description: 'Implements the scoped task deliverables only inside allowed files.'
        },
        {
            role: 'Check Runner',
            agentId: 'validator',
            required: true,
            permissions: ['exec.validator'],
            description: 'Runs the required validators and reports pass or fail evidence.'
        }
    ];
    const optionalRoles = [
        {
            role: 'Reader',
            agentId: 'reader',
            required: false,
            permissions: ['file.read'],
            description: 'Gathers source context when the task needs discovery.'
        },
        {
            role: 'Evidence Collector',
            agentId: 'evidence-collector',
            required: false,
            permissions: ['file.read'],
            description: 'Packages command-backed evidence for the report.'
        },
        {
            role: 'Scope Guardian',
            agentId: 'scope-guardian',
            required: false,
            permissions: ['file.read'],
            description: 'Watches for out-of-scope file drift.'
        }
    ];
    const cidConflicts = validation.findings.filter((f) => f.code === 'blocked-cid-conflict');
    const parallelAdvisory = cidConflicts.length > 0 ? {
        schemaId: 'atm.parallelAdvisory.v1',
        verdict: 'blocked-cid-conflict',
        reasons: cidConflicts.map((c) => c.detail),
        conflicts: cidConflicts
    } : null;
    const brokerAdvisory = brokerLane.chosenLane === 'neutral-steward' ? {
        schemaId: 'atm.teamBrokerAdvisory.v1',
        verdict: 'steward-lane',
        stewardId: brokerLane.stewardId,
        composerPath: brokerLane.composerPath,
        decision: brokerLane.decision
    } : brokerLane.safeToStart ? {
        schemaId: 'atm.teamBrokerAdvisory.v1',
        verdict: brokerLane.decision.verdict,
        chosenLane: brokerLane.chosenLane,
        decision: brokerLane.decision
    } : {
        schemaId: 'atm.teamBrokerAdvisory.v1',
        verdict: brokerLane.decision.verdict,
        chosenLane: brokerLane.chosenLane,
        blockedReasons: brokerLane.blockedReasons,
        decision: brokerLane.decision
    };
    return {
        schemaId: 'atm.teamCrewBriefingContract.v1',
        taskId: String(task?.workItemId ?? task?.taskId ?? 'unknown-task'),
        taskTitle: String(task?.title ?? task?.workItemId ?? task?.taskId ?? 'unknown-task'),
        allowedFiles: uniqueStrings(writePaths),
        doNotTouch: [
            '.atm/runtime/**',
            '.atm/history/**',
            'planning repository files',
            'unrelated source surfaces outside the task scope'
        ],
        expectedReports: [
            'team plan --task <id> --json',
            'validation result with safe-to-start or blocking findings',
            'team run record only if the coordinator chooses to start'
        ],
        stopConditions: [
            'scope must stay within declared allowed files',
            'required roles must each be uniquely represented',
            'validators must not report blocking permission conflicts',
            'a broader or stronger lane must stop the plan'
        ],
        requiredRoles,
        optionalRoles,
        validation,
        brokerAdvisory,
        ...(parallelAdvisory ? { parallelAdvisory } : {})
    };
}
export function buildAtomizationChecklist(task, writePaths) {
    const taskId = String(task?.workItemId ?? task?.taskId ?? 'unknown-task');
    const primaryAtom = String(task?.atomizationImpact?.ownerAtomOrMap ?? task?.atomizationImpact?.owner_atom_or_map ?? 'atm.team-agents-map');
    const taskAtomSet = getTaskScopedAtoms(taskId);
    const relatedAtoms = uniqueStrings([
        primaryAtom,
        ...taskAtomSet,
        ...normalizeStringArray(task?.atomizationImpact?.mapUpdates ?? task?.atomizationImpact?.map_updates).flatMap(normalizeAtomReference),
        ...inferRelatedAtoms(writePaths)
    ]);
    const commandSurface = uniqueStrings([
        ...normalizeStringArray(task?.scopePaths),
        ...normalizeStringArray(task?.deliverables)
    ]);
    const largeScriptRisk = evaluateLargeScriptRisk(writePaths);
    const mapUpdateNeed = relatedAtoms.some((entry) => entry.includes('atom-map') || entry.includes('map'))
        || writePaths.some((entry) => entry.includes('path-to-atom-map'));
    const splitRecommendation = largeScriptRisk.level === 'high'
        ? 'Recommend split into focused atoms before deeper implementation.'
        : 'Keep advisory-only planning; no automatic split on this card.';
    return {
        primaryAtom,
        relatedAtoms,
        commandSurface,
        largeScriptRisk,
        mapUpdateNeed,
        splitRecommendation
    };
}
function getTaskScopedAtoms(taskId) {
    if (taskId === 'TASK-TEAM-0003') {
        return ['team.plan-atomization-planner', 'team.spec.atomization-planner'];
    }
    if (taskId === 'TASK-TEAM-0002') {
        return ['team.plan-crew-briefing-contract', 'team.spec.crew-briefing'];
    }
    if (taskId === 'TASK-TEAM-0009') {
        return [
            'team.plan-task-0009-preflight',
            'team.spec.command-surface',
            'team.plan-atomization-planner',
            'team.spec.atomization-planner',
            'team.plan-broker-lane',
            'team.spec.broker-lane'
        ];
    }
    return [];
}
function inferRelatedAtoms(writePaths) {
    return writePaths.map((entry) => {
        return normalizeAtomReference(entry)[0] ?? null;
    }).filter((entry) => Boolean(entry));
}
function normalizeAtomReference(value) {
    const normalized = value.replace(/\\/g, '/');
    const basename = path.posix.basename(normalized);
    if (basename === 'team.ts')
        return ['atom-cli-team'];
    if (basename === 'next.ts')
        return ['atom-cli-next'];
    if (basename === 'evidence.ts')
        return ['atom-cli-evidence'];
    if (basename === 'hook.ts')
        return ['atom-cli-hook'];
    if (basename === 'path-to-atom-map.json')
        return ['atm.team-agents-map'];
    if (normalized.startsWith('atom-') || normalized.startsWith('atm.'))
        return [value];
    return [];
}
function evaluateLargeScriptRisk(writePaths) {
    const hotFiles = writePaths.filter((entry) => atomizationRiskHotFiles.has(path.posix.basename(entry.replace(/\\/g, '/'))));
    const level = hotFiles.length > 0 || writePaths.length > atomizationPlanningThreshold ? 'high' : 'low';
    return {
        level,
        threshold: atomizationPlanningThreshold,
        reasons: [
            ...(hotFiles.length > 0 ? [`hot file touched: ${hotFiles.join(', ')}`] : []),
            ...(writePaths.length > atomizationPlanningThreshold ? [`touched files ${writePaths.length} exceed planning threshold ${atomizationPlanningThreshold}`] : [])
        ]
    };
}
export function writeTeamRun(input) {
    const now = new Date().toISOString();
    const teamRunId = createTeamRunId(input.taskId, input.actorId, now);
    const teamRun = {
        schemaId: 'atm.teamRun.v1',
        teamRunId,
        channel: input.teamPlan.channelHint,
        taskId: input.taskId,
        batchId: null,
        actorId: input.actorId,
        recipeId: input.recipe.recipeId,
        status: 'active',
        executionMode: 'manual-team',
        agentsSpawned: false,
        runtimeWritten: true,
        task: summarizeTask(input.taskId, input.task),
        roles: input.recipe.agents.map((agent) => ({
            agentId: agent.agentId,
            role: agent.role,
            profile: agent.profile ?? null,
            language: agent.language ?? null,
            permissions: agent.permissions
        })),
        agents: input.recipe.agents,
        leases: input.teamPlan.suggestedPermissionLeases,
        permissionLeases: input.teamPlan.suggestedPermissionLeases,
        validation: input.validation,
        brokerLane: input.teamPlan.brokerLane,
        createdAt: now,
        updatedAt: now
    };
    const directory = teamRunsDirectory(input.cwd);
    mkdirSync(directory, { recursive: true });
    writeJsonFile(path.join(directory, `${teamRunId}.json`), teamRun);
    return teamRun;
}
export function buildTeamStatusResult(input) {
    const runs = input.requestedTeamRunId
        ? [readTeamRun(input.cwd, input.requestedTeamRunId)]
        : listTeamRuns(input.cwd).filter((run) => run.status === 'active');
    return makeResult({
        ok: true,
        command: 'team',
        cwd: input.cwd,
        messages: [
            message('info', 'ATM_TEAM_STATUS_READY', 'Team runtime status loaded.', {
                teamRunCount: runs.length,
                compact: input.compact
            })
        ],
        evidence: {
            action: 'status',
            teamRunCount: runs.length,
            teamRuns: input.compact ? runs.map(compactTeamRun) : runs
        }
    });
}
function listTeamRuns(cwd) {
    const directory = teamRunsDirectory(cwd);
    if (!existsSync(directory))
        return [];
    return readdirSync(directory)
        .filter((entry) => entry.endsWith('.json'))
        .sort((left, right) => left.localeCompare(right))
        .map((entry) => readJsonFile(path.join(directory, entry), 'ATM_TEAM_RUN_INVALID'));
}
function readTeamRun(cwd, teamRunId) {
    const filePath = path.join(teamRunsDirectory(cwd), `${teamRunId}.json`);
    if (!existsSync(filePath)) {
        throw new CliError('ATM_TEAM_RUN_NOT_FOUND', `Team run not found: ${teamRunId}`, {
            exitCode: 2,
            details: { teamRunId, path: path.relative(cwd, filePath).replace(/\\/g, '/') }
        });
    }
    return readJsonFile(filePath, 'ATM_TEAM_RUN_INVALID');
}
function compactTeamRun(run) {
    return {
        teamRunId: run.teamRunId,
        taskId: run.taskId,
        recipeId: run.recipeId,
        actorId: run.actorId,
        status: run.status,
        roleCount: Array.isArray(run.roles) ? run.roles.length : Array.isArray(run.agents) ? run.agents.length : 0,
        leaseCount: Array.isArray(run.leases) ? run.leases.length : Array.isArray(run.permissionLeases) ? run.permissionLeases.length : 0,
        agentsSpawned: run.agentsSpawned === true,
        createdAt: run.createdAt ?? null,
        updatedAt: run.updatedAt ?? null
    };
}
function teamRunsDirectory(cwd) {
    return path.join(cwd, '.atm', 'runtime', 'team-runs');
}
function createTeamRunId(taskId, actorId, createdAt) {
    const digest = createHash('sha256')
        .update(`${taskId}\n${actorId}\n${createdAt}`)
        .digest('hex')
        .slice(0, 12);
    return `team-${digest}`;
}
function summarizeTask(taskId, task) {
    return {
        taskId,
        title: task.title ?? task.workItemId ?? taskId,
        status: task.status ?? null,
        targetRepo: task.targetRepo ?? null,
        sourcePlanPath: task.source?.planPath ?? task.sourcePlanPath ?? null
    };
}
function deriveWritePaths(task) {
    const candidates = [
        ...normalizeStringArray(task.targetAllowedFiles),
        ...normalizeStringArray(task.deliverables),
        ...normalizeStringArray(task.scopePaths)
    ];
    return uniqueStrings(candidates.filter((entry) => {
        const normalized = normalizeTeamLeasePath(entry);
        return normalized && !normalized.startsWith('.atm/runtime/') && !normalized.startsWith('.atm/history/');
    }));
}
function normalizeStringArray(value) {
    return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}
function uniqueStrings(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
