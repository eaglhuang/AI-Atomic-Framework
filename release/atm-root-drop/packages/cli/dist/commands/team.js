import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, parseArgsForCommand, quoteCliValue, readJsonFile, writeJsonFile } from './shared.js';
import { TEAM_CLOSURE_ATTESTATION_SCHEMA_ID } from './evidence.js';
import { getCommandSpec } from './command-specs.js';
import { runTasks } from './tasks.js';
import { findTaskClaimDependencyBlockers } from './tasks/dependency-gates.js';
import { validateStrictPathHeuristic } from './tasks/task-import-validators.js';
import { buildTeamKnowledgeSummary, runTeamKnowledge } from './team-knowledge.js';
import { runTeamWave } from './team-wave.js';
import { buildTeamBrokerEvidence, brokerLaneToFindings, evaluateTeamBrokerLane } from '../../../core/dist/broker/team-lane.js';
import { resolveNodejsTeamWorkerAdapter } from '../../../core/dist/team-runtime/nodejs-worker-adapter.js';
import { resolveTeamProviderSelection } from '../../../core/dist/team-runtime/provider-selection.js';
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
export async function runTeam(argv) {
    if (String(argv[0] ?? '').toLowerCase() === 'knowledge') {
        const cwd = path.resolve(readOptionValue(argv, '--cwd') ?? process.cwd());
        return runTeamKnowledge(argv.slice(1), cwd);
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
    if (!['plan', 'start', 'status', 'validate', 'patrol'].includes(action)) {
        throw new CliError('ATM_CLI_USAGE', 'team supports: plan, start, status, validate, patrol, wave, knowledge', { exitCode: 2 });
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
        actorId: String(parsed.options.actor ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? 'team-planner').trim()
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
        editorBridgeDisabled: parsed.options.disableEditorBridge,
        recipe,
        allowedFiles: deriveWritePaths(task, cwd),
        permissionLeases: teamPlan.suggestedPermissionLeases,
        evidenceRequired: String(task.evidenceRequired ?? 'command-backed')
    });
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
                brokerLane: teamPlan.brokerLane,
                runtimeContract,
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
                    runtimeContract,
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
                agentsSpawned: runtimeContract.agentsSpawned,
                teamRunPath: `.atm/runtime/team-runs/${teamRun.teamRunId}.json`,
                teamRun,
                brokerLane: teamPlan.brokerLane,
                runtimeContract,
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
            runtimeContract,
            brokerLane: teamPlan.brokerLane,
            runtimePilot: teamPlan.runtimePilot
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
    const editorBridgeDisabled = Boolean(input.editorBridgeDisabled);
    const workerAdapter = resolveNodejsTeamWorkerAdapter({
        runtimeMode: selectionDecision?.runtimeMode ?? runtimeMode,
        runtimeLanguage,
        runtimeAdapterId,
        providerId: providerId ?? selectionDecision?.providerId,
        sdkId: sdkId ?? selectionDecision?.sdkId,
        modelId: modelId ?? selectionDecision?.modelId
    });
    const agentsSpawned = workerAdapter.agentsSpawned;
    const executionSurface = workerAdapter.executionSurface;
    return {
        schemaId: 'atm.teamRuntimeContract.v1',
        runtimeMode: selectionDecision?.runtimeMode ?? runtimeMode,
        runtimeLanguage,
        runtimeAdapterId: runtimeAdapterId ?? workerAdapter.adapterId,
        providerId: providerId ?? selectionDecision?.providerId ?? workerAdapter.providerId,
        sdkId: sdkId ?? selectionDecision?.sdkId ?? workerAdapter.sdkId,
        modelId: modelId ?? selectionDecision?.modelId ?? workerAdapter.modelId,
        agentsSpawned,
        executionSurface,
        selectionReason: describeRuntimeSelection({
            runtimeMode: selectionDecision?.runtimeMode ?? runtimeMode,
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
    const task = readTask(input.cwd, input.taskId);
    const recipes = loadTeamRecipes(input.cwd);
    const recipe = selectRecipe({
        recipes,
        requestedRecipeId: input.requestedRecipeId,
        task
    });
    const writePaths = deriveWritePaths(task, input.cwd);
    const permissionValidation = validateTeamPermissionModel(recipe, writePaths, {
        allowedWritePaths: deriveAllowedWriteScope(task, input.cwd),
        repoRoot: input.cwd
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
        recipe,
        writePaths,
        validation,
        brokerLane,
        knowledgeSummary: buildTeamKnowledgeSummary({
            cwd: input.cwd,
            taskId: String(task.workItemId ?? task.taskId ?? input.taskId),
            top: 3
        })
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
    const paths = collectTaskPathHints(task);
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
    const explicitAllowed = normalizeTaskPathArray(task.targetAllowedFiles, repoRoot);
    if (explicitAllowed.length > 0) {
        return uniqueStrings(explicitAllowed);
    }
    return normalizeTaskWriteScope([
        ...normalizeTaskPathArray(task.deliverables, repoRoot),
        ...normalizeTaskPathArray(task.scopePaths, repoRoot)
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
export function buildTeamPlan(input) {
    const atomizationChecklist = buildAtomizationChecklist(input.task, input.writePaths);
    const crewBriefingContract = buildMinimalTaskCrewBriefingContract(input.task, input.writePaths, input.validation, input.brokerLane);
    const implementerSelector = selectTeamImplementer(input.task, input.recipe, input.writePaths);
    const captainDecision = buildCaptainDecision(input.task, input.writePaths, input.validation, input.brokerLane, crewBriefingContract, atomizationChecklist, implementerSelector);
    const roleSkillPacks = buildTeamRoleSkillPackContract(input.recipe);
    const routingMatrix = buildTeamRoleRoutingMatrix(roleSkillPacks);
    const growthContract = buildTeamGrowthContract();
    const runtimePilot = buildTeamRuntimePilot({
        roleSkillPacks,
        routingMatrix,
        growthContract,
        validation: input.validation,
        brokerLane: input.brokerLane
    });
    return {
        schemaId: 'atm.teamPlan.v1',
        recipeId: input.recipe.recipeId,
        channelHint: 'normal',
        brokerLane: input.brokerLane,
        agents: input.recipe.agents,
        captainDecision,
        implementerSelector,
        roleSkillPacks,
        routingMatrix,
        growthContract,
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
        suggestedPermissionLeases: buildSuggestedPermissionLeases(input.recipe, input.writePaths),
        nextSteps: [
            'Review this dry-run plan.',
            'Run team start when you want a runtime team run record.',
            'Do not hand-edit .atm/runtime team state.'
        ],
        validation: input.validation
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
export function buildTeamRoleRoutingMatrix(roleSkillPacks) {
    const hasRole = (role) => roleSkillPacks.roles.some((entry) => entry.role === role);
    const maybe = (role) => hasRole(role) ? [role] : [];
    return {
        schemaId: 'atm.teamRoleRoutingMatrix.v1',
        providerNeutral: true,
        coordinatorOwnsLifecycle: true,
        routes: [
            {
                workstream: 'task-entry-routing',
                primaryRole: 'coordinator',
                supportingRoles: [...maybe('reader'), ...maybe('scopeGuardian')],
                advisoryRoles: [...maybe('evidenceCollector')],
                playbookSlice: 'route-claim-close-commit'
            },
            {
                workstream: 'scoped-implementation',
                primaryRole: hasRole('implementer') ? 'implementer' : 'coordinator',
                supportingRoles: [...maybe('scopeGuardian')],
                advisoryRoles: [...maybe('reader')],
                playbookSlice: 'scoped-delivery'
            },
            {
                workstream: 'validation-and-evidence',
                primaryRole: hasRole('validator') ? 'validator' : 'coordinator',
                supportingRoles: [...maybe('evidenceCollector')],
                advisoryRoles: [...maybe('reader')],
                playbookSlice: 'validator-evidence-pass'
            }
        ]
    };
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
export function buildTeamRuntimePilot(input) {
    const orderedRoles = ['coordinator', 'implementer', 'validator'];
    const selectedRoles = orderedRoles.filter((role) => input.roleSkillPacks.roles.some((entry) => entry.role === role));
    const pilotRoles = selectedRoles.length >= 3 ? selectedRoles.slice(0, 3) : selectedRoles.slice(0, 2);
    const selectedEntries = input.roleSkillPacks.roles.filter((entry) => pilotRoles.includes(entry.role));
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
        realisticWorkflow: [
            'Coordinator routes the task and remains the only lifecycle and git.write owner.',
            'Implementer loads only the scoped delivery pack for the active workstream.',
            'Validator loads only validator-evidence guidance and returns findings to Coordinator.'
        ],
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
        actionableRefinementFindings
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
        brokerLane: input.teamPlan.brokerLane,
        captainDecision: input.teamPlan.captainDecision,
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
            validators: normalizeStringArray(input.task.validators),
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
        .filter((run) => run.taskId === taskId)
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
    if (teamRun.executionMode !== 'manual-team') {
        findings.push(teamPatrolFinding({
            level: 'warning',
            code: 'ATM_TEAM_PATROL_RUNTIME_MODE_UNEXPECTED',
            category: 'runtime-mode',
            summary: `Team run ${teamRun.teamRunId} is not in manual-team execution mode.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(teamRun.teamRunId))} --json`,
            details: { executionMode: teamRun.executionMode ?? null }
        }));
    }
    if (teamRun.agentsSpawned === true) {
        findings.push(teamPatrolFinding({
            level: 'warning',
            code: 'ATM_TEAM_PATROL_AGENTS_SPAWNED',
            category: 'runtime-mode',
            summary: `Team run ${teamRun.teamRunId} reports spawned agents; coordinator should verify advisory role boundaries.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(teamRun.teamRunId))} --json`
        }));
    }
    const brokerSubagent = teamRun.brokerSubagent ?? teamRun.runtimeContract?.brokerSubagent ?? null;
    if (!brokerSubagent || brokerSubagent.enabled !== true) {
        findings.push(teamPatrolFinding({
            level: 'blocker',
            code: 'ATM_TEAM_PATROL_BROKER_SUBAGENT_MISSING',
            category: 'broker-governance',
            summary: `Team run ${teamRun.teamRunId} does not expose an enabled broker subagent contract.`,
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
                summary: `Team run ${teamRun.teamRunId} broker subagent contract does not match the expected broker lane steward.`,
                suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(teamRun.teamRunId))} --json`,
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
                summary: `Team run ${teamRun.teamRunId} broker subagent evidence gates are incomplete.`,
                suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(teamRun.teamRunId))} --json`,
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
                summary: `Team run ${teamRun.teamRunId} broker subagent authority boundary is too broad.`,
                suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(teamRun.teamRunId))} --json`,
                details: { authorityBoundary: boundary }
            }));
        }
    }
    const commitLane = teamRun.commitLane ?? teamRun.runtimeContract?.commitLane ?? null;
    if (commitLane && (commitLane.serializedBy !== 'branch-commit-queue'
        || commitLane.ownerRole !== 'coordinator'
        || commitLane.workerGitWrite === true)) {
        findings.push(teamPatrolFinding({
            level: 'blocker',
            code: 'ATM_TEAM_PATROL_COMMIT_LANE_DRIFT',
            category: 'broker-governance',
            summary: `Team run ${teamRun.teamRunId} commit lane no longer enforces coordinator-owned serialized commits.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(teamRun.teamRunId))} --json`,
            details: {
                serializedBy: commitLane.serializedBy ?? null,
                ownerRole: commitLane.ownerRole ?? null,
                workerGitWrite: commitLane.workerGitWrite ?? null
            }
        }));
    }
    const artifactFindings = Array.isArray(teamRun.artifactHandoff?.findings)
        ? teamRun.artifactHandoff.findings
        : Array.isArray(teamRun.runtimeContract?.artifactHandoff?.findings)
            ? teamRun.runtimeContract.artifactHandoff.findings
            : [];
    for (const artifactFinding of artifactFindings) {
        if (artifactFinding?.blocking === true) {
            findings.push(teamPatrolFinding({
                level: input.mode === 'close-preflight' ? 'blocker' : 'warning',
                code: 'ATM_TEAM_PATROL_ARTIFACT_HANDOFF_BLOCKED',
                category: 'artifact-gap',
                summary: String(artifactFinding.summary ?? 'Team role artifact handoff has a missing required artifact.'),
                suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(teamRun.teamRunId))} --json`,
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
            summary: `Team run ${teamRun.teamRunId} has no retry budget remaining.`,
            suggestedCommand: `node atm.mjs team patrol --task ${quoteCliValue(input.taskId)} --mode close-preflight --team ${quoteCliValue(String(teamRun.teamRunId))} --json`,
            details: { retryBudgetRemaining: remaining }
        }));
    }
    const reworkStatus = String(teamRun.reworkRoute?.status ?? teamRun.reworkStatus ?? '').trim();
    if (['needs-rework', 'blocked', 'stale'].includes(reworkStatus)) {
        findings.push(teamPatrolFinding({
            level: reworkStatus === 'blocked' ? 'blocker' : 'warning',
            code: 'ATM_TEAM_PATROL_REWORK_ROUTE_ATTENTION',
            category: 'rework-state',
            summary: `Team run ${teamRun.teamRunId} rework route is ${reworkStatus}.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(teamRun.teamRunId))} --json`,
            details: { reworkStatus }
        }));
    }
    if (reworkStatus === 'ready-for-close' && input.mode === 'close-preflight') {
        findings.push(teamPatrolFinding({
            level: 'info',
            code: 'ATM_TEAM_PATROL_REWORK_ROUTE_READY_FOR_CLOSE',
            category: 'rework-state',
            summary: `Team run ${teamRun.teamRunId} rework route is ready-for-close.`,
            suggestedCommand: `node atm.mjs taskflow pre-close --task ${quoteCliValue(input.taskId)} --actor <actor> --json`,
            details: { reworkStatus }
        }));
    }
    return findings;
}
function extractRetryBudgetRemaining(teamRun) {
    const retryBudget = teamRun.retryBudget ?? teamRun.runtimeContract?.retryBudget;
    if (retryBudget?.status === 'escalation-required' || retryBudget?.exhausted === true) {
        return 0;
    }
    const candidates = [
        teamRun.reworkRoute?.retryBudgetRemaining,
        teamRun.reworkRoute?.retryBudget?.remaining
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
    const brokerGovernance = run.teamSummary?.brokerGovernance ?? null;
    return {
        teamRunId: run.teamRunId,
        taskId: run.taskId,
        recipeId: run.recipeId,
        actorId: run.actorId,
        status: run.status,
        roleCount: Array.isArray(run.roles) ? run.roles.length : Array.isArray(run.agents) ? run.agents.length : 0,
        leaseCount: Array.isArray(run.leases) ? run.leases.length : Array.isArray(run.permissionLeases) ? run.permissionLeases.length : 0,
        brokerSubagentEnabled: run.brokerSubagent?.enabled === true || run.runtimeContract?.brokerSubagent?.enabled === true,
        brokerDecisionSurface: run.brokerSubagent?.decisionSurface ?? run.runtimeContract?.brokerSubagent?.decisionSurface ?? null,
        brokerStewardId: run.brokerSubagent?.stewardId ?? run.runtimeContract?.brokerSubagent?.stewardId ?? null,
        brokerGovernanceSummaryId: brokerGovernance?.schemaId ?? null,
        runtimePilotMode: run.runtimePilot?.pilotMode ?? null,
        runtimePilotRoles: normalizeStringArray(run.runtimePilot?.selectedRoles),
        brokerEvidenceRequired: normalizeStringArray(brokerGovernance?.brokerEvidenceRequired ?? run.brokerSubagent?.evidenceRequired ?? run.runtimeContract?.brokerSubagent?.evidenceRequired),
        commitLaneSerializedBy: brokerGovernance?.commitLaneSerializedBy ?? run.runtimeContract?.commitLane?.serializedBy ?? null,
        commitLaneOwnerRole: brokerGovernance?.commitLaneOwnerRole ?? run.runtimeContract?.commitLane?.ownerRole ?? null,
        workerGitWrite: brokerGovernance?.workerGitWrite ?? run.runtimeContract?.workerAdapter?.authorityBoundary?.gitWrite ?? null,
        workerTaskLifecycle: brokerGovernance?.workerTaskLifecycle ?? run.runtimeContract?.workerAdapter?.authorityBoundary?.taskLifecycle ?? null,
        workerSelfClose: brokerGovernance?.workerSelfClose ?? run.runtimeContract?.workerAdapter?.authorityBoundary?.selfClose ?? null,
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
    const candidates = [
        ...normalizeTaskPathArray(task.targetAllowedFiles, repoRoot),
        ...normalizeTaskPathArray(task.deliverables, repoRoot),
        ...normalizeTaskPathArray(task.scopePaths, repoRoot)
    ];
    return uniqueStrings(candidates.map((entry) => normalizeTeamLeasePath(entry, repoRoot)).filter((normalized) => {
        return normalized && !normalized.startsWith('.atm/runtime/') && !normalized.startsWith('.atm/history/');
    }));
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
