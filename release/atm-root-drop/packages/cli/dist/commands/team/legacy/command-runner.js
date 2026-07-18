import path from 'node:path';
import { CliError, makeResult, message, parseArgsForCommand } from '../../shared.js';
import { getCommandSpec } from '../../command-specs.js';
import { inspectTeamRuntimeBackendCapabilities } from '../../integration.js';
import { runTeamKnowledge } from '../../team-knowledge.js';
import { runTeamWave } from '../../team-wave.js';
import { buildBrokerConflictSharedVocabulary, evaluateTeamRuntimeBackendAdmission, runTeamBroker, runTeamObservability } from './broker-observability.js';
import { buildCliGlobalProviderDefault, buildTeamRuntimeContract } from './runtime-governance.js';
import { loadTeamProviderSelectionConfigFromRepo } from '../../team/role-provider-resolution.js';
import { resolveTeamStartExecutionLane } from '../../team/team-execution-lane.js';
import { resolveTeamActionRoute, resolveTeamFastPath, supportedTeamActionList } from '../../team/team-route-map.js';
import { runTeamProviderExecution } from './provider-execution.js';
import { buildTeamPlanningContext } from './planning-context.js';
import { runTeamHandoff } from './handoff-handler.js';
import { buildTeamStatusResult, writeTeamRun } from './team-run-runtime.js';
import { buildTeamPatrolResult, normalizeTeamPatrolMode } from './patrol-handler.js';
import { runTeamLifecycleAction, normalizeTeamLifecyclePaths } from './lifecycle-handler.js';
import { deriveWritePaths, normalizeStringArray, readOptionValue, summarizeTask } from './team-utils.js';
import { resolveTeamPlanActorId } from './plan-orchestration.js';
import { teamPermissionCatalog } from './types.js';
export async function runTeam(argv) {
    const fastPath = resolveTeamFastPath(argv);
    if (fastPath) {
        const cwd = fastPath.cwdSource === 'process'
            ? process.cwd()
            : path.resolve(readOptionValue(argv, '--cwd') ?? process.cwd());
        if (fastPath.fastPath === 'handoff')
            return runTeamHandoff(fastPath.argv, cwd);
        if (fastPath.fastPath === 'knowledge')
            return runTeamKnowledge(fastPath.argv, cwd);
        if (fastPath.fastPath === 'broker')
            return runTeamBroker(fastPath.argv, cwd);
        return runTeamObservability(fastPath.argv, cwd);
    }
    const spec = getCommandSpec('team');
    const parsed = parseArgsForCommand(spec, argv);
    const action = String(parsed.positional[0] ?? 'plan').toLowerCase();
    const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
    const route = resolveTeamActionRoute(action, parsed.positional.slice(1));
    if (route.kind === 'special-action' && route.action === 'wave') {
        // TASK-MAO-0024: Team Agents Wave Mode planning surface.
        return runTeamWave(route.argv, cwd);
    }
    if (route.kind === 'special-action' && route.action === 'knowledge') {
        const knowledgeArgv = argv[0]?.toLowerCase() === 'knowledge' ? argv.slice(1) : parsed.positional.slice(1).map(String);
        return runTeamKnowledge(knowledgeArgv, cwd);
    }
    if (route.kind === 'special-action' && route.action === 'broker') {
        return runTeamBroker(route.argv, cwd);
    }
    if (route.kind === 'special-action' && route.action === 'observability') {
        return runTeamObservability(route.argv, cwd);
    }
    if (route.kind === 'planning' && route.action === 'plan' && action !== 'plan') {
        throw new CliError('ATM_CLI_USAGE', `team supports: ${supportedTeamActionList()}`, { exitCode: 2 });
    }
    if (route.kind === 'status') {
        return buildTeamStatusResult({
            cwd,
            requestedTeamRunId: String(parsed.options.team ?? '').trim(),
            compact: Boolean(parsed.options.compact)
        });
    }
    if (route.kind === 'lifecycle') {
        return runTeamLifecycleAction({
            cwd,
            action: route.action,
            teamRunId: String(parsed.options.team ?? '').trim(),
            actorId: String(parsed.options.actor ?? '').trim(),
            permission: String(parsed.options.permission ?? '').trim(),
            paths: normalizeTeamLifecyclePaths(parsed.options.paths),
            reason: String(parsed.options.reason ?? '').trim()
        });
    }
    const taskId = String(parsed.options.task ?? '').trim();
    if (!taskId) {
        throw new CliError('ATM_TEAM_TASK_REQUIRED', `team ${route.kind === 'planning' ? route.action : action} requires --task <id>.`, { exitCode: 2 });
    }
    if (route.kind === 'patrol') {
        return buildTeamPatrolResult({
            cwd,
            taskId,
            mode: normalizeTeamPatrolMode(parsed.options.mode),
            requestedTeamRunId: String(parsed.options.team ?? '').trim()
        });
    }
    const readOnlyPlan = route.kind === 'planning' && route.action === 'plan' && Boolean(parsed.options.readOnly);
    if (Boolean(parsed.options.readOnly) && !(route.kind === 'planning' && route.action === 'plan')) {
        throw new CliError('ATM_TEAM_READ_ONLY_PLAN_ONLY', 'team --read-only is only valid with team plan (projection mode). team start remains fail-closed and mutable.', {
            exitCode: 2,
            details: { action: route.kind === 'planning' ? route.action : action, requiredCommand: `node atm.mjs team plan --task ${taskId} --read-only --json` }
        });
    }
    const explicitActorId = String(parsed.options.actor ?? '').trim();
    const envActorId = String(process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? '').trim();
    const isStart = route.kind === 'planning' && route.action === 'start';
    const planningActorId = isStart
        ? (explicitActorId || envActorId)
        : resolveTeamPlanActorId({
            cwd,
            taskId,
            explicitActorId,
            fallbackActorId: envActorId || (route.kind === 'planning' && route.action === 'plan' ? 'team-planner' : '')
        });
    const context = await buildTeamPlanningContext({
        cwd,
        taskId,
        requestedRecipeId: String(parsed.options.recipe ?? '').trim(),
        actorId: planningActorId || 'team-planner',
        requestedTeamSize: String(parsed.options.teamSize ?? '').trim(),
        brokerProposalFile: String(parsed.options.brokerProposalFile ?? '').trim(),
        providerSelectionConfig: loadTeamProviderSelectionConfigFromRepo(cwd, normalizeStringArray(parsed.options.roleProvider), buildCliGlobalProviderDefault(parsed.options)),
        readOnly: readOnlyPlan
    });
    const { task, recipes, recipe, validation, permissionValidation, teamPlan } = context;
    const ok = validation.findings.every((finding) => finding.level !== 'error');
    const runtimeContract = buildTeamRuntimeContract({
        runtimeMode: parsed.options.runtimeMode,
        runtimeLanguage: parsed.options.runtimeLanguage,
        runtimeAdapterId: parsed.options.runtimeAdapter,
        providerId: parsed.options.provider,
        sdkId: parsed.options.sdk,
        modelId: parsed.options.model,
        roleName: 'coordinator',
        selectionConfig: context.providerSelectionConfig,
        editorBridgeDisabled: parsed.options.disableEditorBridge,
        recipe,
        allowedFiles: [...context.writePaths],
        permissionLeases: teamPlan.suggestedPermissionLeases,
        evidenceRequired: String(task.evidenceRequired ?? 'command-backed')
    });
    const runtimeBackendReadiness = inspectTeamRuntimeBackendCapabilities(cwd);
    if (route.kind === 'planning' && route.action === 'validate') {
        const permissionOk = permissionValidation.ok;
        const nonPermissionFindings = validation.findings.filter((finding) => !permissionValidation.findings.includes(finding));
        const safeToStart = validation.findings.every((finding) => finding.level !== 'error');
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
                safeToStart,
                relatedFindings: nonPermissionFindings,
                suggestedPermissionLeases: teamPlan.suggestedPermissionLeases,
                governanceRuntime: teamPlan.governanceRuntime,
                brokerLane: teamPlan.brokerLane,
                sharedVocabulary: buildBrokerConflictSharedVocabulary(teamPlan.brokerLane),
                runtimeContract,
                runtimeBackendReadiness,
                runtimePilot: teamPlan.runtimePilot
            }
        });
    }
    if (route.kind === 'planning' && route.action === 'start') {
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
                    brokerLane: teamPlan.brokerLane,
                    sharedVocabulary: buildBrokerConflictSharedVocabulary(teamPlan.brokerLane),
                    runtimeContract,
                    runtimeBackendReadiness,
                    runtimePilot: teamPlan.runtimePilot
                }
            });
        }
        const backendAdmission = evaluateTeamRuntimeBackendAdmission(runtimeContract, runtimeBackendReadiness);
        if (!backendAdmission.ok) {
            return makeResult({
                ok: false,
                command: 'team',
                cwd,
                messages: [
                    message('error', 'ATM_TEAM_RUNTIME_BACKEND_MISSING', backendAdmission.reason, {
                        taskId,
                        recipeId: recipe.recipeId,
                        providerId: runtimeContract.providerId,
                        runtimeMode: runtimeContract.runtimeMode,
                        executionSurface: runtimeContract.executionSurface
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
                    brokerLane: teamPlan.brokerLane,
                    sharedVocabulary: buildBrokerConflictSharedVocabulary(teamPlan.brokerLane),
                    runtimeContract,
                    runtimeBackendReadiness,
                    runtimePilot: teamPlan.runtimePilot
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
            validation,
            runtimeContract
        });
        const executeRequested = Boolean(parsed.options.execute);
        const providerOrchestration = executeRequested
            ? await runTeamProviderExecution({
                taskId,
                teamRunId: teamRun.teamRunId,
                cwd,
                recipe,
                runtimeContract,
                runtimePilot: teamPlan.runtimePilot,
                roleSelections: teamPlan.roleSkillPackManifest.roles,
                scopedPaths: deriveWritePaths(task, cwd)
            })
            : {
                requested: false,
                blockedReason: null,
                results: []
            };
        const executionLane = resolveTeamStartExecutionLane({
            executeRequested,
            providerExecutionCount: providerOrchestration.results.length,
            providerResultOk: providerOrchestration.results.map((result) => result.ok)
        });
        return makeResult({
            ok: !executionLane.executionBlocked,
            command: 'team',
            cwd,
            messages: [
                message(executionLane.messageLevel, executionLane.messageCode, executionLane.messageText, {
                    teamRunId: teamRun.teamRunId,
                    taskId,
                    recipeId: recipe.recipeId,
                    executeRequested,
                    providerExecutionCount: providerOrchestration.results.length,
                    providerExecutionBlockedReason: providerOrchestration.blockedReason
                })
            ],
            evidence: {
                action: 'start',
                runtimeWritten: true,
                agentsSpawned: providerOrchestration.results.length > 0,
                executeRequested,
                teamRunPath: `.atm/runtime/team-runs/${teamRun.teamRunId}.json`,
                teamRun,
                governanceRuntime: teamPlan.governanceRuntime,
                providerOrchestration,
                brokerLane: teamPlan.brokerLane,
                runtimeContract,
                runtimeBackendReadiness,
                runtimePilot: teamPlan.runtimePilot
            }
        });
    }
    return makeResult({
        ok,
        command: 'team',
        cwd,
        messages: [
            message(ok ? 'info' : 'error', ok ? 'ATM_TEAM_PLAN_READY' : 'ATM_TEAM_PLAN_INVALID', ok
                ? (readOnlyPlan
                    ? 'Team plan read-only projection completed. Broker registry cleanup was not persisted and no agents were spawned.'
                    : 'Team plan dry-run completed. No runtime state was written and no agents were spawned.')
                : 'Team plan found permission conflicts. No runtime state was written and no agents were spawned.', {
                taskId,
                recipeId: recipe.recipeId,
                findingCount: validation.findings.length,
                readOnly: readOnlyPlan,
                actorId: planningActorId
            })
        ],
        evidence: {
            action: 'plan',
            dryRun: true,
            readOnly: readOnlyPlan,
            runtimeWritten: false,
            agentsSpawned: false,
            actorId: planningActorId,
            task: summarizeTask(taskId, task),
            recipe,
            recipeSources: recipes.sources,
            permissionCatalog: teamPermissionCatalog,
            validation,
            teamPlan,
            governanceRuntime: teamPlan.governanceRuntime,
            runtimeContract,
            runtimeBackendReadiness,
            brokerLane: teamPlan.brokerLane,
            sharedVocabulary: buildBrokerConflictSharedVocabulary(teamPlan.brokerLane),
            runtimePilot: teamPlan.runtimePilot
        }
    });
}
