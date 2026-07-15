import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, parseArgsForCommand, quoteCliValue, readJsonFile, writeJsonFile } from './shared.js';
import { getCommandSpec } from './command-specs.js';
import { inspectTeamRuntimeBackendCapabilities } from './integration.js';
import { runTasks } from './tasks.js';
import { evaluateBrokerQueueAdmission, restrictTeamWriteScopeForQueueAdmission } from './next/broker-queue-admission.js';
import { findTaskClaimDependencyBlockers } from './tasks/dependency-gates.js';
import { validateStrictPathHeuristic } from './tasks/task-import-validators.js';
import { buildTeamKnowledgeSummary, runTeamKnowledge } from './team-knowledge.js';
import { runTeamWave } from './team-wave.js';
import { createTeamObservabilityEvent } from '../../../core/dist/team-runtime/observability.js';
import { readTeamHandoffArtifacts, renderTeamHandoffIndex, teamHandoffHistoryDirectory, teamHandoffRuntimeDirectory, verifyTeamHandoffHistory, verifyTeamHandoffLedger } from '../../../core/dist/team-runtime/handoff-ledger.js';
import { readBrokerProposalFile, validateBrokerProposal } from '../../../core/dist/broker/proposal.js';
import { planSharedSurfaceAcquisition } from '../../../core/dist/broker/shared-surface-queue.js';
import { inspectGitIndexOwnership } from './git-index-ownership.js';
import { loadTeamProviderSelectionConfigFromRepo } from './team/role-provider-resolution.js';
import { composeTeamContributionManifests } from './team/composer.js';
import { resolveTeamStartExecutionLane } from './team/team-execution-lane.js';
import { resolveTeamActionRoute, resolveTeamFastPath, supportedTeamActionList } from './team/team-route-map.js';
import { buildTeamReworkRouteStateMachine } from './team/legacy/runtime-contracts.js';
import { buildBrokerConflictSharedVocabulary, buildBrokerConflictUxProjection, evaluateTeamRuntimeBackendAdmission, runTeamBroker, runTeamBrokerConflictResolve, runTeamObservability } from './team/legacy/broker-observability.js';
export { buildBrokerConflictSharedVocabulary, buildBrokerConflictUxProjection, runTeamBrokerConflictResolve };
import { buildCliGlobalProviderDefault, buildReviewAgentSignature, buildTeamClosureAttestation, buildTeamRuntimeContract, evaluateReviewerIndependence, evaluateReviewQuorum, normalizeOptionalRuntimeString } from './team/legacy/runtime-governance.js';
export { buildReviewAgentSignature, buildTeamClosureAttestation, buildTeamRuntimeContract, evaluateReviewerIndependence, evaluateReviewQuorum };
import { buildTeamPatrolFollowUp, buildTeamRunPatrolFindings, summarizePatrolSeverity, suggestedPatrolCommand, teamPatrolFinding } from './team/legacy/patrol-contracts.js';
import { buildPermissionFinding, deriveAllowedWriteScope, mergeValidation, normalizeRepoAbsoluteLeasePath, normalizeTeamLeasePath, normalizeTaskWriteScope, validateTeamPermissionModel } from './team/legacy/permission-lease-policy.js';
import { buildTeamPlan, buildTeamRuntimePilot, planTeamBrokerLane, readActiveTaskClaimActorId, resolveTeamPlanActorId } from './team/legacy/plan-orchestration.js';
export { buildTeamPlan, buildTeamRuntimePilot, planTeamBrokerLane, readActiveTaskClaimActorId, resolveTeamPlanActorId };
import { buildTeamLeaseConflictDetails, buildTeamLeaseNotFoundDetails, compactTeamRun, createTeamRunId, findLatestTeamRunForTask, listTeamRuns, normalizePermissionLeaseRecords, readTeamRun, teamRunsDirectory, writeExistingTeamRun } from './team/legacy/team-run-store.js';
import { TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS, appendTeamRuntimeObservabilityEvents, buildDirectTeamRoleInstructions, runTeamProviderExecution } from './team/legacy/provider-execution.js';
import { evaluateLargeScriptRisk, normalizeTeamSizeOverride } from './team/legacy/crew-decision-policy.js';
import { projectTeamRecipeForLevel } from './team/legacy/implementer-selector-policy.js';
export { buildTeamGrowthContract, buildTeamRoleGrowthObservabilityContract } from './team/growth-contract.js';
export { buildProviderNeutralRoleSkillPackManifest, buildTeamRoleRoutingMatrix, buildTeamRoleSkillPackContract } from './team/role-skill-packs.js';
export { buildAnthropicRuntimeBridgeSummary, buildEditorExecutionRuntimeBridgeSummary, buildGeminiDirectRuntimeBridgeSummary, buildMicrosoftFoundryRuntimeBridgeSummary, buildOpenAIFamilyRuntimeBridgeSummary } from './team/runtime-bridges.js';
export { buildTeamArtifactHandoffContract, buildTeamRetryBudgetContract, buildTeamReworkRouteStateMachine, transitionTeamReworkRoute, validateTeamArtifactHandoff } from './team/legacy/runtime-contracts.js';
export { buildTeamLeaseConflictDetails, buildTeamLeaseNotFoundDetails, compactTeamRun, createTeamRunId, findLatestTeamRunForTask, listTeamRuns, normalizePermissionLeaseRecords, readTeamRun, teamRunsDirectory, writeExistingTeamRun } from './team/legacy/team-run-store.js';
export { buildPermissionFinding, buildProposalFirstParityFindings, buildSuggestedPermissionLeases, deriveAllowedWriteScope, mergeValidation, normalizeRepoAbsoluteLeasePath, normalizeTeamLeasePath, normalizeTaskWriteScope, validateTeamPermissionModel } from './team/legacy/permission-lease-policy.js';
export { TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS, appendTeamRuntimeObservabilityEvents, buildDirectTeamRoleInstructions, loadTeamVendorLocalSecrets, runDirectTeamProviderRole, runTeamProviderExecution } from './team/legacy/provider-execution.js';
export { buildAtomizationChecklist, buildCaptainDecision, evaluateLargeScriptRisk, buildMinimalTaskCrewBriefingContract, normalizeTeamSizeOverride, assessLieutenantEscalation } from './team/legacy/crew-decision-policy.js';
export { mapTeamSizeToLevel, projectTeamRecipeForLevel, selectTeamImplementer } from './team/legacy/implementer-selector-policy.js';
import { TEAM_ATOM_BOUNDARIES, teamPermissionCatalog } from './team/legacy/types.js';
export { TEAM_ATOM_BOUNDARIES };
export function evaluateBatchTeamAdmission(input) {
    const taskId = String(input.taskId ?? '').trim();
    const batchId = String(input.batchId ?? '').trim();
    const isQueueHead = taskId.length > 0 && taskId === String(input.currentQueueHeadTaskId ?? '').trim();
    const costTelemetryLoaded = input.costTelemetryLoaded === true;
    const reasonCodes = [];
    if (!isQueueHead)
        reasonCodes.push('not-current-queue-head');
    if (input.structuralParallelism !== true)
        reasonCodes.push('no-structural-parallelism');
    if (!costTelemetryLoaded)
        reasonCodes.push('missing-cost-telemetry');
    if (input.stopLossTriggered === true)
        reasonCodes.push('stop-loss-triggered');
    const allowed = reasonCodes.length === 0;
    return {
        schemaId: 'atm.batchTeamAdmissionDecision.v1',
        taskId,
        batchId,
        allowed,
        mode: allowed ? 'team-current-head' : 'single-agent',
        reasonCodes,
        queueHeadOnly: true,
        structuralParallelismRequired: true,
        costTelemetryRequired: true,
        stopLossAction: input.stopLossTriggered === true
            ? 'single-agent'
            : (!costTelemetryLoaded ? 'cheaper-qualified-model-mix' : 'none')
    };
}
export function resolveTeamRecipeIdForChannel(channel) {
    if (channel === 'batch') {
        return 'atm.default.batch';
    }
    if (channel === 'fast') {
        return 'atm.default.fast';
    }
    return 'atm.default.normal.typescript';
}
export function defaultTeamRecommendationReason(channel) {
    if (channel === 'batch') {
        return 'Batch queue-head work can use a current-task team, but ATM still owns checkpoint and advance.';
    }
    if (channel === 'fast') {
        return 'Fast quickfix work usually stays single-actor; a team run is optional and advisory only.';
    }
    return 'This task can use an optional team run for role and permission coordination.';
}
export function buildTeamRecommendation(input) {
    const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
    if (!taskId || input.enabled === false) {
        return null;
    }
    const actorId = input.actorId?.trim() || '<id>';
    const recipeId = resolveTeamRecipeIdForChannel(input.channel);
    const quotedTask = quoteCliValue(taskId);
    const reason = input.reason?.trim() || defaultTeamRecommendationReason(input.channel);
    return {
        schemaId: 'atm.teamRecommendation.v1',
        enabled: true,
        required: false,
        channel: input.channel,
        taskId,
        recipeId,
        reason,
        plan: `node atm.mjs team plan --task ${quotedTask} --recipe ${recipeId} --json`,
        validate: `node atm.mjs team validate --task ${quotedTask} --recipe ${recipeId} --json`,
        start: `node atm.mjs team start --task ${quotedTask} --actor ${actorId} --recipe ${recipeId} --json`,
        status: 'node atm.mjs team status --compact --json',
        ...(input.knowledgeSummary ? { knowledgeSummary: input.knowledgeSummary } : {}),
        ...(input.parallelAdvisory ? { parallelAdvisory: input.parallelAdvisory } : {}),
        constraints: [
            'Team start writes only .atm/runtime/team-runs/<teamRunId>.json.',
            'Team agents are not spawned by this recommendation.',
            'Coordinator remains the only task.lifecycle and git.write owner.'
        ]
    };
}
const builtInRecipes = [
    {
        schemaId: 'atm.teamRecipe.v1',
        recipeId: 'atm.default.fast',
        appliesTo: ['fast'],
        agents: [
            { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write', 'file.write', 'handoff.read', 'handoff.materialize'] },
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
            { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write', 'handoff.read', 'handoff.materialize'] },
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
            { agentId: 'batch-coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write', 'handoff.read', 'handoff.materialize'] },
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
function runTeamHandoff(argv, cwd) {
    const action = String(argv[0] ?? 'show').toLowerCase();
    const taskId = readOptionValue(argv, '--task')?.trim();
    const teamRunId = readOptionValue(argv, '--team')?.trim();
    const continuationFrom = readOptionValue(argv, '--continuation-from')?.trim() ?? '';
    const actorId = readOptionValue(argv, '--actor')?.trim() ?? '';
    if (!taskId || !teamRunId || !actorId)
        throw new CliError('ATM_TEAM_HANDOFF_TASK_RUN_REQUIRED', 'team handoff requires --task, --team, and --actor.', { exitCode: 2 });
    if (!['show', 'context', 'stats', 'materialize'].includes(action))
        throw new CliError('ATM_CLI_USAGE', 'team handoff supports: show, context, stats, materialize.', { exitCode: 2 });
    const permission = action === 'materialize' ? 'handoff.materialize' : 'handoff.read';
    assertTeamHandoffHardGate({ cwd, taskId, teamRunId, actorId, permission });
    const integrity = verifyTeamHandoffLedger(cwd, taskId, teamRunId);
    if (!integrity.ok)
        throw new CliError('ATM_TEAM_HANDOFF_INTEGRITY_BLOCKED', `handoff-integrity-blocked: ${integrity.reason}.`, { exitCode: 1 });
    const directory = teamHandoffRuntimeDirectory(cwd, taskId, teamRunId);
    let sourceDirectory = directory;
    let sourceManifest = integrity.manifest;
    if (continuationFrom) {
        if (action !== 'context')
            throw new CliError('ATM_TEAM_HANDOFF_CONTINUATION_CONTEXT_ONLY', 'Continuation is only available through team handoff context.', { exitCode: 1 });
        const prior = verifyTeamHandoffHistory(cwd, taskId, continuationFrom);
        if (!prior.ok || prior.manifest.runOutcome === 'running')
            throw new CliError('ATM_TEAM_HANDOFF_CONTINUATION_BLOCKED', `handoff-integrity-blocked: terminal same-task continuation is required (${prior.reason ?? 'prior run is not terminal'}).`, { exitCode: 1 });
        sourceDirectory = teamHandoffHistoryDirectory(cwd, taskId, continuationFrom);
        sourceManifest = prior.manifest;
        appendTeamRuntimeObservabilityEvents(cwd, teamRunId, [createTeamObservabilityEvent({ eventType: 'handoff.consumed', taskId, teamRunId, providerId: 'unknown', role: 'coordinator', runtimeMode: 'broker-only', artifactType: 'atm.teamRoleHandoffArtifact.v1', artifactId: continuationFrom, decisionClass: 'auto-execution', decisionReason: 'same-task terminal continuation consumed through Coordinator context builder', violationStatus: 'none', statusCode: 'none', summary: `Continuation from terminal run ${continuationFrom} consumed.` })]);
    }
    const artifacts = readTeamHandoffArtifacts(sourceDirectory, sourceManifest);
    const bounded = artifacts.slice(-TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS).map((artifact) => ({ role: artifact.from.role, providerId: artifact.from.providerId, outputTextPreview: artifact.humanSummary }));
    const context = buildDirectTeamRoleInstructions({ taskId, role: 'consumer', priorRoleArtifacts: bounded });
    return makeResult({ ok: true, command: 'team', cwd, messages: [message('info', 'ATM_TEAM_HANDOFF_READY', `Team handoff ${action} is ready.`)], evidence: { action: `handoff.${action}`, taskId, teamRunId, continuationFrom: continuationFrom || null, permission, manifest: sourceManifest, artifacts: action === 'show' ? artifacts : undefined, context: action === 'context' ? context : undefined, stats: action === 'stats' ? { transitionCount: sourceManifest.transitionCount, contextTokens: context.telemetry.actualTokenCount } : undefined } });
}
function assertTeamHandoffHardGate(input) {
    const definition = teamPermissionCatalog.find((entry) => entry.id === input.permission);
    const run = readTeamRun(input.cwd, input.teamRunId);
    const runActorId = String(run.actorId ?? '').trim();
    const runTaskId = String(run.taskId ?? '').trim();
    const roles = Array.isArray(run.roles) ? run.roles : Array.isArray(run.agents) ? run.agents : [];
    const coordinator = roles.find((entry) => entry?.role === 'coordinator');
    const coordinatorAgentId = String(coordinator?.agentId ?? '').trim();
    const coordinatorPermissions = Array.isArray(coordinator?.permissions) ? coordinator.permissions.map(String) : [];
    const leases = normalizePermissionLeaseRecords(run.permissionLeases ?? run.leases);
    const matchingLease = leases.find((lease) => lease.permission === input.permission && lease.agentId === coordinatorAgentId && Array.isArray(lease.paths) && lease.paths.length > 0);
    const hasCoordinator = Boolean(coordinatorAgentId);
    const authorizedActor = input.actorId === 'system' || (input.actorId === runActorId && hasCoordinator);
    if (!definition || definition.hardGate !== true || definition.scopeRequired !== true || runTaskId !== input.taskId || !authorizedActor || !coordinatorPermissions.includes(input.permission) || !matchingLease) {
        throw new CliError('ATM_TEAM_PERMISSION_HARD_GATE_BLOCKED', `handoff-integrity-blocked: ${input.permission} requires the bound Coordinator/system authority for this task and run.`, {
            exitCode: 1,
            details: { gateId: 'ATM_TEAM_PERMISSION_HARD_GATE', permission: input.permission, taskId: input.taskId, teamRunId: input.teamRunId, runTaskId, runActorId, coordinatorAgentId, hasCoordinator, coordinatorPermissionGranted: coordinatorPermissions.includes(input.permission), scopedLeaseGranted: Boolean(matchingLease) }
        });
    }
}
async function buildTeamPlanningContext(input) {
    let task = readTask(input.cwd, input.taskId);
    if (input.brokerProposalFile) {
        task = applyTeamBrokerProposalAdmission({
            cwd: input.cwd,
            task,
            taskId: input.taskId,
            actorId: input.actorId,
            proposalFile: input.brokerProposalFile
        });
    }
    const recipes = loadTeamRecipes(input.cwd);
    const recipe = selectRecipe({
        recipes,
        requestedRecipeId: input.requestedRecipeId,
        task
    });
    const requestedRosterLevel = normalizeTeamSizeOverride(input.requestedTeamSize)?.teamLevel ?? null;
    const activeRecipe = requestedRosterLevel ? projectTeamRecipeForLevel(recipe, requestedRosterLevel).recipe : recipe;
    const writeScope = deriveTeamWriteScope(task, input.cwd);
    // TASK-TEAM-0078: project the write scope through the canonical
    // shared-surface queue before any role or provider lease is derived, so a
    // queued task may plan/start only against its disjoint private paths and a
    // fully queued task is rejected instead of silently widening a lease.
    const queueAdmission = evaluateBrokerQueueAdmission({
        cwd: input.cwd,
        taskId: input.taskId,
        allowedFiles: writeScope.writePaths,
        overlappingFiles: []
    });
    const queueScopeDecision = restrictTeamWriteScopeForQueueAdmission(queueAdmission, writeScope.writePaths);
    const queueScopeFindings = [];
    if (queueScopeDecision.verdict === 'rejected') {
        queueScopeFindings.push(buildPermissionFinding({
            level: 'error',
            code: 'broker-queue-blocked',
            detail: `team plan/start rejected by canonical shared-surface queue admission (${queueAdmission.status}): ${queueScopeDecision.reason}`,
            paths: [...queueScopeDecision.queuedSharedPaths]
        }));
    }
    else if (queueScopeDecision.verdict === 'restricted-private-work') {
        queueScopeFindings.push(buildPermissionFinding({
            level: 'warning',
            code: 'broker-queue-private-work',
            detail: 'Role write scope is restricted to disjoint private paths while shared paths remain queued; leases must not widen beyond the canonical queue projection.',
            paths: [...queueScopeDecision.queuedSharedPaths]
        }));
    }
    const writePaths = [...queueScopeDecision.writePaths];
    const permissionValidation = validateTeamPermissionModel(activeRecipe, writePaths, {
        allowedWritePaths: deriveAllowedWriteScope(task, input.cwd),
        repoRoot: input.cwd,
        allowEmptyWriteScope: writeScope.allowEmptyWriteScope
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
                if (finding && finding.verdict === 'blocked-cid-conflict') {
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
        writePaths,
        readOnly: input.readOnly === true
    });
    const brokerLane = brokerLanePlan.evidence;
    const gitIndexOwnership = inspectGitIndexOwnership({
        cwd: input.cwd,
        taskId: input.taskId
    });
    const claimAdmissionFindings = buildTeamClaimAdmissionFindings(input.cwd, input.taskId, task);
    const validation = mergeValidation(permissionValidation, { ok: queueScopeFindings.every((f) => f.level !== 'error'), findings: queueScopeFindings }, { ok: claimAdmissionFindings.every((f) => f.level !== 'error'), findings: claimAdmissionFindings }, { ok: parallelFindings.every((f) => f.level !== 'error'), findings: parallelFindings }, { ok: brokerLanePlan.findings.every((f) => f.level !== 'error'), findings: brokerLanePlan.findings });
    const finalTeamPlan = buildTeamPlan({
        cwd: input.cwd,
        task,
        recipe: activeRecipe,
        writePaths,
        validation,
        brokerLane,
        gitIndexOwnership,
        allowEmptyWriteScope: writeScope.allowEmptyWriteScope,
        requestedTeamSize: input.requestedTeamSize,
        providerSelectionConfig: input.providerSelectionConfig?.config ?? null,
        providerSelectionSource: input.providerSelectionConfig?.source ?? null,
        knowledgeSummary: buildTeamKnowledgeSummary({
            cwd: input.cwd,
            taskId: String(task.workItemId ?? task.taskId ?? input.taskId),
            top: 3
        })
    });
    return {
        task,
        recipes,
        recipe: activeRecipe,
        permissionValidation,
        validation,
        writePaths,
        queueAdmission,
        queueScopeDecision,
        providerSelectionConfig: input.providerSelectionConfig?.config ?? null,
        providerSelectionSource: input.providerSelectionConfig?.source ?? null,
        teamPlan: {
            ...finalTeamPlan,
            validation,
            brokerLane
        }
    };
}
function applyTeamBrokerProposalAdmission(input) {
    const proposalPath = path.resolve(input.cwd, input.proposalFile);
    let proposal;
    try {
        proposal = readBrokerProposalFile(proposalPath);
    }
    catch (error) {
        throw new CliError('ATM_TEAM_BROKER_PROPOSAL_INVALID', `Team start could not read broker proposal: ${error.message}`, { exitCode: 1 });
    }
    const validation = validateBrokerProposal(proposal, { cwd: input.cwd });
    const allowed = new Set(deriveWritePaths(input.task, input.cwd));
    const hashOnlyMismatch = validation.issues.length === 1
        && validation.issues[0]?.kind === 'file-hash-mismatch'
        && String(validation.currentFileHash ?? '').replace(/^sha256:/, '') === String(proposal.fileBeforeHash ?? '').replace(/^sha256:/, '');
    if ((!validation.ok && !hashOnlyMismatch) || proposal.taskId !== input.taskId || proposal.actorId !== input.actorId || !allowed.has(proposal.targetFile.replace(/\\/g, '/'))) {
        throw new CliError('ATM_TEAM_BROKER_PROPOSAL_INVALID', 'Team start requires a current validated proposal owned by its task/actor and target write scope.', {
            exitCode: 1,
            details: { proposalFile: input.proposalFile, proposalId: proposal.proposalId, issues: validation.issues }
        });
    }
    return {
        ...input.task,
        proposalAdmission: {
            trigger: 'hot-file',
            summarySubmitted: true,
            hotFiles: [proposal.targetFile.replace(/\\/g, '/')],
            notes: `Validated broker proposal ${proposal.proposalId} consumed by team start.`
        }
    };
}
function buildTeamClaimAdmissionFindings(cwd, taskId, task) {
    return findTaskClaimDependencyBlockers(cwd, taskId, task).map((blocker) => buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED',
        detail: `Team start is unsafe because normal task claim would be blocked by dependency ${blocker.taskId} (${blocker.status}).`,
        paths: [path.relative(cwd, blocker.taskPath).replace(/\\/g, '/')]
    }));
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
    const recipeId = String(value?.recipeId ?? '').trim();
    if (!recipeId) {
        throw new CliError('ATM_TEAM_RECIPE_INVALID', 'Team recipe JSON requires recipeId.', { exitCode: 2 });
    }
    const agents = Array.isArray(value?.agents) ? (value.agents).map((entry) => ({
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
        appliesTo: Array.isArray(value?.appliesTo) ? (value.appliesTo).map(String) : undefined,
        language: value?.language ? String(value.language) : undefined,
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
    const paths = collectTaskPathHints(task);
    if (paths.some((entry) => entry.endsWith('.py') || entry.includes('pipelines/')))
        return 'python';
    if (paths.some((entry) => entry.endsWith('.cs')))
        return 'csharp';
    return 'typescript';
}
export function writeTeamRun(input) {
    const now = new Date().toISOString();
    const teamRunId = createTeamRunId(input.taskId, input.actorId, now);
    const contributionComposition = composeTeamContributionManifests({
        taskId: input.taskId,
        baseCommit: input.teamPlan.shadowSchedule.baseCommit,
        contributions: [],
        declaredScope: deriveWritePaths(input.task, input.cwd)
    });
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
        executionSurface: input.runtimeContract.executionSurface,
        runtimeMode: input.runtimeContract.runtimeMode,
        runtimeLanguage: input.runtimeContract.runtimeLanguage,
        runtimeAdapterId: input.runtimeContract.runtimeAdapterId,
        providerId: input.runtimeContract.providerId,
        sdkId: input.runtimeContract.sdkId,
        modelId: input.runtimeContract.modelId,
        runtimeContract: input.runtimeContract,
        artifactHandoff: input.runtimeContract.artifactHandoff,
        retryBudget: input.runtimeContract.retryBudget,
        brokerSubagent: input.runtimeContract.brokerSubagent,
        agentsSpawned: input.runtimeContract.agentsSpawned,
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
        governanceRuntime: input.teamPlan.governanceRuntime,
        decisionClass: input.teamPlan.decisionClass,
        decisionReason: input.teamPlan.decisionReason,
        requiresHumanSignoff: input.teamPlan.requiresHumanSignoff,
        requiresAdr: input.teamPlan.requiresAdr,
        violationStatus: input.teamPlan.violationStatus,
        escalationTarget: input.teamPlan.escalationTarget,
        brokerLane: input.teamPlan.brokerLane,
        captainDecision: input.teamPlan.captainDecision,
        shadowSchedule: input.teamPlan.shadowSchedule,
        contributionComposition,
        runtimeTierContract: input.teamPlan.runtimeTierContract,
        runtimePilot: input.teamPlan.runtimePilot,
        reworkRoute: buildTeamReworkRouteStateMachine({
            findings: [],
            requiredChecksPassed: false,
            retryBudgetMax: input.runtimeContract.retryBudget.maxReworkCycles,
            retryBudgetUsed: 0
        }),
        agentReports: [],
        patrolFindings: [],
        evidenceCuratorSummary: null,
        teamSummary: {
            decision: input.teamPlan.captainDecision.reason,
            implementationSummary: `${input.runtimeContract.selectionReason}; closure remains governed by command-backed evidence.`,
            validators: normalizeStringArray(input.task?.validators),
            evidence: [],
            brokerGovernance: buildTeamBrokerGovernanceSummary(input.runtimeContract),
            risk: input.teamPlan.captainDecision.escalationRequired ? 'medium' : 'low',
            closeReady: false
        },
        createdAt: now,
        updatedAt: now
    };
    const directory = teamRunsDirectory(input.cwd);
    mkdirSync(directory, { recursive: true });
    writeJsonFile(path.join(directory, `${teamRunId}.json`), teamRun);
    return teamRun;
}
function buildTeamBrokerGovernanceSummary(runtimeContract) {
    return {
        schemaId: 'atm.teamBrokerGovernanceSummary.v1',
        brokerSubagentEnabled: runtimeContract.brokerSubagent.enabled === true,
        brokerDecisionSurface: runtimeContract.brokerSubagent.decisionSurface,
        brokerStewardId: runtimeContract.brokerSubagent.stewardId,
        brokerGoverns: [...runtimeContract.brokerSubagent.governs],
        brokerEvidenceRequired: [...runtimeContract.brokerSubagent.evidenceRequired],
        commitLaneSerializedBy: runtimeContract.commitLane.serializedBy,
        commitLaneOwnerRole: runtimeContract.commitLane.ownerRole,
        workerGitWrite: runtimeContract.workerAdapter.authorityBoundary.gitWrite,
        workerTaskLifecycle: runtimeContract.workerAdapter.authorityBoundary.taskLifecycle,
        workerSelfClose: runtimeContract.workerAdapter.authorityBoundary.selfClose
    };
}
export function buildTeamStatusResult(input) {
    const runs = input.requestedTeamRunId
        ? [readTeamRun(input.cwd, input.requestedTeamRunId)]
        : listTeamRuns(input.cwd).filter((run) => typeof run === 'object' && run !== null && run.status === 'active');
    const sharedSurfaceQueues = readTeamSharedSurfaceQueues(input.cwd);
    const sharedSurfaceAcquisitionPlans = runs
        .map((run) => String(run?.taskId ?? '').trim())
        .filter(Boolean)
        .map((taskId) => planSharedSurfaceAcquisition(sharedSurfaceQueues, taskId));
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
            teamRuns: input.compact ? runs.map(compactTeamRun) : runs,
            sharedSurfaceQueues,
            sharedSurfaceAcquisitionPlans
        }
    });
}
function readTeamSharedSurfaceQueues(cwd) {
    const queuePath = path.join(cwd, '.atm', 'runtime', 'broker-shared-surface-queues.json');
    if (!existsSync(queuePath))
        return [];
    try {
        const parsed = readJsonFile(queuePath, 'ATM_TEAM_SHARED_QUEUE_INVALID');
        return Array.isArray(parsed.queues) ? parsed.queues : [];
    }
    catch {
        return [];
    }
}
export function evaluateTeamRequiredCompletionGate(input) {
    const required = isTeamRequiredTask(input.taskDocument);
    if (!required) {
        return {
            ok: true,
            required: false,
            taskId: input.taskId,
            teamRun: null,
            requiredCommand: null
        };
    }
    const completedRun = listTeamRuns(input.cwd)
        .filter((run) => typeof run === 'object' && run !== null)
        .filter((run) => run.taskId === input.taskId)
        .filter((run) => run.status === 'completed')
        .filter((run) => {
        const teamSummary = run.teamSummary;
        return typeof teamSummary === 'object' && teamSummary !== null && teamSummary.closeReady === true;
    })
        .sort((left, right) => String(right.completedAt ?? right.updatedAt ?? '').localeCompare(String(left.completedAt ?? left.updatedAt ?? '')))[0] ?? null;
    const requiredCommand = `node atm.mjs team complete --team <teamRunId> --actor <coordinator> --reason "team.required close gate" --json`;
    return {
        ok: Boolean(completedRun),
        required: true,
        taskId: input.taskId,
        teamRun: completedRun ? compactTeamRun(completedRun) : null,
        requiredCommand
    };
}
function isTeamRequiredTask(taskDocument) {
    const direct = taskDocument.teamRequired ?? taskDocument['team.required'];
    if (direct === true || direct === 'true')
        return true;
    const team = taskDocument.team;
    if (typeof team === 'object' && team !== null) {
        const required = team.required;
        return required === true || required === 'true';
    }
    return false;
}
export function buildTeamPatrolResult(input) {
    const report = buildTeamPatrolReport(input);
    return makeResult({
        ok: true,
        command: 'team',
        cwd: input.cwd,
        messages: [
            message(report.safeToProceed ? 'info' : 'warning', report.safeToProceed ? 'ATM_TEAM_PATROL_READY' : 'ATM_TEAM_PATROL_FINDINGS', report.safeToProceed
                ? 'Team patrol completed with no blocking findings. No runtime or history state was written.'
                : 'Team patrol found follow-up items. No runtime or history state was written.', {
                taskId: input.taskId,
                mode: input.mode,
                severity: report.severity,
                findingCount: report.findings.length
            })
        ],
        evidence: report
    });
}
export function buildTeamPatrolReport(input) {
    const findings = [];
    const taskPath = path.join(input.cwd, '.atm', 'history', 'tasks', `${input.taskId}.json`);
    const evidencePath = path.join(input.cwd, '.atm', 'history', 'evidence', `${input.taskId}.json`);
    const closurePacketPath = path.join(input.cwd, '.atm', 'history', 'closure-packets', `${input.taskId}.json`);
    const taskExists = existsSync(taskPath);
    const evidenceExists = existsSync(evidencePath);
    const closurePacketExists = existsSync(closurePacketPath);
    const task = taskExists ? readJsonFile(taskPath, 'ATM_TEAM_TASK_INVALID') : null;
    const taskSummary = task ? summarizeTask(input.taskId, task) : { taskId: input.taskId, title: input.taskId, status: null, targetRepo: null, sourcePlanPath: null };
    const writePaths = task ? deriveWritePaths(task, input.cwd) : [];
    const largeScriptRisk = evaluateLargeScriptRisk(writePaths);
    const teamRun = input.requestedTeamRunId ? readTeamRun(input.cwd, input.requestedTeamRunId) : findLatestTeamRunForTask(input.cwd, input.taskId);
    if (!taskExists) {
        findings.push(teamPatrolFinding({
            level: 'blocker',
            code: 'ATM_TEAM_PATROL_TASK_MISSING',
            category: 'artifact-gap',
            summary: `Task ledger is missing for ${input.taskId}.`,
            suggestedCommand: `node atm.mjs next --task ${quoteCliValue(input.taskId)} --json`,
            details: { path: path.relative(input.cwd, taskPath).replace(/\\/g, '/') }
        }));
    }
    if (!evidenceExists) {
        findings.push(teamPatrolFinding({
            level: input.mode === 'close-preflight' ? 'blocker' : 'warning',
            code: 'ATM_TEAM_PATROL_EVIDENCE_MISSING',
            category: 'evidence',
            summary: `Command-backed evidence file is not present for ${input.taskId}.`,
            suggestedCommand: `node atm.mjs evidence run --task ${quoteCliValue(input.taskId)} --actor <actor> -- <validator-command>`,
            details: { path: path.relative(input.cwd, evidencePath).replace(/\\/g, '/') }
        }));
    }
    if (input.mode === 'close-preflight' && !closurePacketExists) {
        findings.push(teamPatrolFinding({
            level: 'warning',
            code: 'ATM_TEAM_PATROL_CLOSURE_PACKET_MISSING',
            category: 'artifact-gap',
            summary: `Closure packet has not been materialized for ${input.taskId}.`,
            suggestedCommand: `node atm.mjs taskflow pre-close --task ${quoteCliValue(input.taskId)} --actor <actor> --json`,
            details: { path: path.relative(input.cwd, closurePacketPath).replace(/\\/g, '/') }
        }));
    }
    if (!teamRun) {
        findings.push(teamPatrolFinding({
            level: 'info',
            code: 'ATM_TEAM_PATROL_NO_TEAM_RUN',
            category: 'runtime-mode',
            summary: 'No matching active team runtime record was found; patrol continues from ledger artifacts only.',
            suggestedCommand: `node atm.mjs team start --task ${quoteCliValue(input.taskId)} --actor <actor> --json`
        }));
    }
    else {
        const taskStatus = normalizeOptionalRuntimeString(taskSummary.status);
        if (taskStatus && ['done', 'abandoned', 'blocked'].includes(taskStatus) && String(teamRun.status ?? '').trim() === 'active') {
            findings.push(teamPatrolFinding({
                level: 'warning',
                code: 'ATM_TEAM_PATROL_STALE_TERMINAL_TEAM_RUN',
                category: 'runtime-mode',
                summary: `Team run ${teamRun.teamRunId} is still active even though task ${input.taskId} is already ${taskStatus}.`,
                suggestedCommand: `node atm.mjs tasks close --task ${quoteCliValue(input.taskId)} --actor <actor> --status ${taskStatus} --json`,
                details: { teamRunId: teamRun.teamRunId, taskStatus }
            }));
        }
        findings.push(...buildTeamRunPatrolFindings(teamRun, input));
    }
    if (input.mode === 'big-script' || largeScriptRisk.level === 'high') {
        findings.push(teamPatrolFinding({
            level: largeScriptRisk.level === 'high' ? 'warning' : 'info',
            code: largeScriptRisk.level === 'high' ? 'ATM_TEAM_PATROL_LARGE_SCRIPT_RISK' : 'ATM_TEAM_PATROL_SCOPE_LOW_RISK',
            category: 'scope',
            summary: largeScriptRisk.level === 'high'
                ? 'Task write scope has large-script or hot-file risk and should receive extra review.'
                : 'Task write scope does not exceed the large-script threshold.',
            suggestedCommand: largeScriptRisk.level === 'high'
                ? `node atm.mjs team plan --task ${quoteCliValue(input.taskId)} --json`
                : null,
            details: { writePaths, largeScriptRisk }
        }));
    }
    if (teamRun?.teamRunId) {
        findings.push(...buildTeamHandoffPatrolFindings(input.cwd, input.taskId, String(teamRun.teamRunId), input.mode));
    }
    const severity = summarizePatrolSeverity(findings);
    return {
        schemaId: 'atm.teamPatrolReport.v1',
        action: 'patrol',
        readOnly: true,
        runtimeWritten: false,
        historyWritten: false,
        agentsSpawned: false,
        mutations: [],
        taskId: input.taskId,
        runId: `patrol-${input.taskId}-${input.mode}`,
        patrolTeam: ['atomic-police', 'scope-guardian', 'evidence-auditor', 'runtime-sentinel'],
        mode: input.mode,
        severity,
        safeToProceed: severity !== 'blocker',
        findings,
        suggestedCommand: suggestedPatrolCommand(input.taskId, input.mode, severity),
        followUp: buildTeamPatrolFollowUp(input.taskId, input.mode, findings),
        task: taskSummary,
        inspected: {
            taskPath: path.relative(input.cwd, taskPath).replace(/\\/g, '/'),
            evidencePath: path.relative(input.cwd, evidencePath).replace(/\\/g, '/'),
            closurePacketPath: path.relative(input.cwd, closurePacketPath).replace(/\\/g, '/'),
            teamRunId: teamRun?.teamRunId ?? null,
            teamRunPath: teamRun?.teamRunId ? `.atm/runtime/team-runs/${teamRun.teamRunId}.json` : null,
            runtimeRoot: '.atm/runtime',
            historyRoot: '.atm/history'
        }
    };
}
function buildTeamHandoffPatrolFindings(cwd, taskId, teamRunId, mode) {
    const directory = teamHandoffRuntimeDirectory(cwd, taskId, teamRunId);
    if (!existsSync(directory))
        return [];
    const findings = [];
    const integrity = verifyTeamHandoffLedger(cwd, taskId, teamRunId);
    if (!integrity.ok) {
        findings.push(teamPatrolFinding({
            level: 'blocker', code: 'ATM_TEAM_PATROL_HANDOFF_INTEGRITY_BLOCKED', category: 'artifact-gap',
            summary: `Handoff ledger integrity is blocked: ${integrity.reason ?? 'unknown reason'}.`,
            suggestedCommand: `node atm.mjs team handoff show --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
            details: { teamRunId, reason: integrity.reason, canonicalReason: 'handoff-integrity-blocked' }
        }));
        return findings;
    }
    const indexPath = path.join(directory, 'index.md');
    const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
    const expected = renderCanonicalTeamHandoffIndex(integrity.manifest, directory);
    if (!index || index !== expected) {
        findings.push(teamPatrolFinding({
            level: 'blocker', code: 'ATM_TEAM_PATROL_HANDOFF_NARRATIVE_DRIFT', category: 'artifact-gap',
            summary: 'Handoff Markdown is not the deterministic JSON-whitelist projection.',
            suggestedCommand: `node atm.mjs team handoff show --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
            details: { teamRunId, canonicalReason: 'handoff-integrity-blocked' }
        }));
    }
    if (/\uFFFD/.test(index) || Buffer.from(index, 'utf8').toString('utf8') !== index) {
        findings.push(teamPatrolFinding({
            level: 'blocker', code: 'ATM_TEAM_PATROL_HANDOFF_ENCODING_INVALID', category: 'artifact-gap',
            summary: 'Handoff Markdown is not valid stable UTF-8 text.',
            suggestedCommand: `node atm.mjs team handoff show --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
            details: { teamRunId, canonicalReason: 'handoff-integrity-blocked' }
        }));
    }
    const bytes = integrity.manifest.artifacts.reduce((total, entry) => total + readFileSync(path.join(directory, entry.file)).byteLength, 0);
    if (integrity.manifest.transitionCount >= 64 || bytes >= 512 * 1024) {
        findings.push(teamPatrolFinding({
            level: 'blocker', code: 'ATM_TEAM_PATROL_HANDOFF_HARD_LIMIT', category: 'runtime-mode',
            summary: 'Handoff retention hard limit requires Captain sign-off before another transition.',
            suggestedCommand: `node atm.mjs team handoff stats --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
            details: { teamRunId, transitionCount: integrity.manifest.transitionCount, bytes, decisionClass: 'human-signoff-required' }
        }));
    }
    else if (integrity.manifest.transitionCount >= 48 || bytes >= 384 * 1024) {
        findings.push(teamPatrolFinding({
            level: mode === 'close-preflight' ? 'warning' : 'info', code: 'ATM_TEAM_PATROL_HANDOFF_SOFT_LIMIT', category: 'runtime-mode',
            summary: 'Handoff retention soft limit reached; Captain should prepare to split or archive the run.',
            suggestedCommand: `node atm.mjs team handoff stats --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
            details: { teamRunId, transitionCount: integrity.manifest.transitionCount, bytes }
        }));
    }
    return findings;
}
function renderCanonicalTeamHandoffIndex(manifest, directory) {
    return renderTeamHandoffIndex(manifest, readTeamHandoffArtifacts(directory, manifest));
}
function normalizeTeamLifecyclePaths(value) {
    return uniqueStrings(String(value ?? '')
        .split(',')
        .map((entry) => entry.trim().replace(/\\/g, '/'))
        .filter(Boolean));
}
function runTeamLifecycleAction(input) {
    if (!input.teamRunId) {
        throw new CliError('ATM_TEAM_RUN_REQUIRED', `team ${input.action} requires --team <id>.`, { exitCode: 2 });
    }
    if (!input.actorId) {
        throw new CliError('ATM_TEAM_ACTOR_REQUIRED', `team ${input.action} requires --actor <id>.`, { exitCode: 2 });
    }
    if ((input.action === 'lease' || input.action === 'release') && !input.permission) {
        throw new CliError('ATM_TEAM_PERMISSION_REQUIRED', `team ${input.action} requires --permission <id>.`, { exitCode: 2 });
    }
    if (input.action === 'lease' || input.action === 'release') {
        const definition = teamPermissionCatalog.find((entry) => entry.id === input.permission);
        if (!definition || definition.hardGate !== true) {
            throw new CliError('ATM_TEAM_PERMISSION_HARD_GATE_BLOCKED', `Permission ${input.permission || '<missing>'} is not registered with a hard gate.`, {
                exitCode: 1,
                details: {
                    teamRunId: input.teamRunId,
                    permission: input.permission || null,
                    gateId: 'ATM_TEAM_PERMISSION_HARD_GATE',
                    requiredCommand: 'node atm.mjs team validate --json'
                }
            });
        }
        if (input.action === 'lease' && definition.scopeRequired && input.paths.length === 0) {
            throw new CliError('ATM_TEAM_PERMISSION_SCOPE_REQUIRED', `Permission ${input.permission} requires explicit scoped paths.`, {
                exitCode: 1,
                details: {
                    teamRunId: input.teamRunId,
                    permission: input.permission,
                    gateId: 'ATM_TEAM_PERMISSION_HARD_GATE',
                    requiredCommand: `node atm.mjs team lease --team ${input.teamRunId} --actor ${input.actorId} --permission ${input.permission} --paths <scoped-paths> --json`
                }
            });
        }
    }
    const run = readTeamRun(input.cwd, input.teamRunId);
    const status = String(run.status ?? '');
    if (status !== 'active') {
        throw new CliError('ATM_TEAM_RUN_NOT_ACTIVE', `Team run ${input.teamRunId} is ${status || 'unknown'}, not active.`, {
            exitCode: 1,
            details: { teamRunId: input.teamRunId, status }
        });
    }
    const now = new Date().toISOString();
    const currentLeases = normalizePermissionLeaseRecords(run.permissionLeases ?? run.leases);
    const lifecycleEvents = Array.isArray(run.lifecycleEvents) ? [...run.lifecycleEvents] : [];
    let nextLeases = currentLeases;
    if (input.action === 'lease') {
        const conflict = currentLeases.find((lease) => lease.permission === input.permission && lease.agentId !== input.actorId);
        if (conflict) {
            throw new CliError('ATM_TEAM_LEASE_CONFLICT', `Permission ${input.permission} is already leased to ${conflict.agentId}.`, {
                exitCode: 1,
                details: buildTeamLeaseConflictDetails({
                    teamRunId: input.teamRunId,
                    permission: input.permission,
                    requestedOwner: input.actorId,
                    conflict,
                    currentLeases
                })
            });
        }
        const lease = {
            permission: input.permission,
            agentId: input.actorId,
            paths: input.paths
        };
        nextLeases = [
            ...currentLeases.filter((entry) => !(entry.permission === input.permission && entry.agentId === input.actorId)),
            lease
        ];
        lifecycleEvents.push(teamLifecycleEvent('lease.granted', input, now, { lease }));
    }
    if (input.action === 'release') {
        const matched = currentLeases.filter((lease) => lease.permission === input.permission && lease.agentId === input.actorId);
        if (matched.length === 0) {
            throw new CliError('ATM_TEAM_LEASE_NOT_FOUND', `No ${input.permission} lease owned by ${input.actorId} exists on ${input.teamRunId}.`, {
                exitCode: 1,
                details: buildTeamLeaseNotFoundDetails({
                    teamRunId: input.teamRunId,
                    permission: input.permission,
                    actorId: input.actorId,
                    currentLeases
                })
            });
        }
        nextLeases = currentLeases.filter((lease) => !(lease.permission === input.permission && lease.agentId === input.actorId));
        lifecycleEvents.push(teamLifecycleEvent('lease.released', input, now, { releasedLeases: matched }));
    }
    if (input.action === 'complete') {
        run.status = 'completed';
        run.completedAt = now;
        run.completedBy = input.actorId;
        run.completionReason = input.reason || null;
        const teamSummary = typeof run.teamSummary === 'object' && run.teamSummary !== null
            ? { ...run.teamSummary, closeReady: true }
            : { closeReady: true };
        run.teamSummary = teamSummary;
        lifecycleEvents.push(teamLifecycleEvent('team.completed', input, now));
    }
    if (input.action === 'abandon') {
        run.status = 'abandoned';
        run.abandonedAt = now;
        run.abandonedBy = input.actorId;
        run.abandonReason = input.reason || null;
        const teamSummary = typeof run.teamSummary === 'object' && run.teamSummary !== null
            ? { ...run.teamSummary, closeReady: false }
            : { closeReady: false };
        run.teamSummary = teamSummary;
        lifecycleEvents.push(teamLifecycleEvent('team.abandoned', input, now));
    }
    run.leases = nextLeases;
    run.permissionLeases = nextLeases;
    run.lifecycleEvents = lifecycleEvents;
    run.updatedAt = now;
    writeExistingTeamRun(input.cwd, input.teamRunId, run);
    return makeResult({
        ok: true,
        command: 'team',
        cwd: input.cwd,
        messages: [
            message('info', 'ATM_TEAM_LIFECYCLE_UPDATED', `Team run ${input.teamRunId} ${input.action} recorded.`, {
                teamRunId: input.teamRunId,
                action: input.action,
                status: run.status,
                leaseCount: nextLeases.length
            })
        ],
        evidence: {
            action: `team.${input.action}`,
            teamRunId: input.teamRunId,
            actorId: input.actorId,
            permission: input.permission || null,
            paths: input.paths,
            status: run.status,
            leaseCount: nextLeases.length,
            lifecycleEventCount: lifecycleEvents.length,
            teamRun: compactTeamRun(run)
        }
    });
}
function teamLifecycleEvent(type, input, occurredAt, extra = {}) {
    return {
        schemaId: 'atm.teamRuntimeLifecycleEvent.v1',
        type,
        teamRunId: input.teamRunId,
        actorId: input.actorId,
        permission: input.permission || null,
        paths: input.paths,
        reason: input.reason || null,
        occurredAt,
        ...extra
    };
}
function normalizeTeamPatrolMode(value) {
    const mode = String(value ?? 'claim-preflight').trim();
    if (['claim-preflight', 'close-preflight', 'big-script', 'daily-noon'].includes(mode)) {
        return mode;
    }
    throw new CliError('ATM_TEAM_PATROL_MODE_INVALID', `Unsupported team patrol mode: ${mode}`, {
        exitCode: 2,
        details: { supportedModes: ['claim-preflight', 'close-preflight', 'big-script', 'daily-noon'] }
    });
}
function summarizeTask(taskId, task) {
    return {
        taskId,
        title: task?.title ?? task?.workItemId ?? taskId,
        status: task?.status ?? null,
        targetRepo: task?.targetRepo ?? null,
        sourcePlanPath: task?.source?.planPath ?? task?.sourcePlanPath ?? null
    };
}
function readOptionValue(argv, flag) {
    const index = argv.indexOf(flag);
    if (index < 0) {
        return undefined;
    }
    return argv[index + 1];
}
function deriveWritePaths(task, repoRoot) {
    return deriveTeamWriteScope(task, repoRoot).writePaths;
}
function deriveTeamWriteScope(task, repoRoot) {
    const explicitAllowed = normalizeTaskPathArray(task?.targetAllowedFiles, repoRoot);
    if (explicitAllowed.length > 0) {
        return {
            writePaths: normalizeTaskWriteScope(explicitAllowed, repoRoot),
            planningReadOnlyPaths: [],
            allowEmptyWriteScope: false
        };
    }
    const rawCandidates = [
        ...normalizeStringArray(task?.deliverables),
        ...normalizeStringArray(task?.scopePaths)
    ];
    const candidates = normalizeTargetWritePathArray(rawCandidates, repoRoot);
    const planningReadOnlyPaths = collectPlanningReadOnlyPaths(task, repoRoot, rawCandidates);
    const writePaths = uniqueStrings(candidates.map((entry) => normalizeTeamLeasePath(entry, repoRoot)).filter((normalized) => {
        return normalized && !normalized.startsWith('.atm/runtime/') && !normalized.startsWith('.atm/history/');
    }));
    return {
        writePaths,
        planningReadOnlyPaths,
        allowEmptyWriteScope: writePaths.length === 0 && planningReadOnlyPaths.length > 0
    };
}
function collectPlanningReadOnlyPaths(task, repoRoot, rawCandidates) {
    const planningRepo = String(task?.planningRepo ?? '').trim();
    if (!planningRepo)
        return [];
    const planningRoot = path.isAbsolute(planningRepo)
        ? path.resolve(planningRepo)
        : (repoRoot ? path.resolve(repoRoot, planningRepo) : '');
    if (!planningRoot)
        return [];
    return uniqueStrings(rawCandidates.map((entry) => normalizeAbsolutePathUnderRoot(entry, planningRoot)).filter(Boolean));
}
function normalizeAbsolutePathUnderRoot(rawPath, rootPath) {
    const raw = String(rawPath).trim();
    if (!raw || !path.isAbsolute(raw))
        return '';
    const candidate = path.resolve(raw);
    const relative = path.relative(path.resolve(rootPath), candidate);
    if (!relative || relative === '')
        return '';
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        return '';
    return relative.replace(/\\/g, '/');
}
function normalizeTargetWritePathArray(paths, repoRoot) {
    return paths
        .map((entry) => normalizeTargetWritePath(entry, repoRoot))
        .filter((entry) => Boolean(entry) && validateStrictPathHeuristic(entry) === null);
}
function normalizeTargetWritePath(rawPath, repoRoot) {
    const raw = String(rawPath).trim();
    if (!raw)
        return '';
    const normalizedRaw = raw.replace(/\\/g, '/');
    if ((normalizedRaw.startsWith('/') || /^[A-Za-z]:\//.test(normalizedRaw)) && normalizeRepoAbsoluteLeasePath(raw, repoRoot) === null) {
        return '';
    }
    return normalizeTeamLeasePath(raw, repoRoot);
}
function collectTaskPathHints(task) {
    return uniqueStrings([
        ...normalizeTaskPathArray(task?.targetAllowedFiles),
        ...normalizeTaskPathArray(task?.deliverables),
        ...normalizeTaskPathArray(task?.scopePaths)
    ]);
}
function normalizeTaskPathArray(value, repoRoot) {
    return normalizeStringArray(value)
        .map((entry) => normalizeTeamLeasePath(entry, repoRoot))
        .filter((entry) => Boolean(entry) && validateStrictPathHeuristic(entry) === null);
}
function normalizeStringArray(value) {
    return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}
function uniqueStrings(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
