import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, parseArgsForCommand, quoteCliValue, readJsonFile, writeJsonFile } from './shared.js';
import { TEAM_CLOSURE_ATTESTATION_SCHEMA_ID } from './evidence.js';
import { getCommandSpec } from './command-specs.js';
import { inspectTeamRuntimeBackendCapabilities } from './integration.js';
import { runTasks } from './tasks.js';
import { findTaskClaimDependencyBlockers } from './tasks/dependency-gates.js';
import { validateStrictPathHeuristic } from './tasks/task-import-validators.js';
import { buildTeamKnowledgeSummary, runTeamKnowledge } from './team-knowledge.js';
import { runTeamWave } from './team-wave.js';
import { buildTeamBrokerEvidence, brokerLaneToFindings, evaluateTeamBrokerLane } from '../../../core/dist/broker/team-lane.js';
import { resolveNodejsTeamWorkerAdapter } from '../../../core/dist/team-runtime/nodejs-worker-adapter.js';
import { createBrokerConflictResolutionArtifact } from '../../../core/dist/team-runtime/permission-broker.js';
import { buildTeamObservabilityContract, createBrokerConflictObservabilityEvents, createTeamObservabilityEvent, queryTeamObservabilityEvents } from '../../../core/dist/team-runtime/observability.js';
import { buildAnthropicTeamProviderBridgeDescriptor, createAnthropicTeamProviderBridge, launchAnthropicTeamProviderRun } from '../../../core/dist/team-runtime/providers/anthropic.js';
import { buildAzureOpenAITeamProviderBridgeDescriptor } from '../../../core/dist/team-runtime/providers/azure-openai.js';
import { buildClaudeCodeTeamProviderBridgeDescriptor } from '../../../core/dist/team-runtime/providers/claude-code.js';
import { buildGeminiTeamProviderBridgeDescriptor } from '../../../core/dist/team-runtime/providers/gemini.js';
import { buildGeminiDirectTeamProviderBridgeDescriptor, createGeminiDirectTeamProviderBridge, launchGeminiDirectTeamProviderRun } from '../../../core/dist/team-runtime/providers/gemini-direct.js';
import { buildMicrosoftFoundryTeamProviderBridgeDescriptor } from '../../../core/dist/team-runtime/providers/microsoft-foundry.js';
import { buildOpenAITeamProviderBridgeDescriptor, createOpenAITeamProviderBridge, launchOpenAITeamProviderRun } from '../../../core/dist/team-runtime/providers/openai.js';
import { TEAM_PROVIDER_IDS } from '../../../core/dist/team-runtime/provider-contract.js';
import { createDefaultTeamPermissionPolicy } from '../../../core/dist/team-runtime/permission-broker.js';
import { materializeTeamRoleHandoff, readTeamHandoffArtifacts, renderTeamHandoffIndex, teamHandoffRuntimeDirectory, verifyTeamHandoffLedger } from '../../../core/dist/team-runtime/handoff-ledger.js';
import { mergeTeamProviderSelectionConfig, resolveTeamProviderSelection } from '../../../core/dist/team-runtime/provider-selection.js';
import { readBrokerProposalFile, validateBrokerProposal } from '../../../core/dist/broker/proposal.js';
const teamPermissionCatalog = [
    { id: 'task.lifecycle', mode: 'exclusive', hardGate: true },
    { id: 'git.write', mode: 'exclusive', hardGate: true },
    { id: 'file.read', mode: 'shareable', scopeRequired: true, hardGate: true },
    { id: 'file.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'web.query', mode: 'exclusive', hardGate: true },
    { id: 'web.download', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'exec.validator', mode: 'shareable', scopeRequired: true, hardGate: true },
    { id: 'exec.mutating', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'sandbox.write', mode: 'exclusive', hardGate: true },
    { id: 'pipeline.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'database.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'ci.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'evidence.write', mode: 'exclusive', hardGate: true },
    { id: 'knowledge.query', mode: 'shareable', hardGate: true },
    { id: 'knowledge.index.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'review.signature.write', mode: 'exclusive', hardGate: true }
];
const coordinatorExclusivePermissions = ['task.lifecycle', 'git.write', 'evidence.write'];
const readOnlyTeamRoles = new Set([
    'atomizationPlanner',
    'scopeGuardian',
    'reader',
    'evidenceCollector',
    'validator',
    'lieutenant',
    'reviewAgent',
    'knowledgeScout'
]);
const writeTeamPermissions = new Set([
    'task.lifecycle',
    'git.write',
    'file.write',
    'evidence.write',
    'review.signature.write',
    'web.query',
    'web.download',
    'knowledge.index.write',
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
    'team.start-claim-gate-parity': {
        anchor: 'packages/cli/src/commands/team.ts#buildTeamClaimAdmissionFindings',
        capability: 'Team plan/start claim admission parity against normal task dependency gates.',
        downstreamTasks: ['TASK-TEAM-0029']
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
    'team.runtime-mode-contract': {
        anchor: 'packages/cli/src/commands/team.ts#buildTeamRuntimeContract',
        capability: 'Neutral Team runtime mode and adapter metadata contract for real-agent, editor-subagent, and broker-only execution surfaces.',
        downstreamTasks: ['TASK-TEAM-0031']
    },
    'team.patrol-report': {
        anchor: 'packages/cli/src/commands/team.ts#buildTeamPatrolReport',
        capability: 'Read-only patrol report for runtime mode, broker-governance evidence gates, rework readiness, missing artifacts, and retry-budget risk.',
        downstreamTasks: ['TASK-TEAM-0014']
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
    },
    'team.lease-fencing-deadlock-contract': {
        anchor: 'packages/core/src/governance/scope-lock.ts#validateScopeLeaseFencing',
        capability: 'Team lease fencing diagnostics for duplicate exclusive owners, stale lease epochs, wait-for cycles, released tombstones, and allowedFiles write boundaries across real-agent, editor-subagent, and broker-only runs.',
        downstreamTasks: ['TASK-TEAM-0018']
    },
    'team.next-recommendation': {
        anchor: 'packages/cli/src/commands/team.ts#buildTeamRecommendation',
        capability: 'Advisory next/playbook teamRecommendation surface with plan/start/status/reason command hints without auto-running team commands.',
        downstreamTasks: ['TASK-TEAM-0015']
    },
    'team.knowledge-build-query': {
        anchor: 'packages/cli/src/commands/team-knowledge.ts#runTeamKnowledge',
        capability: 'Advisory Team Agents knowledge build/query dry-run surface with metadata filtering and lexical ranking.',
        downstreamTasks: ['TASK-TEAM-0021']
    },
    'team.broker-conflict-resolution': {
        anchor: 'packages/cli/src/commands/team.ts#runTeamBrokerConflictResolve',
        capability: 'Team Broker conflict resolve command that emits atm.brokerConflictResolution.v1 artifacts with decisionClass, decisionReason, violationStatus, and broker-conflict-blocked release-order semantics.',
        downstreamTasks: ['TASK-TEAM-0046']
    }
};
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
const teamRosterLevelRoles = {
    L1: ['coordinator', 'atomizationPlanner', 'implementer', 'validator'],
    L2: ['coordinator', 'atomizationPlanner', 'reader', 'implementer', 'validator', 'evidenceCollector'],
    L3: ['coordinator', 'atomizationPlanner', 'reader', 'scopeGuardian', 'implementer', 'validator', 'evidenceCollector'],
    L4: ['coordinator', 'atomizationPlanner', 'reader', 'scopeGuardian', 'implementer', 'validator', 'evidenceCollector', 'lieutenant'],
    L5: ['coordinator', 'atomizationPlanner', 'reader', 'scopeGuardian', 'implementer', 'validator', 'evidenceCollector', 'lieutenant', 'reviewAgent', 'knowledgeScout']
};
const teamRosterSyntheticAgents = {
    lieutenant: { agentId: 'lieutenant', role: 'lieutenant', profile: 'atm.lieutenant.v1', permissions: ['file.read', 'exec.validator'] },
    reviewAgent: { agentId: 'review-agent', role: 'reviewAgent', profile: 'atm.reviewAgent.v1', permissions: ['file.read', 'exec.validator'] },
    knowledgeScout: { agentId: 'knowledge-scout', role: 'knowledgeScout', profile: 'atm.knowledgeScout.v1', permissions: ['file.read'] }
};
const catalogReadyRosterDeferredRoles = [
    'dataPipelineAgent',
    'dbContainerAgent',
    'ciAgent',
    'webResearchAgent',
    'qaLead',
    'closureSteward'
];
export async function runTeam(argv) {
    if (String(argv[0] ?? '').toLowerCase() === 'handoff') {
        return runTeamHandoff(argv.slice(1), path.resolve(readOptionValue(argv, '--cwd') ?? process.cwd()));
    }
    if (String(argv[0] ?? '').toLowerCase() === 'knowledge') {
        const cwd = path.resolve(readOptionValue(argv, '--cwd') ?? process.cwd());
        return runTeamKnowledge(argv.slice(1), cwd);
    }
    if (String(argv[0] ?? '').toLowerCase() === 'broker') {
        return runTeamBroker(argv.slice(1), process.cwd());
    }
    if (String(argv[0] ?? '').toLowerCase() === 'observability') {
        const cwd = path.resolve(readOptionValue(argv, '--cwd') ?? process.cwd());
        return runTeamObservability(argv.slice(1), cwd);
    }
    const spec = getCommandSpec('team');
    const parsed = parseArgsForCommand(spec, argv);
    const action = String(parsed.positional[0] ?? 'plan').toLowerCase();
    const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
    if (action === 'wave') {
        // TASK-MAO-0024: Team Agents Wave Mode planning surface.
        return runTeamWave(parsed.positional.slice(1).map(String), cwd);
    }
    if (action === 'knowledge') {
        const knowledgeArgv = argv[0]?.toLowerCase() === 'knowledge' ? argv.slice(1) : parsed.positional.slice(1).map(String);
        return runTeamKnowledge(knowledgeArgv, cwd);
    }
    if (action === 'broker') {
        return runTeamBroker(parsed.positional.slice(1).map(String), cwd);
    }
    if (action === 'observability') {
        return runTeamObservability(parsed.positional.slice(1).map(String), cwd);
    }
    if (!['plan', 'start', 'status', 'validate', 'patrol', 'lease', 'release', 'complete', 'abandon'].includes(action)) {
        throw new CliError('ATM_CLI_USAGE', 'team supports: plan, start, status, validate, patrol, lease, release, complete, abandon, wave, knowledge, broker resolve, observability query', { exitCode: 2 });
    }
    if (action === 'status') {
        return buildTeamStatusResult({
            cwd,
            requestedTeamRunId: String(parsed.options.team ?? '').trim(),
            compact: Boolean(parsed.options.compact)
        });
    }
    if (['lease', 'release', 'complete', 'abandon'].includes(action)) {
        return runTeamLifecycleAction({
            cwd,
            action: action,
            teamRunId: String(parsed.options.team ?? '').trim(),
            actorId: String(parsed.options.actor ?? '').trim(),
            permission: String(parsed.options.permission ?? '').trim(),
            paths: normalizeTeamLifecyclePaths(parsed.options.paths),
            reason: String(parsed.options.reason ?? '').trim()
        });
    }
    const taskId = String(parsed.options.task ?? '').trim();
    if (!taskId) {
        throw new CliError('ATM_TEAM_TASK_REQUIRED', `team ${action} requires --task <id>.`, { exitCode: 2 });
    }
    if (action === 'patrol') {
        return buildTeamPatrolResult({
            cwd,
            taskId,
            mode: normalizeTeamPatrolMode(parsed.options.mode),
            requestedTeamRunId: String(parsed.options.team ?? '').trim()
        });
    }
    const context = await buildTeamPlanningContext({
        cwd,
        taskId,
        requestedRecipeId: String(parsed.options.recipe ?? '').trim(),
        actorId: String(parsed.options.actor ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? 'team-planner').trim(),
        requestedTeamSize: String(parsed.options.teamSize ?? '').trim(),
        brokerProposalFile: String(parsed.options.brokerProposalFile ?? '').trim(),
        providerSelectionConfig: loadTeamProviderSelectionConfig(cwd, normalizeStringArray(parsed.options.roleProvider))
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
        allowedFiles: deriveWritePaths(task, cwd),
        permissionLeases: teamPlan.suggestedPermissionLeases,
        evidenceRequired: String(task.evidenceRequired ?? 'command-backed')
    });
    const runtimeBackendReadiness = inspectTeamRuntimeBackendCapabilities(cwd);
    if (action === 'validate') {
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
        const executionBlocked = executeRequested && (providerOrchestration.results.length === 0
            || providerOrchestration.results.some((result) => !result.ok));
        return makeResult({
            ok: !executionBlocked,
            command: 'team',
            cwd,
            messages: [
                message(executionBlocked ? 'error' : 'info', executeRequested && providerOrchestration.results.length > 0 ? 'ATM_TEAM_STARTED_EXECUTED' : executionBlocked ? 'ATM_TEAM_EXECUTION_BLOCKED' : 'ATM_TEAM_STARTED', executeRequested && providerOrchestration.results.length > 0
                    ? 'Team run started and governed provider orchestration executed.'
                    : executionBlocked
                        ? 'Team run state was written, but the explicit provider execution request was blocked or at least one provider role failed.'
                        : 'Team run started. Runtime state was written, but no agents were spawned.', {
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
    const actorId = readOptionValue(argv, '--actor')?.trim() ?? '';
    if (!taskId || !teamRunId)
        throw new CliError('ATM_TEAM_HANDOFF_TASK_RUN_REQUIRED', 'team handoff requires --task and --team.', { exitCode: 2 });
    if (action === 'materialize' && actorId !== 'coordinator' && actorId !== 'system')
        throw new CliError('ATM_TEAM_HANDOFF_MATERIALIZE_FORBIDDEN', 'handoff.materialize is Coordinator/system-only.', { exitCode: 1 });
    if (!['show', 'context', 'stats'].includes(action))
        throw new CliError('ATM_CLI_USAGE', 'team handoff supports: show, context, stats.', { exitCode: 2 });
    const integrity = verifyTeamHandoffLedger(cwd, taskId, teamRunId);
    if (!integrity.ok)
        throw new CliError('ATM_TEAM_HANDOFF_INTEGRITY_BLOCKED', `handoff-integrity-blocked: ${integrity.reason}.`, { exitCode: 1 });
    const directory = teamHandoffRuntimeDirectory(cwd, taskId, teamRunId);
    const artifacts = readTeamHandoffArtifacts(directory, integrity.manifest);
    const bounded = artifacts.slice(-TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS).map((artifact) => ({ role: artifact.from.role, providerId: artifact.from.providerId, outputTextPreview: artifact.humanSummary }));
    const context = buildDirectTeamRoleInstructions({ taskId, role: 'consumer', priorRoleArtifacts: bounded });
    return makeResult({ ok: true, command: 'team', cwd, messages: [message('info', 'ATM_TEAM_HANDOFF_READY', `Team handoff ${action} is ready.`)], evidence: { action: `handoff.${action}`, taskId, teamRunId, manifest: integrity.manifest, artifacts: action === 'show' ? artifacts : undefined, context: action === 'context' ? context : undefined, stats: action === 'stats' ? { transitionCount: integrity.manifest.transitionCount, contextTokens: context.telemetry.actualTokenCount } : undefined } });
}
export function buildBrokerConflictSharedVocabulary(brokerLane) {
    if (brokerLane.safeToStart) {
        return null;
    }
    const firstReason = brokerLane.blockedReasons[0] ?? 'Team Broker did not grant start authority.';
    return {
        decisionClass: 'blocked',
        decisionReason: firstReason.includes('broker-conflict-blocked')
            ? firstReason
            : `broker-conflict-blocked: ${firstReason}`,
        violationStatus: 'broker-conflict-blocked',
        statusCode: 'broker-conflict-blocked'
    };
}
function evaluateTeamRuntimeBackendAdmission(runtimeContract, readiness) {
    if (runtimeContract.runtimeMode === 'broker-only') {
        return {
            ok: true,
            reason: 'broker-only mode is governed by Team Broker and does not require a declared runtime backend.'
        };
    }
    const providerId = runtimeContract.providerId ?? '';
    const matchingCapability = readiness.capabilities.find((capability) => {
        return capability.providerId === providerId
            && capability.status !== 'unavailable'
            && capability.runtimeModes.includes(runtimeContract.runtimeMode)
            && capability.executionSurfaces.includes(runtimeContract.executionSurface);
    }) ?? null;
    if (matchingCapability) {
        return {
            ok: true,
            reason: `Runtime backend declared by ${matchingCapability.manifestPath}.`
        };
    }
    return {
        ok: false,
        reason: `Team runtime start requires an integration manifest teamRuntimeCapabilities entry for provider ${providerId || '(missing)'}, mode ${runtimeContract.runtimeMode}, and surface ${runtimeContract.executionSurface}. Installed editor integrations are not runtime backends unless their manifest declares this capability.`
    };
}
export function buildBrokerConflictUxProjection(input) {
    const primaryTaskId = String(input.primaryTaskId ?? '').trim();
    const conflictingTaskIds = uniqueStrings(input.conflictingTaskIds.map((entry) => String(entry).trim()).filter(Boolean));
    const sharedPaths = uniqueStrings((input.sharedPaths ?? []).map((entry) => String(entry).trim()).filter(Boolean));
    const overlappingAtomIds = uniqueStrings((input.overlappingAtomIds ?? []).map((entry) => String(entry).trim()).filter(Boolean));
    const currentAllowedTaskId = input.currentAllowedTaskId ?? primaryTaskId;
    const blockedTaskIds = uniqueStrings((input.blockedTaskIds?.length ? input.blockedTaskIds : conflictingTaskIds)
        .map((entry) => String(entry).trim())
        .filter(Boolean));
    const decisionReason = String(input.decisionReason ?? '').trim()
        || 'broker-conflict-blocked until the release order grants the next task.';
    const nextSafeResolutionCommand = input.requiredCommand?.trim()
        || `node atm.mjs team broker resolve --task ${primaryTaskId} --conflict ${conflictingTaskIds[0] ?? '<task-id>'} --path ${sharedPaths[0] ?? '<shared-path>'} --decision-reason "broker-conflict-blocked until the release order grants the next task." --json`;
    return {
        schemaId: 'atm.brokerConflictUx.v1',
        playbookSlice: 'broker-conflict-resolution',
        requiredResolutionArtifact: 'atm.brokerConflictResolution.v1',
        decisionClass: input.decisionClass,
        decisionReason,
        violationStatus: input.violationStatus,
        statusCode: input.statusCode ?? input.violationStatus,
        primaryTaskId,
        conflictingTaskIds,
        blockedTaskIds,
        currentAllowedTaskId,
        sharedPaths,
        overlappingAtomIds,
        nextSafeResolutionCommand,
        captainGuidance: [
            'Stop write progression while violationStatus is broker-conflict-blocked.',
            'Use the nextSafeResolutionCommand to produce an atm.brokerConflictResolution.v1 artifact.',
            'Do not hand-edit .atm/runtime/** to clear or reorder the conflict.'
        ]
    };
}
function runTeamBroker(argv, defaultCwd) {
    const action = String(argv[0] ?? '').toLowerCase();
    if (!['resolve', 'conflict-resolve'].includes(action)) {
        throw new CliError('ATM_CLI_USAGE', 'team broker supports: resolve', { exitCode: 2 });
    }
    return runTeamBrokerConflictResolve(argv.slice(1), defaultCwd);
}
function runTeamObservability(argv, defaultCwd) {
    const action = String(argv[0] ?? '').toLowerCase();
    if (action !== 'query') {
        throw new CliError('ATM_CLI_USAGE', 'team observability supports: query', { exitCode: 2 });
    }
    const cwd = path.resolve(readOptionValue(argv, '--cwd') ?? defaultCwd);
    const fixture = readOptionValue(argv, '--fixture')?.trim() ?? null;
    const filters = {
        taskId: readOptionValue(argv, '--task-filter') ?? readOptionValue(argv, '--task'),
        teamRunId: readOptionValue(argv, '--team-run-filter') ?? readOptionValue(argv, '--team-run'),
        providerId: readOptionValue(argv, '--provider-filter') ?? readOptionValue(argv, '--provider'),
        role: readOptionValue(argv, '--role-filter') ?? readOptionValue(argv, '--role'),
        artifactType: readOptionValue(argv, '--artifact') ?? readOptionValue(argv, '--artifact-type'),
        eventType: readOptionValue(argv, '--event-type')
    };
    if (!fixture) {
        const events = readTeamRuntimeObservabilityEvents(cwd, readOptionValue(argv, '--team-run'));
        const query = queryTeamObservabilityEvents(events, filters);
        return makeResult({
            ok: true,
            command: 'team observability query',
            mode: 'standalone',
            cwd,
            messages: [
                message('info', 'ATM_TEAM_OBSERVABILITY_QUERY_READY', 'Team observability query returned runtime event records.', {
                    eventCount: query.eventCount,
                    filters: query.filters
                })
            ],
            evidence: {
                action: 'observability.query',
                dryRun: true,
                fixture: null,
                eventSource: 'runtime',
                contract: buildTeamObservabilityContract(),
                query
            }
        });
    }
    if (fixture !== 'broker-conflict-resolution') {
        throw new CliError('ATM_TEAM_OBSERVABILITY_FIXTURE_UNSUPPORTED', `Unsupported team observability fixture: ${fixture}`, { exitCode: 2 });
    }
    const emittedAt = readOptionValue(argv, '--emitted-at') ?? '2026-07-10T00:00:00.000Z';
    const primaryTaskId = String(readOptionValue(argv, '--task') ?? 'TASK-TEAM-0040').trim();
    const conflictingTaskIds = readOptionValues(argv, '--conflict');
    const sharedPaths = readOptionValues(argv, '--path');
    const artifact = createBrokerConflictResolutionArtifact({
        primaryTaskId,
        conflictingTaskIds: conflictingTaskIds.length > 0 ? conflictingTaskIds : ['TASK-TEAM-0047'],
        sharedPaths: sharedPaths.length > 0 ? sharedPaths : ['packages/cli/src/commands/team.ts'],
        decisionClass: normalizeBrokerDecisionClass(readOptionValue(argv, '--decision-class')),
        decisionReason: readOptionValue(argv, '--decision-reason')
            ?? 'broker-conflict-blocked until the release order grants the next task.',
        violationStatus: normalizeBrokerViolationStatus(readOptionValue(argv, '--violation-status')),
        releaseOrder: readOptionValues(argv, '--release-order'),
        createdAt: emittedAt
    });
    const providerId = String(readOptionValue(argv, '--provider') ?? 'openai').trim();
    const role = String(readOptionValue(argv, '--role') ?? 'coordinator').trim();
    const teamRunId = readOptionValue(argv, '--team-run') ?? `team-observability-${artifact.resolutionId.toLowerCase()}`;
    const events = createBrokerConflictObservabilityEvents({
        artifact,
        providerId,
        role,
        teamRunId,
        emittedAt
    });
    const query = queryTeamObservabilityEvents(events, filters);
    return makeResult({
        ok: true,
        command: 'team observability query',
        mode: 'standalone',
        cwd,
        messages: [
            message('info', 'ATM_TEAM_OBSERVABILITY_QUERY_READY', 'Team observability query returned shared event records.', {
                eventCount: query.eventCount,
                filters: query.filters
            })
        ],
        evidence: {
            action: 'observability.query',
            dryRun: true,
            fixture,
            eventSource: 'fixture',
            contract: buildTeamObservabilityContract(),
            artifact,
            query
        }
    });
}
function readTeamRuntimeObservabilityEvents(cwd, requestedTeamRunId) {
    const runIds = requestedTeamRunId?.trim()
        ? [requestedTeamRunId.trim()]
        : listTeamRuns(cwd).map((run) => String(run.teamRunId ?? '')).filter(Boolean);
    const events = [];
    for (const teamRunId of runIds) {
        const runDir = path.join(teamRunsDirectory(cwd), teamRunId);
        const jsonlPath = path.join(runDir, 'observability-events.jsonl');
        if (existsSync(jsonlPath)) {
            for (const line of readFileSync(jsonlPath, 'utf8').split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                try {
                    const parsed = JSON.parse(trimmed);
                    if (parsed?.schemaId === 'atm.teamAgentObservabilityEvent.v1') {
                        events.push(parsed);
                    }
                }
                catch {
                    // Ignore malformed runtime event lines; validators can flag corruption separately.
                }
            }
        }
        const run = existsSync(path.join(teamRunsDirectory(cwd), `${teamRunId}.json`))
            ? readTeamRun(cwd, teamRunId)
            : null;
        const embedded = Array.isArray(run?.observabilityEvents) ? run.observabilityEvents : [];
        for (const event of embedded) {
            if (event?.schemaId === 'atm.teamAgentObservabilityEvent.v1') {
                events.push(event);
            }
        }
    }
    const seen = new Set();
    return events.filter((event) => {
        if (seen.has(event.eventId))
            return false;
        seen.add(event.eventId);
        return true;
    });
}
export function runTeamBrokerConflictResolve(argv, defaultCwd) {
    const cwd = path.resolve(readOptionValue(argv, '--cwd') ?? defaultCwd);
    const primaryTaskId = readOptionValue(argv, '--task')?.trim();
    if (!primaryTaskId) {
        throw new CliError('ATM_TEAM_BROKER_RESOLVE_TASK_REQUIRED', 'team broker resolve requires --task <id>.', { exitCode: 2 });
    }
    const conflictingTaskIds = readOptionValues(argv, '--conflict');
    if (conflictingTaskIds.length === 0) {
        throw new CliError('ATM_TEAM_BROKER_RESOLVE_CONFLICT_REQUIRED', 'team broker resolve requires at least one --conflict <task-id>.', { exitCode: 2 });
    }
    const sharedPaths = readOptionValues(argv, '--path');
    if (sharedPaths.length === 0) {
        throw new CliError('ATM_TEAM_BROKER_RESOLVE_PATH_REQUIRED', 'team broker resolve requires at least one --path <file>.', { exitCode: 2 });
    }
    const decisionReason = readOptionValue(argv, '--decision-reason')?.trim()
        ?? 'Broker conflict blocked; tasks must consume the release order one at a time.';
    const decisionClass = normalizeBrokerDecisionClass(readOptionValue(argv, '--decision-class'));
    const violationStatus = normalizeBrokerViolationStatus(readOptionValue(argv, '--violation-status'));
    const releaseOrder = readOptionValues(argv, '--release-order');
    const createdAt = readOptionValue(argv, '--created-at')?.trim();
    const artifact = createBrokerConflictResolutionArtifact({
        primaryTaskId,
        conflictingTaskIds,
        sharedPaths,
        decisionClass,
        decisionReason,
        violationStatus,
        releaseOrder: releaseOrder.length ? releaseOrder : undefined,
        createdAt
    });
    const conflictUx = buildBrokerConflictUxProjection({
        primaryTaskId: artifact.primaryTaskId,
        conflictingTaskIds: artifact.conflictingTaskIds,
        sharedPaths: artifact.sharedPaths,
        decisionClass: artifact.decisionClass,
        decisionReason: artifact.decisionReason,
        violationStatus: artifact.violationStatus,
        statusCode: artifact.statusCode,
        currentAllowedTaskId: artifact.currentAllowedTaskId,
        blockedTaskIds: artifact.blockedTaskIds,
        requiredCommand: `node atm.mjs team broker resolve --task ${artifact.primaryTaskId} ${artifact.conflictingTaskIds.map((taskId) => `--conflict ${taskId}`).join(' ')} ${artifact.sharedPaths.map((sharedPath) => `--path ${sharedPath}`).join(' ')} --decision-reason "${artifact.decisionReason}" --json`
    });
    return makeResult({
        ok: true,
        command: 'team',
        cwd,
        messages: [
            message('info', 'ATM_TEAM_BROKER_CONFLICT_RESOLUTION_READY', 'Team Broker conflict resolution artifact generated.', {
                resolutionId: artifact.resolutionId,
                decisionClass: artifact.decisionClass,
                violationStatus: artifact.violationStatus,
                statusCode: artifact.statusCode,
                currentAllowedTaskId: artifact.currentAllowedTaskId,
                blockedTaskIds: artifact.blockedTaskIds,
                sharedPaths: artifact.sharedPaths,
                decisionReason: artifact.decisionReason,
                requiredResolutionArtifact: conflictUx.requiredResolutionArtifact,
                nextSafeResolutionCommand: conflictUx.nextSafeResolutionCommand
            })
        ],
        evidence: {
            action: 'broker.resolve',
            dryRun: true,
            runtimeWritten: false,
            agentsSpawned: false,
            artifact,
            conflictUx,
            sharedVocabulary: {
                decisionClass: artifact.decisionClass,
                decisionReason: artifact.decisionReason,
                violationStatus: artifact.violationStatus,
                statusCode: artifact.statusCode
            }
        }
    });
}
function readOptionValue(argv, flag) {
    const index = argv.indexOf(flag);
    if (index < 0) {
        return undefined;
    }
    return argv[index + 1];
}
function readOptionValues(argv, flag) {
    const values = [];
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] !== flag)
            continue;
        const value = argv[index + 1];
        if (!value || value.startsWith('--'))
            continue;
        values.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
    }
    return [...new Set(values)];
}
function normalizeBrokerDecisionClass(value) {
    const normalized = value?.trim();
    if (normalized === 'serial-release'
        || normalized === 'human-signoff-required'
        || normalized === 'adr-required'
        || normalized === 'blocked') {
        return normalized;
    }
    return 'serial-release';
}
function normalizeBrokerViolationStatus(value) {
    const normalized = value?.trim();
    if (normalized === 'broker-conflict-blocked'
        || normalized === 'resolution-issued'
        || normalized === 'resolved') {
        return normalized;
    }
    return 'broker-conflict-blocked';
}
export function buildTeamRuntimeContract(input) {
    const runtimeMode = normalizeTeamRuntimeMode(input.runtimeMode);
    const runtimeLanguage = normalizeOptionalRuntimeString(input.runtimeLanguage) ?? 'node';
    const runtimeAdapterId = normalizeOptionalRuntimeString(input.runtimeAdapterId);
    const providerId = normalizeOptionalRuntimeString(input.providerId);
    const sdkId = normalizeOptionalRuntimeString(input.sdkId);
    const modelId = normalizeOptionalRuntimeString(input.modelId);
    const roleName = normalizeOptionalRuntimeString(input.roleName) ?? 'coordinator';
    const selectionDecision = input.selectionConfig
        ? resolveTeamProviderSelection(roleName, input.selectionConfig)
        : null;
    const selectionIsRoleOverride = selectionDecision?.source === 'role-override'
        || selectionDecision?.source === 'cli-role-override';
    const effectiveRuntimeMode = selectionIsRoleOverride
        ? selectionDecision.runtimeMode
        : normalizeOptionalRuntimeString(input.runtimeMode)
            ? runtimeMode
            : selectionDecision?.runtimeMode ?? runtimeMode;
    const effectiveProviderId = selectionIsRoleOverride
        ? selectionDecision.providerId
        : providerId ?? selectionDecision?.providerId;
    const effectiveSdkId = selectionIsRoleOverride
        ? selectionDecision.sdkId
        : sdkId ?? selectionDecision?.sdkId;
    const effectiveModelId = selectionIsRoleOverride
        ? selectionDecision.modelId
        : modelId ?? selectionDecision?.modelId;
    const editorBridgeDisabled = Boolean(input.editorBridgeDisabled);
    const workerAdapter = resolveNodejsTeamWorkerAdapter({
        runtimeMode: effectiveRuntimeMode,
        runtimeLanguage,
        runtimeAdapterId,
        providerId: effectiveProviderId,
        sdkId: effectiveSdkId,
        modelId: effectiveModelId
    });
    const agentsSpawned = workerAdapter.agentsSpawned;
    const executionSurface = workerAdapter.executionSurface;
    return {
        schemaId: 'atm.teamRuntimeContract.v1',
        runtimeMode: effectiveRuntimeMode,
        runtimeLanguage,
        runtimeAdapterId: runtimeAdapterId ?? workerAdapter.adapterId,
        providerId: effectiveProviderId ?? workerAdapter.providerId,
        sdkId: effectiveSdkId ?? workerAdapter.sdkId,
        modelId: effectiveModelId ?? workerAdapter.modelId,
        agentsSpawned,
        executionSurface,
        selectionReason: describeRuntimeSelection({
            runtimeMode: effectiveRuntimeMode,
            runtimeLanguage,
            runtimeAdapterId: runtimeAdapterId ?? workerAdapter.adapterId,
            selectionSource: selectionDecision?.source ?? null,
            roleName
        }),
        workerAdapter,
        artifactHandoff: buildTeamArtifactHandoffContract({
            recipe: input.recipe,
            requiredRoles: ['implementer', 'reviewer', 'validator', 'evidence-collector'],
            producedArtifacts: []
        }),
        retryBudget: buildTeamRetryBudgetContract({}),
        commitLane: buildTeamCommitLaneContract(),
        brokerSubagent: buildTeamBrokerSubagentContract(),
        editorSubagentBridge: buildEditorSubagentBridgeContract({
            enabled: runtimeMode === 'editor-subagent' && !editorBridgeDisabled,
            disabledReason: runtimeMode !== 'editor-subagent'
                ? 'runtime-mode-is-not-editor-subagent'
                : editorBridgeDisabled
                    ? 'disabled-by-run-option'
                    : null,
            recipe: input.recipe,
            allowedFiles: input.allowedFiles ?? [],
            permissionLeases: input.permissionLeases ?? [],
            evidenceRequired: String(input.evidenceRequired ?? 'command-backed')
        })
    };
}
function buildTeamBrokerSubagentContract() {
    return {
        schemaId: 'atm.teamBrokerSubagentContract.v1',
        enabled: true,
        subagentId: 'team-broker-subagent',
        lifecycleOwner: 'atm',
        decisionSurface: 'brokerLane',
        governs: ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane'],
        stewardId: 'neutral-write-steward',
        evidenceRequired: ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1'],
        authorityBoundary: {
            fileWrite: false,
            gitWrite: false,
            taskLifecycle: false,
            selfClose: false
        },
        escalationTarget: 'coordinator'
    };
}
function buildTeamCommitLaneContract() {
    return {
        schemaId: 'atm.teamCommitLaneContract.v1',
        ownerRole: 'coordinator',
        ownerPermissions: ['task.lifecycle', 'git.write', 'evidence.write'],
        workerGitWrite: false,
        serializedBy: 'branch-commit-queue',
        lockSchemaId: 'atm.branchCommitQueueLock.v1',
        retryableCodes: ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE']
    };
}
export function buildTeamClosureAttestation(input) {
    const runtime = input.runtimeContract ?? null;
    const runtimeMode = normalizeTeamRuntimeMode(input.runtimeMode ?? runtime?.runtimeMode);
    const runtimeLanguage = normalizeOptionalRuntimeString(input.runtimeLanguage ?? runtime?.runtimeLanguage) ?? 'node';
    const runtimeAdapterId = normalizeOptionalRuntimeString(input.runtimeAdapterId ?? runtime?.runtimeAdapterId);
    const providerId = normalizeOptionalRuntimeString(input.providerId ?? runtime?.providerId);
    const sdkId = normalizeOptionalRuntimeString(input.sdkId ?? runtime?.sdkId);
    const modelId = normalizeOptionalRuntimeString(input.modelId ?? runtime?.modelId);
    const runnerKind = normalizeOptionalRuntimeString(input.runnerKind) ?? (runtime?.agentsSpawned ? 'team-agent-runtime' : 'broker-governance');
    const sandboxPolicyHash = normalizeOptionalRuntimeString(input.sandboxPolicyHash)
        ?? createHash('sha256')
            .update([
            'local-runtime-wrapper-is-not-secure-sandbox-proof',
            runtimeMode,
            runtimeLanguage,
            runtimeAdapterId ?? '',
            providerId ?? '',
            sdkId ?? '',
            modelId ?? ''
        ].join('\n'))
            .digest('hex');
    return {
        schemaId: TEAM_CLOSURE_ATTESTATION_SCHEMA_ID,
        teamRunId: normalizeOptionalRuntimeString(input.teamRunId) ?? 'manual-team-run',
        runtimeMode,
        runtimeLanguage,
        runtimeAdapterId,
        providerId,
        sdkId,
        modelId,
        runnerKind,
        runtimeVersion: normalizeOptionalRuntimeString(input.runtimeVersion),
        sandboxPolicyHash: `sha256:${sandboxPolicyHash.replace(/^sha256:/, '')}`,
        attestationSigner: normalizeOptionalRuntimeString(input.attestationSigner) ?? 'coordinator',
        brokerSubagent: buildBrokerSubagentAttestation(runtime?.brokerSubagent),
        commitLane: buildCommitLaneAttestation(runtime?.commitLane),
        workerAuthorityBoundary: buildWorkerAuthorityBoundaryAttestation(runtime?.workerAdapter),
        reviewerIndependence: buildReviewerIndependenceAttestation(input.reviewerIndependence),
        attestedAt: normalizeOptionalRuntimeString(input.attestedAt) ?? new Date().toISOString(),
        localRuntimeWrapperIsSecureSandboxProof: false,
        commandBackedEvidenceRequired: true
    };
}
function buildBrokerSubagentAttestation(input) {
    const boundary = (input?.authorityBoundary ?? {});
    return {
        schemaId: normalizeOptionalRuntimeString(input?.schemaId),
        enabled: input?.enabled === true,
        subagentId: normalizeOptionalRuntimeString(input?.subagentId),
        decisionSurface: normalizeOptionalRuntimeString(input?.decisionSurface),
        stewardId: normalizeOptionalRuntimeString(input?.stewardId),
        governs: normalizeStringArray(input?.governs),
        evidenceRequired: normalizeStringArray(input?.evidenceRequired),
        authorityBoundary: {
            fileWrite: boundary?.fileWrite === true,
            gitWrite: boundary?.gitWrite === true,
            taskLifecycle: boundary?.taskLifecycle === true,
            selfClose: boundary?.selfClose === true
        }
    };
}
function buildCommitLaneAttestation(input) {
    const lane = (input ?? {});
    return {
        schemaId: normalizeOptionalRuntimeString(input?.schemaId),
        serializedBy: normalizeOptionalRuntimeString(input?.serializedBy),
        ownerRole: normalizeOptionalRuntimeString(input?.ownerRole),
        workerGitWrite: lane.workerGitWrite === true
    };
}
function buildWorkerAuthorityBoundaryAttestation(input) {
    const boundary = (input?.authorityBoundary ?? {});
    return {
        gitWrite: boundary.gitWrite === true,
        taskLifecycle: boundary.taskLifecycle === true,
        selfClose: boundary.selfClose === true,
        evidenceWriteOwner: normalizeOptionalRuntimeString(boundary?.evidenceWriteOwner)
    };
}
function buildReviewerIndependenceAttestation(input) {
    const required = input?.required !== false;
    const satisfied = input?.satisfied === true;
    return {
        required,
        satisfied,
        policy: normalizeOptionalRuntimeString(input?.policy) ?? 'reviewer-runtime-and-model-independent-from-implementer-when-required',
        reviewerProviderId: normalizeOptionalRuntimeString(input?.reviewerProviderId),
        reviewerModelId: normalizeOptionalRuntimeString(input?.reviewerModelId),
        reviewerRuntimeAdapterId: normalizeOptionalRuntimeString(input?.reviewerRuntimeAdapterId),
        reason: normalizeOptionalRuntimeString(input?.reason) ?? (satisfied ? 'reviewer independence policy satisfied' : 'reviewer independence policy unsatisfied')
    };
}
export function buildTeamArtifactHandoffContract(input) {
    const requiredRoles = uniqueStrings((input.requiredRoles ?? ['implementer', 'reviewer', 'validator', 'evidence-collector'])
        .map((entry) => String(entry).trim())
        .filter(Boolean));
    const recipeAgents = input.recipe?.agents ?? [];
    const roleContracts = requiredRoles.map((role) => {
        const agent = recipeAgents.find((entry) => entry.role === role);
        return buildTeamRoleArtifactContract({
            agentId: agent?.agentId ?? role,
            role
        });
    });
    const findings = validateTeamArtifactHandoff({
        roleContracts,
        producedArtifacts: input.producedArtifacts ?? []
    });
    return {
        schemaId: 'atm.teamArtifactHandoffContract.v1',
        requiredRoles,
        roleContracts,
        findings,
        closeAllowed: findings.every((finding) => !finding.blocking)
    };
}
export function validateTeamArtifactHandoff(input) {
    const producedArtifacts = new Set((input.producedArtifacts ?? []).map((entry) => normalizeArtifactName(entry)).filter(Boolean));
    const findings = [];
    for (const contract of input.roleContracts) {
        for (const artifact of contract.requiredArtifacts) {
            const normalizedArtifact = normalizeArtifactName(artifact);
            if (!producedArtifacts.has(normalizedArtifact)) {
                findings.push({
                    level: 'error',
                    code: 'missing-required-artifact',
                    role: contract.role,
                    agentId: contract.agentId,
                    artifact,
                    blocking: true,
                    summary: `${contract.role} requires artifact '${artifact}' before close.`
                });
            }
        }
    }
    return findings;
}
export function buildTeamRetryBudgetContract(input) {
    const maxReworkCycles = normalizeRetryBudget(input.maxReworkCycles, 1);
    const maxValidatorReruns = normalizeRetryBudget(input.maxValidatorReruns, 1);
    const maxReviewerReturns = normalizeRetryBudget(input.maxReviewerReturns, 1);
    const usedReworkCycles = normalizeRetryBudget(input.usedReworkCycles, 0);
    const usedValidatorReruns = normalizeRetryBudget(input.usedValidatorReruns, 0);
    const usedReviewerReturns = normalizeRetryBudget(input.usedReviewerReturns, 0);
    const exhausted = usedReworkCycles >= maxReworkCycles
        || usedValidatorReruns >= maxValidatorReruns
        || usedReviewerReturns >= maxReviewerReturns;
    const escalationTarget = normalizeOptionalRuntimeString(input.escalationTarget) ?? 'captain';
    return {
        schemaId: 'atm.teamRetryBudgetContract.v1',
        maxReworkCycles,
        maxValidatorReruns,
        maxReviewerReturns,
        usedReworkCycles,
        usedValidatorReruns,
        usedReviewerReturns,
        exhausted,
        escalationTarget: exhausted ? escalationTarget : null,
        status: exhausted ? 'escalation-required' : 'within-budget'
    };
}
export function buildTeamReworkRouteStateMachine(input) {
    const maxAttempts = normalizeRetryBudget(input.retryBudgetMax, 1);
    const used = normalizeRetryBudget(input.retryBudgetUsed, 0);
    const remaining = Math.max(0, maxAttempts - used);
    const findings = normalizeTeamReworkFindings(input.findings ?? []);
    const requiredChecksPassed = input.requiredChecksPassed === true;
    const startingStatus = input.previousStatus ?? 'work-in-progress';
    const blockingReviewerFindings = findings.filter((finding) => finding.source === 'reviewer' && isBlockingReworkFinding(finding));
    const failedValidatorFindings = findings.filter((finding) => finding.source === 'validator' && finding.passed === false);
    const blockingFindings = [...blockingReviewerFindings, ...failedValidatorFindings];
    const transitions = [];
    let status = startingStatus;
    if (blockingFindings.length > 0) {
        status = pushTeamReworkTransition({
            transitions,
            from: status,
            to: remaining <= 0 ? 'blocked' : 'needs-rework',
            reason: remaining <= 0
                ? 'retry budget exhausted while blocking reviewer or validator findings remain'
                : 'blocking reviewer or validator findings require implementation rework',
            findingIds: blockingFindings.map((finding) => finding.id)
        });
    }
    else if (status === 'needs-rework') {
        status = pushTeamReworkTransition({
            transitions,
            from: status,
            to: 'revalidate-pending',
            reason: 'rework completed; validation must rerun before close readiness',
            findingIds: []
        });
    }
    if ((status === 'work-in-progress' || status === 'revalidate-pending') && requiredChecksPassed) {
        status = pushTeamReworkTransition({
            transitions,
            from: status,
            to: 'ready-for-close',
            reason: 'required reviewer and validator checks passed',
            findingIds: []
        });
    }
    else if (status === 'revalidate-pending' && remaining <= 0) {
        status = pushTeamReworkTransition({
            transitions,
            from: status,
            to: 'escalated',
            reason: 'revalidation is pending but retry budget is exhausted',
            findingIds: []
        });
    }
    return {
        schemaId: 'atm.teamReworkRoute.v1',
        status,
        retryBudget: {
            maxAttempts,
            used,
            remaining,
            escalationTarget: remaining <= 0 ? 'captain' : null
        },
        requiredChecksPassed,
        findings,
        transitions
    };
}
function buildTeamRoleArtifactContract(input) {
    const role = input.role;
    if (role === 'implementer') {
        return {
            schemaId: 'atm.teamRoleArtifactContract.v1',
            agentId: input.agentId,
            role,
            consumesFrom: ['task-card', 'team-plan', 'scope-locks'],
            producesTo: ['reviewer', 'validator', 'evidence-collector'],
            requiredArtifacts: ['implementation-diff', 'implementation-notes']
        };
    }
    if (role === 'reviewer') {
        return {
            schemaId: 'atm.teamRoleArtifactContract.v1',
            agentId: input.agentId,
            role,
            consumesFrom: ['implementation-diff', 'implementation-notes'],
            producesTo: ['implementer', 'evidence-collector'],
            requiredArtifacts: ['review-findings']
        };
    }
    if (role === 'validator') {
        return {
            schemaId: 'atm.teamRoleArtifactContract.v1',
            agentId: input.agentId,
            role,
            consumesFrom: ['implementation-diff', 'validator-commands'],
            producesTo: ['evidence-collector'],
            requiredArtifacts: ['validator-results']
        };
    }
    if (role === 'evidence-collector') {
        return {
            schemaId: 'atm.teamRoleArtifactContract.v1',
            agentId: input.agentId,
            role,
            consumesFrom: ['review-findings', 'validator-results'],
            producesTo: ['closure-packet'],
            requiredArtifacts: ['command-backed-evidence', 'closure-packet']
        };
    }
    return {
        schemaId: 'atm.teamRoleArtifactContract.v1',
        agentId: input.agentId,
        role,
        consumesFrom: ['team-plan'],
        producesTo: ['team-summary'],
        requiredArtifacts: ['role-report']
    };
}
function normalizeArtifactName(value) {
    return String(value ?? '').trim().toLowerCase();
}
export function transitionTeamReworkRoute(current, input) {
    const next = buildTeamReworkRouteStateMachine({
        findings: input.findings ?? current.findings,
        requiredChecksPassed: input.requiredChecksPassed ?? current.requiredChecksPassed,
        retryBudgetMax: current.retryBudget.maxAttempts,
        retryBudgetUsed: input.retryBudgetUsed ?? current.retryBudget.used,
        previousStatus: current.status
    });
    return {
        ...next,
        transitions: [...current.transitions, ...next.transitions]
    };
}
function normalizeTeamReworkFindings(findings) {
    return findings.map((finding, index) => ({
        source: finding.source === 'validator' ? 'validator' : 'reviewer',
        id: String(finding.id || `${finding.source || 'finding'}-${index + 1}`),
        blocking: finding.blocking === true,
        passed: typeof finding.passed === 'boolean' ? finding.passed : undefined,
        severity: normalizeFindingSeverity(finding.severity),
        summary: typeof finding.summary === 'string' ? finding.summary : undefined
    }));
}
function normalizeFindingSeverity(value) {
    return value === 'info' || value === 'warning' || value === 'error' || value === 'blocker'
        ? value
        : undefined;
}
function isBlockingReworkFinding(finding) {
    return finding.blocking === true || finding.severity === 'error' || finding.severity === 'blocker';
}
function normalizeRetryBudget(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : fallback;
}
function pushTeamReworkTransition(input) {
    if (input.from !== input.to) {
        input.transitions.push({
            from: input.from,
            to: input.to,
            reason: input.reason,
            findingIds: input.findingIds
        });
    }
    return input.to;
}
function buildEditorSubagentBridgeContract(input) {
    const allowedFiles = uniqueStrings(input.allowedFiles.map((entry) => String(entry).trim()).filter(Boolean));
    const leasesByAgent = new Map();
    for (const lease of input.permissionLeases) {
        leasesByAgent.set(lease.agentId, [...(leasesByAgent.get(lease.agentId) ?? []), {
                permission: lease.permission,
                agentId: lease.agentId,
                paths: lease.paths ? [...lease.paths] : undefined
            }]);
    }
    const roleEnvelopes = (input.recipe?.agents ?? []).map((agent) => {
        const permissionLeases = leasesByAgent.get(agent.agentId) ?? [];
        const artifactContract = buildTeamRoleArtifactContract({
            agentId: agent.agentId,
            role: agent.role
        });
        return {
            schemaId: 'atm.teamEditorSubagentRoleEnvelope.v1',
            agentId: agent.agentId,
            role: agent.role,
            profile: agent.profile ?? null,
            language: agent.language ?? input.recipe?.language ?? null,
            permissions: [...agent.permissions],
            allowedFiles,
            leaseMetadata: {
                permissionLeases,
                leaseOwner: agent.agentId
            },
            artifactMetadata: {
                expectedReports: [
                    'agent report',
                    'validator evidence',
                    'team summary'
                ],
                evidenceRequired: input.evidenceRequired,
                consumesFrom: artifactContract.consumesFrom,
                producesTo: artifactContract.producesTo,
                requiredArtifacts: artifactContract.requiredArtifacts
            },
            retryMetadata: {
                retryPolicy: 'atm-governed',
                maxAttempts: 1
            }
        };
    });
    return {
        schemaId: 'atm.teamEditorSubagentBridgeContract.v1',
        enabled: input.enabled,
        lifecycleOwner: 'atm',
        disabledReason: input.disabledReason,
        editorNeutral: true,
        allowedFiles,
        roleEnvelopes
    };
}
function normalizeTeamRuntimeMode(value) {
    const normalized = String(value ?? 'broker-only').trim();
    if (normalized === 'real-agent' || normalized === 'editor-subagent' || normalized === 'broker-only') {
        return normalized;
    }
    throw new CliError('ATM_TEAM_RUNTIME_MODE_INVALID', `Unsupported team runtime mode: ${normalized}`, {
        exitCode: 2,
        details: { supportedModes: ['real-agent', 'editor-subagent', 'broker-only'] }
    });
}
function normalizeOptionalRuntimeString(value) {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : null;
}
function describeRuntimeSelection(input) {
    const adapter = input.runtimeAdapterId ?? 'no adapter override';
    const selectionSource = input.selectionSource
        ? `selection=${input.selectionSource}${input.roleName ? ` role=${input.roleName}` : ''}`
        : 'selection=explicit-runtime';
    if (input.runtimeMode === 'broker-only') {
        return `broker-only selected; no agents are spawned, language=${input.runtimeLanguage}, ${adapter}, ${selectionSource}`;
    }
    if (input.runtimeMode === 'editor-subagent') {
        return `editor-subagent selected; adapter metadata is advisory, language=${input.runtimeLanguage}, ${adapter}, ${selectionSource}`;
    }
    return `real-agent selected; adapter metadata is advisory until a worker bridge consumes it, language=${input.runtimeLanguage}, ${adapter}, ${selectionSource}`;
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
    const writePaths = writeScope.writePaths;
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
        writePaths
    });
    const brokerLane = brokerLanePlan.evidence;
    const claimAdmissionFindings = buildTeamClaimAdmissionFindings(input.cwd, input.taskId, task);
    const validation = mergeValidation(permissionValidation, { ok: claimAdmissionFindings.every((f) => f.level !== 'error'), findings: claimAdmissionFindings }, { ok: parallelFindings.every((f) => f.level !== 'error'), findings: parallelFindings }, { ok: brokerLanePlan.findings.every((f) => f.level !== 'error'), findings: brokerLanePlan.findings });
    const finalTeamPlan = buildTeamPlan({
        task,
        recipe: activeRecipe,
        writePaths,
        validation,
        brokerLane,
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
function loadTeamProviderSelectionConfig(cwd, cliRoleOverrides) {
    const configPath = path.join(cwd, '.atm', 'config', 'team-provider-selection.json');
    const repoConfig = existsSync(configPath)
        ? readJsonFile(configPath, 'ATM_TEAM_PROVIDER_SELECTION_CONFIG_INVALID')
        : null;
    return {
        config: mergeTeamProviderSelectionConfig({
            repoConfig,
            cliRoleOverrides
        }),
        source: {
            schemaId: 'atm.teamAgentsConfig.v1',
            path: existsSync(configPath) ? path.relative(cwd, configPath).replace(/\\/g, '/') : null,
            loaded: existsSync(configPath),
            cliOverrideCount: cliRoleOverrides.length
        }
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
export function validateTeamPermissionModel(recipe, writePaths, options = {}) {
    const agentRoles = new Map(recipe.agents.map((agent) => [agent.agentId, agent.role]));
    return mergeValidation(validateTeamRecipe(recipe, agentRoles), validatePermissionLeases(buildSuggestedPermissionLeases(recipe, writePaths, options), agentRoles, options));
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
function normalizeTeamLeasePath(value, repoRoot) {
    const raw = String(value).trim();
    const repoRelative = normalizeRepoAbsoluteLeasePath(raw, repoRoot);
    const normalized = path.posix.normalize((repoRelative ?? raw).replace(/\\/g, '/'));
    return normalized === '.' ? '' : normalized.replace(/^\.\//, '');
}
function normalizeRepoAbsoluteLeasePath(rawPath, repoRoot) {
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
function deriveAllowedWriteScope(task, repoRoot) {
    const explicitAllowed = normalizeTaskPathArray(task?.targetAllowedFiles, repoRoot);
    if (explicitAllowed.length > 0) {
        return uniqueStrings(explicitAllowed);
    }
    return normalizeTaskWriteScope([
        ...normalizeTaskPathArray(task?.deliverables, repoRoot),
        ...normalizeTaskPathArray(task?.scopePaths, repoRoot)
    ], repoRoot);
}
function normalizeTaskWriteScope(paths, repoRoot) {
    return uniqueStrings(paths.map((entry) => normalizeTeamLeasePath(entry, repoRoot)).filter(Boolean));
}
function mergeValidation(...reports) {
    const findings = reports.flatMap((report) => report.findings);
    return {
        ok: findings.every((finding) => finding.level !== 'error'),
        findings
    };
}
function buildSuggestedPermissionLeases(recipe, writePaths, options = {}) {
    const coordinator = recipe.agents.find((agent) => agent.role === 'coordinator') ?? null;
    const fileWriteOwner = recipe.agents.find((agent) => agent.permissions.includes('file.write')) ?? null;
    return [
        ...(coordinator ? [
            { permission: 'task.lifecycle', agentId: coordinator.agentId },
            { permission: 'git.write', agentId: coordinator.agentId },
            { permission: 'evidence.write', agentId: coordinator.agentId }
        ] : []),
        ...(fileWriteOwner && (writePaths.length > 0 || !options.allowEmptyWriteScope) ? [{
                permission: 'file.write',
                agentId: fileWriteOwner.agentId,
                paths: writePaths
            }] : [])
    ];
}
export function buildTeamPlan(input) {
    const atomizationChecklist = buildAtomizationChecklist(input.task, input.writePaths);
    const crewBriefingContract = buildMinimalTaskCrewBriefingContract(input.task, input.writePaths, input.validation, input.brokerLane);
    const implementerSelector = selectTeamImplementer(input.task, input.recipe, input.writePaths);
    const captainDecision = buildCaptainDecision(input.task, input.writePaths, input.validation, input.brokerLane, crewBriefingContract, atomizationChecklist, implementerSelector, input.requestedTeamSize);
    const activeTeamLevel = captainDecision.teamLevel ?? mapTeamSizeToLevel(captainDecision.teamSize);
    const rosterProjection = projectTeamRecipeForLevel(input.recipe, activeTeamLevel);
    const activeRecipe = rosterProjection.recipe;
    const roleSkillPacks = buildTeamRoleSkillPackContract(activeRecipe);
    const roleSkillPackManifest = buildProviderNeutralRoleSkillPackManifest({
        recipe: activeRecipe,
        roleSkillPacks,
        selectionConfig: input.providerSelectionConfig ?? undefined
    });
    const routingMatrix = buildTeamRoleRoutingMatrix(roleSkillPacks);
    const growthContract = buildTeamGrowthContract();
    const observabilityContract = buildTeamObservabilityContract();
    const roleGrowthObservabilityContract = buildTeamRoleGrowthObservabilityContract({
        roleSkillPacks,
        growthContract
    });
    const runtimeTierContract = buildRuntimeTierContract(activeRecipe);
    const runtimePilot = buildTeamRuntimePilot({
        roleSkillPacks,
        routingMatrix,
        growthContract,
        validation: input.validation,
        brokerLane: input.brokerLane
    });
    const governanceRuntime = buildTeamGovernanceRuntimeFields({
        validation: input.validation,
        brokerLane: input.brokerLane,
        runtimePilot,
        captainDecision
    });
    return {
        schemaId: 'atm.teamPlan.v1',
        recipeId: activeRecipe.recipeId,
        channelHint: 'normal',
        teamLevel: activeTeamLevel,
        rosterProjection: rosterProjection.projection,
        governanceRuntime,
        decisionClass: governanceRuntime.decisionClass,
        decisionReason: governanceRuntime.decisionReason,
        requiresHumanSignoff: governanceRuntime.requiresHumanSignoff,
        requiresAdr: governanceRuntime.requiresAdr,
        violationStatus: governanceRuntime.violationStatus,
        escalationTarget: governanceRuntime.escalationTarget,
        providerSelectionSource: input.providerSelectionSource ?? null,
        brokerLane: input.brokerLane,
        agents: activeRecipe.agents,
        captainDecision,
        implementerSelector,
        roleSkillPacks,
        roleSkillPackManifest,
        routingMatrix,
        growthContract,
        observabilityContract,
        roleGrowthObservabilityContract,
        runtimeTierContract,
        openAIFamilyRuntimeBridges: buildOpenAIFamilyRuntimeBridgeSummary(),
        editorExecutionRuntimeBridges: buildEditorExecutionRuntimeBridgeSummary(),
        microsoftFoundryRuntimeBridges: buildMicrosoftFoundryRuntimeBridgeSummary(),
        anthropicRuntimeBridges: buildAnthropicRuntimeBridgeSummary(),
        runtimePilot,
        ...(input.knowledgeSummary ? { knowledgeSummary: input.knowledgeSummary } : {}),
        requiredRoles: crewBriefingContract.requiredRoles,
        optionalRoles: crewBriefingContract.optionalRoles,
        briefingContract: crewBriefingContract,
        atomizationPlannerRole: {
            role: 'atomizationPlanner',
            agentIds: input.recipe.agents.filter((agent) => agent.role === 'atomizationPlanner').map((agent) => agent.agentId),
            permissions: input.recipe.agents.find((agent) => agent.role === 'atomizationPlanner')?.permissions ?? []
        },
        atomizationChecklist,
        suggestedPermissionLeases: buildSuggestedPermissionLeases(input.recipe, input.writePaths, { allowEmptyWriteScope: input.allowEmptyWriteScope }),
        nextSteps: [
            'Review this dry-run plan.',
            'Run team start when you want a runtime team run record.',
            'Do not hand-edit .atm/runtime team state.'
        ],
        validation: input.validation
    };
}
export function buildOpenAIFamilyRuntimeBridgeSummary() {
    return {
        schemaId: 'atm.openAIFamilyRuntimeBridgeSummary.v1',
        milestone: 'M9I',
        providerIds: ['openai', 'azure-openai'],
        sharedProviderInterface: 'atm.teamProviderContract.v1',
        sharedArtifactType: 'atm.teamProviderRunArtifact.v1',
        observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
        coordinatorOwnedAuthority: true,
        brokerConflictVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        bridges: [
            buildOpenAITeamProviderBridgeDescriptor(),
            buildAzureOpenAITeamProviderBridgeDescriptor()
        ]
    };
}
export function buildEditorExecutionRuntimeBridgeSummary() {
    return {
        schemaId: 'atm.editorExecutionRuntimeBridgeSummary.v1',
        milestone: 'M9I',
        providerIds: ['claude-code', 'gemini'],
        sharedProviderInterface: 'atm.teamProviderContract.v1',
        sharedArtifactType: 'atm.teamProviderRunArtifact.v1',
        roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1',
        observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
        coordinatorOwnedAuthority: true,
        brokerConflictVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        bridges: [
            buildClaudeCodeTeamProviderBridgeDescriptor(),
            buildGeminiTeamProviderBridgeDescriptor()
        ]
    };
}
export function buildGeminiDirectRuntimeBridgeSummary() {
    return {
        schemaId: 'atm.geminiDirectRuntimeBridgeSummary.v1',
        providerIds: ['gemini-direct'],
        sharedProviderInterface: 'atm.teamProviderContract.v1',
        sharedArtifactType: 'atm.teamProviderRunArtifact.v1',
        coordinatorOwnedAuthority: true,
        bridge: buildGeminiDirectTeamProviderBridgeDescriptor()
    };
}
export function buildMicrosoftFoundryRuntimeBridgeSummary() {
    return {
        schemaId: 'atm.microsoftFoundryRuntimeBridgeSummary.v1',
        milestone: 'M9I',
        providerIds: ['microsoft-foundry'],
        sharedProviderInterface: 'atm.teamProviderContract.v1',
        sharedArtifactType: 'atm.teamProviderRunArtifact.v1',
        supportedSurfaces: ['project-chat-inference', 'agent-service'],
        observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
        coordinatorOwnedAuthority: true,
        brokerConflictVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        bridges: [
            buildMicrosoftFoundryTeamProviderBridgeDescriptor()
        ]
    };
}
export function buildAnthropicRuntimeBridgeSummary() {
    return {
        schemaId: 'atm.anthropicRuntimeBridgeSummary.v1',
        milestone: 'M10X',
        providerIds: ['anthropic'],
        sharedProviderInterface: 'atm.teamProviderContract.v1',
        sharedArtifactType: 'atm.teamProviderRunArtifact.v1',
        observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
        coordinatorOwnedAuthority: true,
        brokerConflictVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        bridges: [
            buildAnthropicTeamProviderBridgeDescriptor()
        ]
    };
}
export function buildTeamRoleSkillPackContract(recipe) {
    const rolePackDefaults = {
        coordinator: {
            skillPackId: 'atm.role-pack.coordinator',
            specialistSkills: ['atm-governance-router', 'atm-next', 'atm-handoff'],
            playbookSlice: 'route-claim-close-commit'
        },
        reader: {
            skillPackId: 'atm.role-pack.reader',
            specialistSkills: ['atm-orient'],
            playbookSlice: 'source-read-discovery'
        },
        scopeGuardian: {
            skillPackId: 'atm.role-pack.scope-guardian',
            specialistSkills: ['atm-lock'],
            playbookSlice: 'scope-preflight-boundary-watch'
        },
        implementer: {
            skillPackId: 'atm.role-pack.implementer',
            specialistSkills: ['atm-task-intent-resolver'],
            playbookSlice: 'scoped-delivery'
        },
        validator: {
            skillPackId: 'atm.role-pack.validator',
            specialistSkills: ['atm-evidence'],
            playbookSlice: 'validator-evidence-pass'
        },
        evidenceCollector: {
            skillPackId: 'atm.role-pack.evidence-collector',
            specialistSkills: ['atm-evidence', 'atm-handoff'],
            playbookSlice: 'evidence-summary-handoff'
        },
        atomizationPlanner: {
            skillPackId: 'atm.role-pack.atomization-planner',
            specialistSkills: ['atm-atom-map-refactor', 'atm-task-card-authoring'],
            playbookSlice: 'atomization-scope-shaping'
        },
        lieutenant: {
            skillPackId: 'atm.role-pack.lieutenant',
            specialistSkills: ['atm-dispatch', 'atm-lock'],
            playbookSlice: 'coordination-boundary-watch'
        },
        reviewAgent: {
            skillPackId: 'atm.role-pack.review-agent',
            specialistSkills: ['atm-evidence'],
            playbookSlice: 'review-signature-advisory'
        },
        knowledgeScout: {
            skillPackId: 'atm.role-pack.knowledge-scout',
            specialistSkills: ['atm-orient'],
            playbookSlice: 'knowledge-query-advisory'
        }
    };
    const coordinatorExclusive = ['task.lifecycle', 'git.write', 'evidence.write'];
    return {
        schemaId: 'atm.teamRoleSkillPackContract.v1',
        providerNeutral: true,
        coordinatorOwnsLifecycle: true,
        roles: recipe.agents.map((agent) => {
            const defaults = rolePackDefaults[agent.role] ?? {
                skillPackId: `atm.role-pack.${agent.role}`,
                specialistSkills: [],
                playbookSlice: 'specialist-advisory'
            };
            return {
                role: agent.role,
                agentId: agent.agentId,
                skillPackId: defaults.skillPackId,
                specialistSkills: defaults.specialistSkills,
                allowedPermissions: [...agent.permissions],
                forbiddenPermissions: agent.role === 'coordinator' ? [] : coordinatorExclusive,
                playbookSlice: defaults.playbookSlice,
                growthContractAttachment: 'shared-team-growth-contract'
            };
        })
    };
}
export function buildProviderNeutralRoleSkillPackManifest(input) {
    const roleSkillPacks = input.roleSkillPacks ?? buildTeamRoleSkillPackContract(input.recipe);
    const selectionConfig = input.selectionConfig ?? {
        repoDefault: {
            providerId: 'openai',
            sdkId: 'responses',
            modelId: 'gpt-5-mini',
            runtimeMode: 'broker-only'
        },
        roleOverrides: {}
    };
    const providerIds = uniqueStrings([...(input.providerIds ?? TEAM_PROVIDER_IDS)]);
    return {
        schemaId: 'atm.teamRoleSkillPackManifest.v1',
        providerNeutral: true,
        coordinatorOwnsLifecycle: true,
        discoveryMode: 'capability-driven',
        roleFirstProviderSecond: true,
        sharedVocabulary: {
            brokerConflict: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked']
        },
        roles: roleSkillPacks.roles.map((entry) => {
            const selection = resolveTeamProviderSelection(entry.role, selectionConfig);
            return {
                role: entry.role,
                skillPackId: entry.skillPackId,
                playbookSlice: entry.playbookSlice,
                capabilityTags: capabilityTagsForRole(entry.role),
                permissionLease: {
                    alignment: 'role-first',
                    allowedPermissions: entry.allowedPermissions,
                    forbiddenPermissions: entry.forbiddenPermissions
                },
                selectedProvider: {
                    providerId: selection.providerId,
                    sdkId: selection.sdkId,
                    modelId: selection.modelId,
                    runtimeMode: selection.runtimeMode,
                    source: selection.source
                },
                providerCapabilities: providerIds.map((providerId) => ({
                    providerId,
                    runtimeModes: ['real-agent', 'editor-subagent', 'broker-only'],
                    artifacts: artifactsForRole(entry.role),
                    satisfiesRolePack: true,
                    reason: `${providerId} can satisfy ${entry.skillPackId} through role-first permission leases and ${entry.playbookSlice}.`
                })),
                growthContractAttachment: entry.growthContractAttachment
            };
        })
    };
}
export function buildTeamRoleRoutingMatrix(roleSkillPacks) {
    const hasRole = (role) => roleSkillPacks.roles.some((entry) => entry.role === role);
    const maybe = (role) => hasRole(role) ? [role] : [];
    const route = (input) => ({
        workstream: input.workstream,
        primaryRole: input.primaryRole,
        supportingRoles: input.supportingRoles ?? [],
        advisoryRoles: input.advisoryRoles ?? [],
        roleOrder: input.roleOrder,
        parallelSafeRoles: input.parallelSafeRoles ?? [],
        advisoryOnlyRoles: input.advisoryOnlyRoles ?? input.advisoryRoles ?? [],
        playbookSlice: input.playbookSlice,
        lifecycleOwner: 'coordinator',
        stopConditions: input.stopConditions ?? [
            'broker-conflict-blocked',
            'blocked-active-lease',
            'proposal-submitted'
        ]
    });
    return {
        schemaId: 'atm.teamRoleRoutingMatrix.v1',
        providerNeutral: true,
        coordinatorOwnsLifecycle: true,
        routes: [
            route({
                workstream: 'task-entry-routing',
                primaryRole: 'coordinator',
                supportingRoles: [...maybe('reader'), ...maybe('scopeGuardian')],
                advisoryRoles: [...maybe('evidenceCollector')],
                roleOrder: ['coordinator', ...maybe('scopeGuardian'), ...maybe('reader'), ...maybe('evidenceCollector')],
                parallelSafeRoles: [...maybe('reader'), ...maybe('evidenceCollector')],
                playbookSlice: 'route-claim-close-commit'
            }),
            route({
                workstream: 'scoped-implementation',
                primaryRole: hasRole('implementer') ? 'implementer' : 'coordinator',
                supportingRoles: [...maybe('scopeGuardian')],
                advisoryRoles: [...maybe('reader')],
                roleOrder: ['coordinator', ...maybe('scopeGuardian'), hasRole('implementer') ? 'implementer' : 'coordinator', ...maybe('reader')],
                parallelSafeRoles: [...maybe('scopeGuardian'), ...maybe('reader')],
                playbookSlice: 'scoped-delivery'
            }),
            route({
                workstream: 'validation-and-evidence',
                primaryRole: hasRole('validator') ? 'validator' : 'coordinator',
                supportingRoles: [...maybe('evidenceCollector')],
                advisoryRoles: [...maybe('reader')],
                roleOrder: ['coordinator', hasRole('validator') ? 'validator' : 'coordinator', ...maybe('evidenceCollector'), ...maybe('reader')],
                parallelSafeRoles: [...maybe('evidenceCollector'), ...maybe('reader')],
                playbookSlice: 'validator-evidence-pass'
            }),
            route({
                workstream: 'broker-conflict-resolution',
                primaryRole: 'coordinator',
                supportingRoles: [...maybe('scopeGuardian')],
                advisoryRoles: [...maybe('reader'), ...maybe('evidenceCollector')],
                roleOrder: ['coordinator', ...maybe('scopeGuardian'), ...maybe('reader'), ...maybe('evidenceCollector')],
                parallelSafeRoles: [...maybe('reader'), ...maybe('evidenceCollector')],
                playbookSlice: 'broker-conflict-resolution',
                stopConditions: [
                    'broker-conflict-blocked',
                    'missing-atm.brokerConflictResolution.v1',
                    'manual-runtime-edit-requested'
                ]
            })
        ]
    };
}
function capabilityTagsForRole(role) {
    const normalized = role.toLowerCase();
    if (normalized === 'coordinator')
        return ['task-routing', 'lifecycle-authority', 'closeout-sequencing'];
    if (normalized.includes('scope'))
        return ['scope-boundary', 'broker-preflight', 'lease-watch'];
    if (normalized.includes('implementer'))
        return ['scoped-delivery', 'bounded-file-write'];
    if (normalized.includes('validator'))
        return ['validator-run', 'failure-interpretation'];
    if (normalized.includes('evidence'))
        return ['evidence-packaging', 'closure-readiness'];
    if (normalized.includes('knowledge'))
        return ['knowledge-query', 'shared-growth-context'];
    if (normalized.includes('steward'))
        return ['broker-authorized-apply', 'bounded-merge-plan'];
    return ['specialist-advisory'];
}
function artifactsForRole(role) {
    const normalized = role.toLowerCase();
    if (normalized === 'coordinator')
        return ['captain-decision', 'team-brief', 'handoff'];
    if (normalized.includes('validator'))
        return ['validator-report'];
    if (normalized.includes('evidence'))
        return ['evidence-summary'];
    if (normalized.includes('implementer'))
        return ['agent-report', 'patch-summary'];
    if (normalized.includes('scope'))
        return ['scope-report'];
    if (normalized.includes('knowledge'))
        return ['knowledge-summary'];
    if (normalized.includes('steward'))
        return ['broker-apply-report'];
    return ['agent-report'];
}
export function buildTeamGrowthContract() {
    return {
        schemaId: 'atm.teamGrowthContract.v1',
        sharedAcrossRolePacks: true,
        taxonomy: [
            'entry-friction',
            'route-confusion',
            'boundary-confusion',
            'fallback-misuse',
            'validator-gap',
            'tooling-mismatch',
            'overloaded-context',
            'shared-atm-routing-friction',
            'role-specific-friction'
        ],
        captureTemplate: [
            'Trigger',
            'Symptom',
            'Correct route',
            'Durable rule',
            'Promotion target',
            'Reuse scope'
        ],
        promotionPolicy: {
            stableRuleTarget: 'SKILL.md',
            rawCaseTarget: 'docs/governance/team-agents/role-pack-learning-loop.md'
        }
    };
}
export function buildTeamRoleGrowthObservabilityContract(input) {
    const growthContract = input.growthContract ?? buildTeamGrowthContract();
    const learningReference = growthContract.promotionPolicy.rawCaseTarget;
    return {
        schemaId: 'atm.teamRoleGrowthObservabilityContract.v1',
        sharedAcrossRolePacks: true,
        referenceFirst: true,
        sourceGrowthContract: 'atm.teamGrowthContract.v1',
        sourceObservabilityContract: 'atm.teamAgentObservabilityContract.v1',
        learningEventProjection: {
            eventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
            eventType: 'artifact.output',
            artifactType: 'atm.teamRoleGrowthLearningItem.v1',
            queryKeys: ['taskId', 'teamRunId', 'providerId', 'role', 'artifactType', 'eventType'],
            artifactFields: [
                'Category',
                'Trigger',
                'Symptom',
                'Correct route',
                'Durable rule',
                'Promotion target',
                'Confidence',
                'Reuse scope'
            ]
        },
        frictionClassification: {
            sharedAtmRoutingFriction: [
                'entry-friction',
                'route-confusion',
                'fallback-misuse',
                'tooling-mismatch',
                'shared-atm-routing-friction'
            ],
            roleSpecificFriction: [
                'boundary-confusion',
                'validator-gap',
                'overloaded-context',
                'role-specific-friction'
            ]
        },
        roleMappings: input.roleSkillPacks.roles.map((entry) => ({
            role: entry.role,
            agentId: entry.agentId,
            skillPackId: entry.skillPackId,
            playbookSlice: entry.playbookSlice,
            growthAttachmentPoint: entry.growthContractAttachment,
            learningReference,
            taxonomy: growthContract.taxonomy,
            observableEventSelector: {
                role: entry.role,
                eventType: 'artifact.output',
                artifactType: 'atm.teamRoleGrowthLearningItem.v1'
            }
        })),
        metrics: [
            {
                metricId: 'role-growth.learning-events.by-role',
                description: 'Counts reference-first role learning artifacts by role and skill pack.',
                numerator: {
                    eventType: 'artifact.output',
                    artifactType: 'atm.teamRoleGrowthLearningItem.v1'
                },
                denominator: {
                    eventType: 'artifact.output',
                    artifactType: 'atm.teamRoleGrowthLearningItem.v1'
                },
                groupedBy: ['role', 'skillPackId', 'playbookSlice']
            },
            {
                metricId: 'role-growth.role-specific-friction.rate',
                description: 'Separates role-boundary friction from shared ATM routing friction.',
                numerator: {
                    category: 'role-specific-friction'
                },
                denominator: {
                    artifactType: 'atm.teamRoleGrowthLearningItem.v1'
                },
                groupedBy: ['role', 'skillPackId']
            },
            {
                metricId: 'broker-conflict-blocked.hit-rate',
                description: 'Tracks how often Team role growth observes the M8E broker-conflict-blocked state.',
                numerator: {
                    violationStatus: 'broker-conflict-blocked'
                },
                denominator: {
                    eventType: 'broker.conflict.blocked'
                },
                groupedBy: ['role', 'taskId', 'decisionClass']
            }
        ],
        brokerConflictVocabulary: {
            decisionClass: 'decisionClass',
            decisionReason: 'decisionReason',
            violationStatus: 'violationStatus',
            blockedCode: 'broker-conflict-blocked'
        }
    };
}
function buildRuntimeTierContract(recipe) {
    return {
        schemaId: 'atm.teamRuntimeTierContract.v1',
        tiers: ['raw-api', 'agent-sdk', 'editor'],
        providerContractCompatibility: ['RawChatAdapter', 'AgentLoopAdapter', 'EditorAgentAdapter'],
        roleTiers: recipe.agents.map((agent) => {
            const tier = recommendRuntimeTier(agent.role);
            return {
                role: agent.role,
                agentId: agent.agentId,
                runtimeTier: tier,
                rationale: runtimeTierRationale(agent.role, tier)
            };
        })
    };
}
function recommendRuntimeTier(role) {
    if (['reader', 'validator', 'knowledgeScout', 'reviewAgent', 'evidenceCollector'].includes(role))
        return 'raw-api';
    if (['implementer', 'coordinator'].includes(role))
        return 'agent-sdk';
    if (role === 'lieutenant' || role === 'scopeGuardian' || role === 'atomizationPlanner')
        return 'editor';
    return 'raw-api';
}
function runtimeTierRationale(role, tier) {
    if (tier === 'raw-api')
        return `${role} is advisory/read-heavy and should prefer direct low-state API calls.`;
    if (tier === 'agent-sdk')
        return `${role} may need tool-loop orchestration while preserving Coordinator-owned lifecycle.`;
    return `${role} benefits from editor context but remains bounded by Team permission leases.`;
}
export function buildTeamRuntimePilot(input) {
    const orderedRoles = ['coordinator', 'implementer', 'validator'];
    const selectedRoles = orderedRoles.filter((role) => input.roleSkillPacks.roles.some((entry) => entry.role === role));
    const pilotRoles = selectedRoles.length >= 3 ? selectedRoles.slice(0, 3) : selectedRoles.slice(0, 2);
    const selectedEntries = input.roleSkillPacks.roles.filter((entry) => pilotRoles.includes(entry.role));
    const blockedByBroker = input.brokerLane.safeToStart === false;
    const brokerViolationStatus = blockedByBroker
        ? input.brokerLane.decision.admission?.state === 'proposal-submitted'
            ? 'proposal-submitted'
            : 'broker-conflict-blocked'
        : 'none';
    const brokerConflictVocabulary = {
        decisionClass: blockedByBroker ? 'blocked' : 'auto-execution',
        decisionReason: input.brokerLane.blockedReasons[0] ?? input.brokerLane.decision.reason ?? 'Team Broker allowed the runtime pilot lane.',
        violationStatus: blockedByBroker
            ? brokerViolationStatus === 'proposal-submitted'
                ? 'proposal-submitted'
                : 'broker-conflict-blocked'
            : 'none',
        blockedCode: blockedByBroker && brokerViolationStatus !== 'proposal-submitted' ? 'broker-conflict-blocked' : null
    };
    const actionableRefinementFindings = [
        ...input.validation.findings.map((finding) => ({
            category: classifyTeamPilotFinding(finding.code),
            summary: finding.summary,
            detail: finding.detail,
            correctRoute: 'Keep Coordinator authority primary, resolve lease or scope blockers first, then rerun team validate or team start.',
            promotionTarget: input.growthContract.promotionPolicy.rawCaseTarget
        })),
        ...normalizeTeamBrokerPilotFindings(input.brokerLane, input.growthContract.promotionPolicy.rawCaseTarget)
    ];
    return {
        schemaId: 'atm.teamRuntimePilot.v1',
        providerNeutral: true,
        coordinatorOwnsLifecycle: true,
        pilotMode: pilotRoles.length >= 3 ? 'role-trio' : 'role-pair',
        selectedRoles: pilotRoles,
        selectedSkillPackIds: selectedEntries.map((entry) => entry.skillPackId),
        agentSkillUnits: selectedEntries.map((entry) => ({
            role: entry.role,
            agentId: entry.agentId,
            skillPackId: entry.skillPackId,
            boundedSkillPackLoaded: true,
            permissionLease: {
                allowedPermissions: entry.allowedPermissions,
                forbiddenPermissions: entry.forbiddenPermissions
            },
            playbookSlice: entry.playbookSlice,
            lifecycleAuthority: entry.role === 'coordinator' ? 'coordinator-owned' : 'worker-forbidden'
        })),
        realisticWorkflow: [
            'Coordinator routes the task and remains the only lifecycle and git.write owner.',
            'Implementer loads only the scoped delivery pack for the active workstream.',
            'Validator loads only validator-evidence guidance and returns findings to Coordinator.'
        ],
        workflowEvidence: {
            scenarioId: 'agent-plus-skill-runtime-pilot',
            roleOrder: input.routingMatrix.routes.find((route) => route.workstream === 'scoped-implementation')?.roleOrder ?? pilotRoles,
            coordinatorOnlyLifecyclePreserved: true,
            workerWriteScope: 'bounded-by-task-lease',
            blockedByBroker,
            brokerViolationStatus
        },
        roleBoundarySignals: [
            ...selectedEntries.map((entry) => `${entry.role} -> ${entry.playbookSlice}`),
            ...input.routingMatrix.routes
                .filter((route) => ['task-entry-routing', 'scoped-implementation', 'validation-and-evidence'].includes(route.workstream))
                .map((route) => `${route.workstream}: ${route.primaryRole}`)
        ],
        lifecycleAuthority: {
            ownerRole: 'coordinator',
            forbiddenToWorkers: ['task.lifecycle', 'git.write', 'self-close']
        },
        roleConfusionReduction: [
            'Each pilot role loads only its bounded skill pack instead of a monolithic governance skill.',
            'Workers return findings or diffs to Coordinator instead of widening into closeout authority.',
            'Growth lessons land in a shared taxonomy without contaminating unrelated role packs.'
        ],
        roleConfusionMetrics: {
            baselineLoadedSkillPacks: 'monolithic-team-context',
            pilotLoadedSkillPacks: selectedEntries.map((entry) => entry.skillPackId),
            preventedPermissionDrift: uniqueStrings(selectedEntries.flatMap((entry) => entry.forbiddenPermissions)),
            refinementSignalCount: actionableRefinementFindings.length
        },
        roleGrowthObservability: {
            contractSchemaId: 'atm.teamRoleGrowthObservabilityContract.v1',
            eventType: 'artifact.output',
            artifactType: 'atm.teamRoleGrowthLearningItem.v1',
            frictionDimensions: ['shared-atm-routing-friction', 'role-specific-friction'],
            brokerConflictBlockedMetricId: 'broker-conflict-blocked.hit-rate',
            roleContractMappings: selectedEntries.map((entry) => ({
                role: entry.role,
                skillPackId: entry.skillPackId,
                playbookSlice: entry.playbookSlice
            }))
        },
        brokerConflictVocabulary,
        actionableRefinementFindings
    };
}
function buildTeamGovernanceRuntimeFields(input) {
    const blockingFinding = input.validation.findings.find((finding) => finding.level === 'error') ?? null;
    const blockedByBroker = input.runtimePilot.brokerConflictVocabulary.violationStatus === 'broker-conflict-blocked'
        || input.brokerLane.safeToStart === false;
    const brokerVerdict = String(input.brokerLane.decision.verdict ?? '');
    const escalationRequired = input.captainDecision.escalationRequired === true
        || brokerVerdict === 'needs-steward'
        || brokerVerdict === 'historical-delivery-required';
    const requiresAdr = brokerVerdict === 'needs-steward'
        || normalizeStringArray(input.brokerLane.blockedReasons).some((reason) => reason.toLowerCase().includes('adr'));
    const requiresHumanSignoff = escalationRequired || requiresAdr;
    const decisionClass = blockedByBroker || blockingFinding
        ? 'blocked'
        : requiresAdr
            ? 'adr-required'
            : requiresHumanSignoff
                ? 'human-signoff-required'
                : 'auto-execution';
    const decisionReason = blockingFinding?.summary
        ?? input.runtimePilot.brokerConflictVocabulary.decisionReason
        ?? input.captainDecision.reason;
    const violationStatus = blockedByBroker
        ? 'broker-conflict-blocked'
        : blockingFinding
            ? 'blocked'
            : requiresAdr
                ? 'adr-required'
                : requiresHumanSignoff
                    ? 'human-signoff-required'
                    : 'none';
    return {
        schemaId: 'atm.teamGovernanceRuntimeFields.v1',
        decisionClass,
        decisionReason,
        requiresHumanSignoff,
        requiresAdr,
        violationStatus,
        escalationTarget: requiresHumanSignoff
            ? (requiresAdr ? 'ADR + Captain review' : 'Captain / human review')
            : null
    };
}
export function evaluateReviewerIndependence(input) {
    const implementerFamily = normalizeModelFamily(input.implementer.modelId);
    const reviewerFamily = normalizeModelFamily(input.reviewer.modelId);
    const checks = {
        differentProvider: input.implementer.providerId !== input.reviewer.providerId,
        differentModelFamily: implementerFamily !== reviewerFamily,
        differentCertification: Boolean(input.implementer.modelCertificationId)
            && Boolean(input.reviewer.modelCertificationId)
            && input.implementer.modelCertificationId !== input.reviewer.modelCertificationId
    };
    const ok = input.policy === 'different-provider'
        ? checks.differentProvider
        : input.policy === 'different-model-family'
            ? checks.differentModelFamily
            : checks.differentCertification;
    return {
        schemaId: 'atm.reviewerIndependenceDecision.v1',
        ok,
        policy: input.policy,
        checks,
        reason: ok
            ? `Reviewer satisfies ${input.policy}.`
            : `Reviewer does not satisfy ${input.policy}; advisory note only.`
    };
}
export function buildReviewAgentSignature(input) {
    const independence = evaluateReviewerIndependence({
        implementer: input.implementer,
        reviewer: input.reviewer,
        policy: input.policy
    });
    const certificationPresent = Boolean(input.reviewer.modelCertificationId);
    const formal = independence.ok && certificationPresent;
    return {
        schemaId: 'atm.reviewAgentSignature.v1',
        taskId: input.taskId,
        signatureStatus: formal ? 'formal-signature' : 'advisory-note',
        permission: formal ? 'review.signature.write' : null,
        reviewer: {
            providerId: input.reviewer.providerId,
            modelId: input.reviewer.modelId,
            modelCertificationId: input.reviewer.modelCertificationId ?? null
        },
        implementer: {
            providerId: input.implementer.providerId,
            modelId: input.implementer.modelId,
            modelCertificationId: input.implementer.modelCertificationId ?? null
        },
        modelCertificationId: input.reviewer.modelCertificationId ?? null,
        reviewerIndependencePolicy: input.policy,
        independence,
        reviewedDiffHash: input.reviewedDiffHash,
        findings: [...(input.findings ?? [])],
        earlyWarning: classifyReviewEarlyWarnings(input.findings ?? [])
    };
}
export function evaluateReviewQuorum(input) {
    const formal = input.signatures.filter((signature) => signature.signatureStatus === 'formal-signature');
    const conflicts = detectReviewSignatureConflicts(input.signatures);
    const ok = formal.length >= input.requiredFormalSignatures && conflicts.length === 0;
    return {
        schemaId: 'atm.reviewQuorumDecision.v1',
        ok,
        requiredFormalSignatures: input.requiredFormalSignatures,
        formalSignatureCount: formal.length,
        advisoryNoteCount: input.signatures.length - formal.length,
        conflicts,
        escalationTarget: ok ? null : 'Coordinator/Captain/human review',
        reason: ok
            ? 'Review quorum satisfied.'
            : 'Review quorum insufficient or conflicting; formal signature is blocked but advisory notes remain usable.'
    };
}
function normalizeModelFamily(modelId) {
    return String(modelId ?? '').trim().toLowerCase().split(/[-_.:]/)[0] || 'unknown';
}
function classifyReviewEarlyWarnings(findings) {
    return findings.map((finding) => {
        const normalized = finding.toLowerCase();
        const category = normalized.includes('scope')
            ? 'scope-drift'
            : normalized.includes('test')
                ? 'missing-tests'
                : normalized.includes('contract')
                    ? 'consumer-contract'
                    : normalized.includes('rollback')
                        ? 'rollback-gap'
                        : 'review-note';
        return { category, finding };
    });
}
function detectReviewSignatureConflicts(signatures) {
    const findingSets = signatures.map((signature) => new Set(signature.findings.map((finding) => finding.toLowerCase())));
    const conflicts = [];
    for (let index = 1; index < findingSets.length; index += 1) {
        const previous = findingSets[index - 1];
        const current = findingSets[index];
        if (previous.has('approve') && current.has('block') || previous.has('block') && current.has('approve')) {
            conflicts.push(`reviewer-${index}-decision-conflict`);
        }
    }
    return conflicts;
}
function buildCaptainDecision(task, writePaths, validation, brokerLane, crewBriefingContract, atomizationChecklist, implementerSelector, requestedTeamSize) {
    const automaticSizing = decideTeamSizing(task, writePaths, validation, brokerLane);
    const manualSizing = normalizeTeamSizeOverride(requestedTeamSize);
    const sizing = manualSizing
        ? {
            teamSize: manualSizing.teamSize,
            confidence: 'high',
            reason: `Manual team size override ${manualSizing.teamLevel} selected by CLI/config.`
        }
        : automaticSizing;
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
        teamLevel: manualSizing?.teamLevel ?? mapTeamSizeToLevel(sizing.teamSize),
        teamLevelSource: manualSizing ? 'manual' : 'automatic',
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
function normalizeTeamSizeOverride(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized)
        return null;
    if (normalized === 'small' || normalized === 'l1')
        return { teamLevel: 'L1', teamSize: 'small' };
    if (normalized === 'medium' || normalized === 'normal' || normalized === 'l2')
        return { teamLevel: 'L2', teamSize: 'medium' };
    if (normalized === 'large' || normalized === 'l3')
        return { teamLevel: 'L3', teamSize: 'large' };
    if (normalized === 'l4')
        return { teamLevel: 'L4', teamSize: 'large' };
    if (normalized === 'l5')
        return { teamLevel: 'L5', teamSize: 'large' };
    throw new CliError('ATM_TEAM_SIZE_INVALID', `Unsupported team size override: ${value}`, {
        exitCode: 2,
        details: { supported: ['small', 'medium', 'large', 'L1', 'L2', 'L3', 'L4', 'L5'] }
    });
}
function mapTeamSizeToLevel(value) {
    const normalized = String(value ?? '').trim();
    if (normalized === 'large')
        return 'L3';
    if (normalized === 'medium')
        return 'L2';
    return 'L1';
}
function projectTeamRecipeForLevel(recipe, teamLevel) {
    const targetRoles = teamRosterLevelRoles[teamLevel];
    const agentsByRole = new Map(recipe.agents.map((agent) => [agent.role, agent]));
    const agents = targetRoles
        .map((role) => agentsByRole.get(role) ?? teamRosterSyntheticAgents[role] ?? null)
        .filter((agent) => agent !== null);
    const activeRoles = agents.map((agent) => agent.role);
    const deferredRoles = recipe.agents
        .map((agent) => agent.role)
        .filter((role) => !activeRoles.includes(role));
    const syntheticRoles = activeRoles.filter((role) => !recipe.agents.some((agent) => agent.role === role));
    return {
        recipe: {
            ...recipe,
            agents
        },
        projection: {
            schemaId: 'atm.teamRosterProjection.v1',
            teamLevel,
            teamSize: teamLevel === 'L1' ? 'small' : teamLevel === 'L2' ? 'medium' : 'large',
            activeRoles,
            syntheticRoles,
            deferredRoles,
            catalogReadyRosterDeferredRoles,
            roleRules: {
                L1: 'Core four: Coordinator, Atomization Planner, Implementer, Validator.',
                L2: 'Normal crew: L1 plus Reader and Evidence Collector.',
                L3: 'Large crew: L2 plus Scope Guardian.',
                L4: 'Escalated crew: L3 plus Lieutenant coordination boundary.',
                L5: 'Full advisory crew: L4 plus Review Agent and Knowledge Scout.'
            }
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
        ...normalizeTaskPathArray(task?.scopePaths),
        ...normalizeTaskPathArray(task?.targetAllowedFiles),
        ...writePaths
    ]);
    const deliverables = uniqueStrings(normalizeTaskPathArray(task?.deliverables));
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
        ...normalizeTaskPathArray(task?.scopePaths),
        ...normalizeTaskPathArray(task?.deliverables),
        ...normalizeTaskPathArray(task?.targetAllowedFiles)
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
        ...normalizeTaskPathArray(task?.scopePaths),
        ...normalizeTaskPathArray(task?.deliverables)
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
    const atomizationImpact = task?.atomizationImpact;
    const primaryAtom = String(atomizationImpact?.ownerAtomOrMap ?? atomizationImpact?.owner_atom_or_map ?? 'atm.team-agents-map');
    const taskAtomSet = getTaskScopedAtoms(taskId);
    const relatedAtoms = uniqueStrings([
        primaryAtom,
        ...taskAtomSet,
        ...normalizeStringArray(atomizationImpact?.mapUpdates ?? atomizationImpact?.map_updates).flatMap(normalizeAtomReference),
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
export async function runTeamProviderExecution(input) {
    if (input.runtimeContract.runtimeMode === 'broker-only') {
        return {
            requested: true,
            blockedReason: 'broker-only-runtime-never-spawns',
            results: []
        };
    }
    const selectedRoles = input.roleSelections.length > 0
        ? input.roleSelections
        : input.recipe.agents.map((agent) => ({
            role: agent.role,
            selectedProvider: {
                providerId: input.runtimeContract.providerId ?? '',
                sdkId: input.runtimeContract.sdkId ?? 'unknown-sdk',
                modelId: input.runtimeContract.modelId ?? 'unknown-model',
                runtimeMode: input.runtimeContract.runtimeMode
            }
        }));
    const localSecrets = loadTeamVendorLocalSecrets(input.cwd);
    const results = [];
    const priorRoleArtifacts = [];
    const handoffEvents = [];
    for (const [roleIndex, roleSelection] of selectedRoles.entries()) {
        const result = await runDirectTeamProviderRole({
            taskId: input.taskId,
            role: roleSelection.role,
            selection: roleSelection.selectedProvider,
            env: localSecrets.env,
            scopedPaths: input.scopedPaths,
            priorRoleArtifacts,
            executor: input.executor
        });
        if (result) {
            results.push(result);
            if (result.handoffArtifact && result.ok) {
                const next = selectedRoles[roleIndex + 1];
                const materialized = materializeTeamRoleHandoff({
                    cwd: input.cwd,
                    taskId: input.taskId,
                    teamRunId: input.teamRunId,
                    fromRole: result.handoffArtifact.role,
                    fromProviderId: result.handoffArtifact.providerId,
                    fromModelId: roleSelection.selectedProvider.modelId,
                    toRole: next?.role ?? 'coordinator',
                    toProviderId: next?.selectedProvider.providerId ?? null,
                    sourceArtifactId: result.sessionId,
                    redactedPreview: result.handoffArtifact.outputTextPreview,
                    leaseEpoch: roleIndex + 1
                });
                const integrity = verifyTeamHandoffLedger(input.cwd, input.taskId, input.teamRunId);
                if (!integrity.ok) {
                    throw new CliError('ATM_TEAM_HANDOFF_INTEGRITY_BLOCKED', `Team handoff integrity check failed: ${integrity.reason}.`, { exitCode: 1 });
                }
                priorRoleArtifacts.push({
                    role: materialized.artifact.from.role,
                    providerId: materialized.artifact.from.providerId,
                    outputTextPreview: materialized.artifact.humanSummary
                });
                handoffEvents.push(createTeamObservabilityEvent({
                    eventType: 'handoff.materialized',
                    taskId: input.taskId,
                    teamRunId: input.teamRunId,
                    providerId: normalizeTeamProviderId(materialized.artifact.from.providerId) ?? 'unknown',
                    role: materialized.artifact.from.role,
                    runtimeMode: input.runtimeContract.runtimeMode,
                    artifactType: materialized.artifact.schemaId,
                    artifactId: materialized.artifact.handoffId,
                    decisionClass: materialized.artifact.decision.decisionClass,
                    decisionReason: materialized.artifact.decision.decisionReason,
                    violationStatus: materialized.artifact.decision.violationStatus,
                    summary: `Handoff ${materialized.artifact.handoffId} materialized.`
                }));
            }
        }
    }
    appendTeamRuntimeObservabilityEvents(input.cwd, input.teamRunId, results.flatMap((result) => buildProviderOrchestrationEvents({
        taskId: input.taskId,
        teamRunId: input.teamRunId,
        runtimeMode: input.runtimeContract.runtimeMode,
        result
    })).concat(handoffEvents));
    return {
        requested: true,
        blockedReason: null,
        localSecrets: localSecrets.summary,
        results
    };
}
export const TEAM_HANDOFF_CONTEXT_PER_ARTIFACT_TOKENS = 256;
export const TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS = 4;
export const TEAM_HANDOFF_CONTEXT_TOTAL_TOKENS = 1024;
export function buildDirectTeamRoleInstructions(input) {
    const base = `Run Team role ${input.role} for ${input.taskId}. Return a concise role report. Do not close, commit, or exceed Coordinator authority.`;
    const bounded = (input.priorRoleArtifacts ?? []).slice(-TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS).map((artifact) => ({
        ...artifact,
        outputTextPreview: truncateTokenBudget(artifact.outputTextPreview, TEAM_HANDOFF_CONTEXT_PER_ARTIFACT_TOKENS)
    }));
    const handoff = bounded.length === 0 ? '' : `\nPrior governed role artifacts (review and cite relevant source roles):\n${truncateTokenBudget(bounded.map((artifact) => `[${artifact.role}/${artifact.providerId}] ${artifact.outputTextPreview}`).join('\n'), TEAM_HANDOFF_CONTEXT_TOTAL_TOKENS)}`;
    return {
        instructions: `${base}${handoff}`,
        telemetry: {
            baseInstructionChars: base.length,
            handoffChars: handoff.length,
            totalInstructionChars: base.length + handoff.length,
            actualTokenCount: estimateTokens(base) + estimateTokens(handoff),
            tokenEstimatorId: 'whitespace-v1',
            priorArtifactCount: bounded.length,
            consumedArtifactRefs: bounded.map((artifact) => `${artifact.role}/${artifact.providerId}`)
        }
    };
}
function estimateTokens(value) { return value.trim() ? value.trim().split(/\s+/).length : 0; }
function truncateTokenBudget(value, budget) { return value.trim().split(/\s+/).slice(0, budget).join(' '); }
export async function runDirectTeamProviderRole(input) {
    if (input.selection.runtimeMode !== 'real-agent')
        return null;
    const providerId = normalizeTeamProviderId(input.selection.providerId);
    if (providerId !== 'openai' && providerId !== 'anthropic' && providerId !== 'gemini-direct')
        return null;
    const rolePrompt = buildDirectTeamRoleInstructions(input);
    const request = {
        taskId: input.taskId,
        role: input.role,
        runtimeMode: 'real-agent',
        providerId,
        sdkId: input.selection.sdkId,
        modelId: input.selection.modelId,
        instructions: rolePrompt.instructions
    };
    const permissionPolicy = createDefaultTeamPermissionPolicy();
    const bridgeResult = providerId === 'openai'
        ? await launchOpenAITeamProviderRun({
            bridge: createOpenAITeamProviderBridge({
                schemaId: 'atm.openaiTeamProviderConfig.v1',
                providerId: 'openai',
                sdkId: 'openai-responses',
                modelId: input.selection.modelId,
                apiKeyEnvVar: 'OPENAI_API_KEY'
            }),
            request: { ...request, providerId: 'openai' },
            permissionPolicy,
            scopedPaths: input.scopedPaths,
            env: input.env,
            executor: input.executor
        })
        : providerId === 'anthropic' ? await launchAnthropicTeamProviderRun({
            bridge: createAnthropicTeamProviderBridge({
                schemaId: 'atm.anthropicTeamProviderConfig.v1',
                providerId: 'anthropic',
                sdkId: 'anthropic-messages',
                modelId: input.selection.modelId,
                apiKeyEnvVar: 'ANTHROPIC_API_KEY'
            }),
            request: { ...request, providerId: 'anthropic' },
            permissionPolicy,
            scopedPaths: input.scopedPaths,
            env: input.env,
            executor: input.executor
        }) : await launchGeminiDirectTeamProviderRun({
            bridge: createGeminiDirectTeamProviderBridge({
                schemaId: 'atm.geminiDirectTeamProviderConfig.v1',
                providerId: 'gemini-direct',
                sdkId: 'gemini-generate-content',
                modelId: input.selection.modelId,
                apiKeyEnvVar: 'GEMINI_API_KEY'
            }),
            request: { ...request, providerId: 'gemini-direct' },
            permissionPolicy,
            scopedPaths: input.scopedPaths,
            env: input.env,
            executor: input.executor
        });
    return {
        ok: bridgeResult.ok,
        attempts: 1,
        sessionId: bridgeResult.sessionId,
        providerId: bridgeResult.providerId,
        coordinatorOwnedAuthority: true,
        stepResult: {
            ok: bridgeResult.ok,
            providerId: bridgeResult.providerId,
            role: input.role,
            artifacts: [bridgeResult.artifact.artifactType, ...bridgeResult.artifact.outputArtifacts],
            retryable: bridgeResult.artifact.execution.retryable,
            summary: `${bridgeResult.providerId} ${input.role} vendor execution ${bridgeResult.ok ? 'completed' : 'failed'}${bridgeResult.artifact.execution.statusCode ? ` with status ${bridgeResult.artifact.execution.statusCode}` : ''}.`
        },
        handoffArtifact: {
            role: input.role,
            providerId: bridgeResult.providerId,
            outputTextPreview: bridgeResult.artifact.execution.outputTextPreview
        },
        contextTelemetry: rolePrompt.telemetry
    };
}
export function loadTeamVendorLocalSecrets(cwd) {
    const relativePath = 'agent-integrations/vendors/team-secrets.local.json';
    const secretPath = path.join(cwd, ...relativePath.split('/'));
    const warnings = [];
    const env = {};
    const secretRefs = new Set();
    let providerCount = 0;
    if (existsSync(secretPath)) {
        const parsed = readJsonFile(secretPath, 'ATM_TEAM_VENDOR_SECRETS_INVALID');
        if (parsed.schemaId !== 'atm.teamVendorSecrets.local.v1') {
            throw new CliError('ATM_TEAM_VENDOR_SECRETS_INVALID', 'Team vendor local secrets must use schemaId atm.teamVendorSecrets.local.v1.', {
                exitCode: 2,
                details: { path: relativePath }
            });
        }
        const providerEntries = parsed.providers && typeof parsed.providers === 'object'
            ? Object.entries(parsed.providers)
            : [];
        providerCount = providerEntries.length;
        for (const [providerId, refs] of providerEntries) {
            if (!refs || typeof refs !== 'object' || Array.isArray(refs)) {
                warnings.push(`Provider ${providerId} does not contain a key/value object.`);
                continue;
            }
            for (const [envName, value] of Object.entries(refs)) {
                collectTeamVendorSecret(env, secretRefs, warnings, envName, value, `providers.${providerId}`);
            }
        }
        for (const [envName, value] of Object.entries(parsed.env ?? {})) {
            collectTeamVendorSecret(env, secretRefs, warnings, envName, value, 'env');
        }
    }
    return {
        env,
        summary: {
            schemaId: 'atm.teamVendorLocalSecretsSummary.v1',
            path: relativePath,
            loaded: existsSync(secretPath),
            providerCount,
            secretRefCount: secretRefs.size,
            secretRefs: [...secretRefs].sort(),
            warningCount: warnings.length,
            warnings,
            rawSecretsLogged: false
        }
    };
}
function collectTeamVendorSecret(env, secretRefs, warnings, envName, value, source) {
    const normalizedEnvName = String(envName ?? '').trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(normalizedEnvName)) {
        warnings.push(`Ignored invalid environment variable name ${source}.${envName}.`);
        return;
    }
    if (typeof value !== 'string' || value.length === 0) {
        warnings.push(`Ignored empty or non-string secret value for ${normalizedEnvName}.`);
        return;
    }
    env[normalizedEnvName] = value;
    secretRefs.add(normalizedEnvName);
}
function buildProviderOrchestrationEvents(input) {
    const role = String(input.result.stepResult.role ?? 'worker');
    const providerId = normalizeTeamProviderId(input.result.providerId) ?? 'unknown';
    const conflictBlocked = input.result.stepResult.artifacts.includes('atm.brokerConflictResolution.v1')
        || input.result.stepResult.summary.includes('broker-conflict-blocked');
    return [
        createTeamObservabilityEvent({
            eventType: 'session.start',
            taskId: input.taskId,
            teamRunId: input.teamRunId,
            providerId,
            role,
            runtimeMode: input.runtimeMode,
            summary: `Provider session started: ${input.result.sessionId}.`
        }),
        createTeamObservabilityEvent({
            eventType: input.result.ok ? 'step.execution' : 'session.failure',
            taskId: input.taskId,
            teamRunId: input.teamRunId,
            providerId,
            role,
            runtimeMode: input.runtimeMode,
            decisionClass: input.result.ok ? 'auto-execution' : 'blocked',
            decisionReason: input.result.stepResult.summary,
            violationStatus: conflictBlocked ? 'broker-conflict-blocked' : input.result.ok ? 'none' : 'blocked',
            statusCode: conflictBlocked ? 'broker-conflict-blocked' : input.result.ok ? 'none' : 'provider-step-failed',
            summary: input.result.stepResult.summary
        }),
        ...input.result.stepResult.artifacts.map((artifactType) => createTeamObservabilityEvent({
            eventType: artifactType === 'atm.brokerConflictResolution.v1' || conflictBlocked ? 'broker.conflict.blocked' : 'artifact.output',
            taskId: input.taskId,
            teamRunId: input.teamRunId,
            providerId,
            role,
            runtimeMode: input.runtimeMode,
            artifactType,
            artifactId: `${input.result.sessionId}:${artifactType}`,
            decisionClass: conflictBlocked ? 'blocked' : input.result.ok ? 'auto-execution' : 'blocked',
            decisionReason: input.result.stepResult.summary,
            violationStatus: conflictBlocked ? 'broker-conflict-blocked' : input.result.ok ? 'none' : 'blocked',
            statusCode: conflictBlocked ? 'broker-conflict-blocked' : input.result.ok ? 'none' : 'provider-step-failed',
            summary: `${artifactType} emitted by ${role}.`
        })),
        createTeamObservabilityEvent({
            eventType: input.result.ok ? 'session.complete' : 'session.failure',
            taskId: input.taskId,
            teamRunId: input.teamRunId,
            providerId,
            role,
            runtimeMode: input.runtimeMode,
            decisionClass: input.result.ok ? 'auto-execution' : 'blocked',
            decisionReason: input.result.stepResult.summary,
            violationStatus: conflictBlocked ? 'broker-conflict-blocked' : input.result.ok ? 'none' : 'blocked',
            statusCode: conflictBlocked ? 'broker-conflict-blocked' : input.result.ok ? 'none' : 'provider-step-failed',
            summary: input.result.ok ? `Provider session completed: ${input.result.sessionId}.` : `Provider session failed: ${input.result.sessionId}.`
        })
    ];
}
function appendTeamRuntimeObservabilityEvents(cwd, teamRunId, events) {
    if (events.length === 0)
        return;
    const runDir = path.join(teamRunsDirectory(cwd), teamRunId);
    mkdirSync(runDir, { recursive: true });
    const jsonlPath = path.join(runDir, 'observability-events.jsonl');
    appendFileSync(jsonlPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
}
function normalizeTeamProviderId(value) {
    const normalized = String(value ?? '').trim();
    return TEAM_PROVIDER_IDS.includes(normalized) ? normalized : null;
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
function listTeamRuns(cwd) {
    const directory = teamRunsDirectory(cwd);
    if (!existsSync(directory))
        return [];
    return readdirSync(directory)
        .filter((entry) => entry.endsWith('.json'))
        .sort((left, right) => left.localeCompare(right))
        .map((entry) => readJsonFile(path.join(directory, entry), 'ATM_TEAM_RUN_INVALID'));
}
function findLatestTeamRunForTask(cwd, taskId) {
    const runs = listTeamRuns(cwd)
        .filter((run) => typeof run === 'object' && run !== null && run.taskId === taskId)
        .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? '').localeCompare(String(left.updatedAt ?? left.createdAt ?? '')));
    return runs[0] ?? null;
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
function writeExistingTeamRun(cwd, teamRunId, run) {
    const filePath = path.join(teamRunsDirectory(cwd), `${teamRunId}.json`);
    if (!existsSync(filePath)) {
        throw new CliError('ATM_TEAM_RUN_NOT_FOUND', `Team run not found: ${teamRunId}`, {
            exitCode: 2,
            details: { teamRunId, path: path.relative(cwd, filePath).replace(/\\/g, '/') }
        });
    }
    writeJsonFile(filePath, run);
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
                details: {
                    teamRunId: input.teamRunId,
                    permission: input.permission,
                    currentOwner: conflict.agentId,
                    requestedOwner: input.actorId,
                    requiredCommand: `node atm.mjs team release --team ${input.teamRunId} --actor ${conflict.agentId} --permission ${input.permission} --json`
                }
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
                details: { teamRunId: input.teamRunId, permission: input.permission, actorId: input.actorId }
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
function normalizePermissionLeaseRecords(value) {
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
function buildTeamRunPatrolFindings(teamRun, input) {
    const findings = [];
    if (!teamRun)
        return findings;
    const run = teamRun;
    if (run.executionMode !== 'manual-team') {
        findings.push(teamPatrolFinding({
            level: 'warning',
            code: 'ATM_TEAM_PATROL_RUNTIME_MODE_UNEXPECTED',
            category: 'runtime-mode',
            summary: `Team run ${run.teamRunId} is not in manual-team execution mode.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
            details: { executionMode: run.executionMode ?? null }
        }));
    }
    if (run.agentsSpawned === true) {
        findings.push(teamPatrolFinding({
            level: 'warning',
            code: 'ATM_TEAM_PATROL_AGENTS_SPAWNED',
            category: 'runtime-mode',
            summary: `Team run ${run.teamRunId} reports spawned agents; coordinator should verify advisory role boundaries.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`
        }));
    }
    const brokerSubagent = run.brokerSubagent ?? run.runtimeContract?.brokerSubagent ?? null;
    if (!brokerSubagent || brokerSubagent.enabled !== true) {
        findings.push(teamPatrolFinding({
            level: 'blocker',
            code: 'ATM_TEAM_PATROL_BROKER_SUBAGENT_MISSING',
            category: 'broker-governance',
            summary: `Team run ${run.teamRunId} does not expose an enabled broker subagent contract.`,
            suggestedCommand: `node atm.mjs team start --task ${quoteCliValue(input.taskId)} --actor <actor> --json`,
            details: { schemaId: brokerSubagent?.schemaId ?? null, enabled: brokerSubagent?.enabled ?? null }
        }));
    }
    else {
        if (brokerSubagent.decisionSurface !== 'brokerLane' || brokerSubagent.stewardId !== 'neutral-write-steward') {
            findings.push(teamPatrolFinding({
                level: 'warning',
                code: 'ATM_TEAM_PATROL_BROKER_SUBAGENT_DRIFT',
                category: 'broker-governance',
                summary: `Team run ${run.teamRunId} broker subagent contract does not match the expected broker lane steward.`,
                suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
                details: {
                    decisionSurface: brokerSubagent.decisionSurface ?? null,
                    stewardId: brokerSubagent.stewardId ?? null
                }
            }));
        }
        const expectedEvidenceRequired = [
            'atm.teamBrokerLaneEvidence.v1',
            'atm.stewardApplyEvidence.v1',
            'atm.brokerOperationRunRecordEnvelope.v1'
        ];
        const evidenceRequired = normalizeStringArray(brokerSubagent.evidenceRequired);
        const missingEvidence = expectedEvidenceRequired.filter((entry) => !evidenceRequired.includes(entry));
        if (missingEvidence.length > 0) {
            findings.push(teamPatrolFinding({
                level: 'blocker',
                code: 'ATM_TEAM_PATROL_BROKER_EVIDENCE_GATE_DRIFT',
                category: 'broker-governance',
                summary: `Team run ${run.teamRunId} broker subagent evidence gates are incomplete.`,
                suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
                details: {
                    evidenceRequired,
                    expectedEvidenceRequired,
                    missingEvidence
                }
            }));
        }
        const boundary = brokerSubagent.authorityBoundary ?? {};
        if (boundary.fileWrite === true || boundary.gitWrite === true || boundary.taskLifecycle === true || boundary.selfClose === true) {
            findings.push(teamPatrolFinding({
                level: 'blocker',
                code: 'ATM_TEAM_PATROL_BROKER_SUBAGENT_AUTHORITY_DRIFT',
                category: 'broker-governance',
                summary: `Team run ${run.teamRunId} broker subagent authority boundary is too broad.`,
                suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
                details: { authorityBoundary: boundary }
            }));
        }
    }
    const commitLane = run.commitLane ?? run.runtimeContract?.commitLane ?? null;
    if (commitLane && (commitLane.serializedBy !== 'branch-commit-queue'
        || commitLane.ownerRole !== 'coordinator'
        || commitLane.workerGitWrite === true)) {
        findings.push(teamPatrolFinding({
            level: 'blocker',
            code: 'ATM_TEAM_PATROL_COMMIT_LANE_DRIFT',
            category: 'broker-governance',
            summary: `Team run ${run.teamRunId} commit lane no longer enforces coordinator-owned serialized commits.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
            details: {
                serializedBy: commitLane.serializedBy ?? null,
                ownerRole: commitLane.ownerRole ?? null,
                workerGitWrite: commitLane.workerGitWrite ?? null
            }
        }));
    }
    const artifactFindings = Array.isArray(run.artifactHandoff?.findings)
        ? run.artifactHandoff.findings
        : Array.isArray(run.runtimeContract?.artifactHandoff?.findings)
            ? run.runtimeContract.artifactHandoff.findings
            : [];
    for (const artifactFinding of artifactFindings) {
        if (artifactFinding?.blocking === true) {
            findings.push(teamPatrolFinding({
                level: input.mode === 'close-preflight' ? 'blocker' : 'warning',
                code: 'ATM_TEAM_PATROL_ARTIFACT_HANDOFF_BLOCKED',
                category: 'artifact-gap',
                summary: String(artifactFinding.summary ?? 'Team role artifact handoff has a missing required artifact.'),
                suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
                details: {
                    role: artifactFinding.role ?? null,
                    agentId: artifactFinding.agentId ?? null,
                    artifact: artifactFinding.artifact ?? null
                }
            }));
        }
    }
    const remaining = extractRetryBudgetRemaining(teamRun);
    if (remaining !== null && remaining <= 0) {
        findings.push(teamPatrolFinding({
            level: 'blocker',
            code: 'ATM_TEAM_PATROL_RETRY_BUDGET_EXHAUSTED',
            category: 'retry-budget',
            summary: `Team run ${run.teamRunId} has no retry budget remaining.`,
            suggestedCommand: `node atm.mjs team patrol --task ${quoteCliValue(input.taskId)} --mode close-preflight --team ${quoteCliValue(String(run.teamRunId))} --json`,
            details: { retryBudgetRemaining: remaining }
        }));
    }
    const reworkStatus = String(run.reworkRoute?.status ?? run.reworkStatus ?? '').trim();
    if (['needs-rework', 'blocked', 'stale'].includes(reworkStatus)) {
        findings.push(teamPatrolFinding({
            level: reworkStatus === 'blocked' ? 'blocker' : 'warning',
            code: 'ATM_TEAM_PATROL_REWORK_ROUTE_ATTENTION',
            category: 'rework-state',
            summary: `Team run ${run.teamRunId} rework route is ${reworkStatus}.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
            details: { reworkStatus }
        }));
    }
    if (reworkStatus === 'ready-for-close' && input.mode === 'close-preflight') {
        findings.push(teamPatrolFinding({
            level: 'info',
            code: 'ATM_TEAM_PATROL_REWORK_ROUTE_READY_FOR_CLOSE',
            category: 'rework-state',
            summary: `Team run ${run.teamRunId} rework route is ready-for-close.`,
            suggestedCommand: `node atm.mjs taskflow pre-close --task ${quoteCliValue(input.taskId)} --actor <actor> --json`,
            details: { reworkStatus }
        }));
    }
    return findings;
}
function extractRetryBudgetRemaining(teamRun) {
    const run = teamRun;
    const retryBudget = run?.retryBudget ?? run?.runtimeContract?.brokerSubagent ?? null; // 使用 brokerSubagent 的 retryBudget 或者是對應的 fallback
    if (retryBudget?.status === 'escalation-required' || retryBudget?.exhausted === true) {
        return 0;
    }
    const candidates = [
        run?.reworkRoute?.retryBudgetRemaining,
        run?.reworkRoute?.retryBudget?.remaining
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
            return candidate;
        }
    }
    return null;
}
function teamPatrolFinding(input) {
    return input;
}
function summarizePatrolSeverity(findings) {
    if (findings.some((finding) => finding.level === 'blocker'))
        return 'blocker';
    if (findings.some((finding) => finding.level === 'warning'))
        return 'warning';
    return 'info';
}
function suggestedPatrolCommand(taskId, mode, severity) {
    if (severity === 'blocker') {
        return `node atm.mjs taskflow pre-close --task ${quoteCliValue(taskId)} --actor <actor> --json`;
    }
    if (mode === 'claim-preflight') {
        return `node atm.mjs next --claim --task ${quoteCliValue(taskId)} --actor <actor> --json`;
    }
    if (mode === 'close-preflight') {
        return `node atm.mjs taskflow pre-close --task ${quoteCliValue(taskId)} --actor <actor> --json`;
    }
    return `node atm.mjs team patrol --task ${quoteCliValue(taskId)} --mode ${mode} --json`;
}
function buildTeamPatrolFollowUp(taskId, mode, findings) {
    const commands = uniqueStrings(findings.map((finding) => finding.suggestedCommand).filter((entry) => Boolean(entry)));
    if (commands.length > 0)
        return commands;
    if (mode === 'close-preflight') {
        return [`node atm.mjs taskflow pre-close --task ${quoteCliValue(taskId)} --actor <actor> --json`];
    }
    return [`node atm.mjs team plan --task ${quoteCliValue(taskId)} --json`];
}
function compactTeamRun(run) {
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
        title: task?.title ?? task?.workItemId ?? taskId,
        status: task?.status ?? null,
        targetRepo: task?.targetRepo ?? null,
        sourcePlanPath: task?.source?.planPath ?? task?.sourcePlanPath ?? null
    };
}
function classifyTeamPilotFinding(code) {
    const normalized = String(code ?? '').toLowerCase();
    if (normalized.includes('scope'))
        return 'boundary-confusion';
    if (normalized.includes('lease') || normalized.includes('broker'))
        return 'role-specific-friction';
    if (normalized.includes('validator'))
        return 'validator-gap';
    return 'tooling-mismatch';
}
function normalizeTeamBrokerPilotFindings(brokerLane, promotionTarget) {
    const decision = brokerLane?.decision;
    if (!decision) {
        return [];
    }
    const conflicts = Array.isArray(decision.conflicts) ? decision.conflicts : [];
    if (conflicts.length === 0) {
        return [{
                category: 'role-specific-friction',
                summary: decision.reason ?? 'Broker-governed pilot requires refinement.',
                detail: decision.reason ?? 'No broker detail was provided.',
                correctRoute: 'Surface the broker verdict as pilot evidence and keep Coordinator from forcing a start.',
                promotionTarget
            }];
    }
    return conflicts.map((conflict) => ({
        category: conflict.kind === 'lease' ? 'role-specific-friction' : 'boundary-confusion',
        summary: decision.reason ?? 'Broker-governed pilot finding',
        detail: String(conflict.detail ?? '').trim() || 'Broker conflict detail unavailable.',
        correctRoute: 'Use takeover, repair, or bounded proposal flow before attempting a worker write lease again.',
        promotionTarget
    }));
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
