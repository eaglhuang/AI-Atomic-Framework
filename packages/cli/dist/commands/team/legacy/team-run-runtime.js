import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { makeResult, message, readJsonFile, writeJsonFile } from '../../shared.js';
import { planSharedSurfaceAcquisition } from '../../../../../core/dist/broker/shared-surface-queue.js';
import { composeTeamContributionManifests } from '../../team/composer.js';
import { buildTeamReworkRouteStateMachine } from './runtime-contracts.js';
import { compactTeamRun, createTeamRunId, listTeamRuns, readTeamRun, teamRunsDirectory } from './team-run-store.js';
import { deriveWritePaths, normalizeStringArray, summarizeTask } from './team-utils.js';
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
